// QuickLot: settings, sign-in, saved cars and the posting limits.
// Loaded by the popup (script tag) and the background worker (importScripts).
// Works in two modes:
//   - Account mode: config.js has Supabase settings. Google sign-in, data saved to the account.
//   - Local mode: config.js is empty. Everything is saved in this browser only.

(function (root) {
  const cfg = root.QUICKLOT_CONFIG || {};
  const accountMode = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  const DEFAULT_SETTINGS = {
    tone: "friendly",
    theme: "light",
    accent: "blue",
    risk_accepted_at: null,
    setup_done: false,
    daily_cap: 5,
    spacing_minutes: 15,
  };

  const get = async (key, fallback) => {
    const v = await chrome.storage.local.get(key);
    return v[key] === undefined ? fallback : v[key];
  };
  const set = (key, value) => chrome.storage.local.set({ [key]: value });

  // ---------- Sign-in (Supabase Auth with Google, no extra libraries) ----------

  async function signIn() {
    if (!accountMode) return null;
    const redirect = chrome.identity.getRedirectURL("supabase");
    const url =
      cfg.SUPABASE_URL +
      "/auth/v1/authorize?provider=google&redirect_to=" +
      encodeURIComponent(redirect);
    const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const hash = new URLSearchParams(new URL(result).hash.slice(1));
    if (!hash.get("access_token")) {
      throw new Error(hash.get("error_description") || "Sign-in didn't finish.");
    }
    const session = {
      access_token: hash.get("access_token"),
      refresh_token: hash.get("refresh_token"),
      expires_at: Date.now() + Number(hash.get("expires_in") || 3600) * 1000,
    };
    await set("session", session);
    return session;
  }

  async function getSession() {
    if (!accountMode) return null;
    const session = await get("session", null);
    if (!session) return null;
    if (Date.now() < session.expires_at - 60_000) return session;
    // Refresh an expiring session.
    const res = await fetch(cfg.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      await chrome.storage.local.remove("session");
      return null;
    }
    const j = await res.json();
    const fresh = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + Number(j.expires_in || 3600) * 1000,
      email: j.user && j.user.email,
    };
    await set("session", fresh);
    return fresh;
  }

  async function signOut() {
    await chrome.storage.local.remove(["session", "settings"]);
  }

  async function rest(path, options = {}) {
    const session = await getSession();
    if (!session) throw new Error("Please sign in again.");
    const res = await fetch(cfg.SUPABASE_URL + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error("Couldn't reach your account (" + res.status + ").");
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function userEmail() {
    const session = await getSession();
    if (!session) return "";
    if (session.email) return session.email;
    const res = await fetch(cfg.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
    });
    if (!res.ok) return "";
    const u = await res.json();
    await set("session", { ...session, email: u.email });
    return u.email || "";
  }

  // ---------- Settings ----------

  async function loadSettings() {
    let s = { ...DEFAULT_SETTINGS, ...(await get("settings", {})) };
    if (accountMode && (await getSession())) {
      try {
        const rows = await rest("profiles?select=*");
        if (rows && rows[0]) s = { ...s, ...rows[0] };
      } catch (_) {
        // Fall back to the copy saved in this browser.
      }
    }
    await set("settings", s);
    return s;
  }

  async function saveSettings(patch) {
    const s = { ...(await get("settings", DEFAULT_SETTINGS)), ...patch };
    s.daily_cap = Math.min(10, Math.max(1, Number(s.daily_cap) || 5));
    s.spacing_minutes = Math.min(240, Math.max(5, Number(s.spacing_minutes) || 15));
    await set("settings", s);
    if (accountMode && (await getSession())) {
      const { tone, theme, accent, risk_accepted_at, setup_done, daily_cap, spacing_minutes } = s;
      const rows = await rest("profiles?select=id", {});
      const body = { tone, theme, accent, risk_accepted_at, setup_done, daily_cap, spacing_minutes, updated_at: new Date().toISOString() };
      if (rows && rows[0]) {
        await rest("profiles?id=eq." + rows[0].id, { method: "PATCH", body: JSON.stringify(body) });
      }
    }
    return s;
  }

  // ---------- Posting limits (daily cap and spacing) ----------

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  async function postingStatus() {
    const s = await get("settings", DEFAULT_SETTINGS);
    const log = (await get("postLog", [])).filter((t) => t >= startOfToday());
    const last = log.length ? Math.max(...log) : 0;
    const nextAt = last ? last + s.spacing_minutes * 60_000 : 0;
    return {
      usedToday: log.length,
      cap: s.daily_cap,
      spacingMinutes: s.spacing_minutes,
      capReached: log.length >= s.daily_cap,
      waitUntil: nextAt > Date.now() ? nextAt : 0,
    };
  }

  async function recordPost() {
    const log = (await get("postLog", [])).filter((t) => t >= startOfToday());
    log.push(Date.now());
    await set("postLog", log);
  }

  // ---------- My cars ----------

  async function saveCar(car, title, description) {
    const row = {
      vin: car.vin || null,
      title,
      price: car.price || null,
      mileage: car.mileage || null,
      details: { ...car, photos: (car.photos || []).slice(0, 20) },
      description,
      source_url: car.url || null,
    };
    if (accountMode && (await getSession())) {
      try {
        await rest("cars", { method: "POST", body: JSON.stringify(row) });
        return;
      } catch (_) {
        // Keep a local copy if the account can't be reached.
      }
    }
    const local = await get("cars", []);
    local.unshift({ ...row, id: String(Date.now()), created_at: new Date().toISOString() });
    await set("cars", local.slice(0, 50));
  }

  async function listCars() {
    if (accountMode && (await getSession())) {
      try {
        return await rest("cars?select=id,title,price,mileage,description,created_at&order=created_at.desc&limit=20");
      } catch (_) {
        // Fall through to the local copy.
      }
    }
    return (await get("cars", [])).slice(0, 20);
  }

  // ---------- Listing writer (AI through the backend, or the free built-in writer) ----------

  // instructions: what the user wants changed (optional). previous: the current description.
  async function writeListing(car, tone, instructions = "", previous = "") {
    const W = root.QuickLotWriter;
    const basic = (note) => {
      if (!instructions) return { text: W.writeLocal(car, tone), by: "basic", note };
      const r = W.rewriteLocal(car, tone, instructions);
      const heard = r.understood.length
        ? "The basic writer made it " + r.understood.join(", ") + "."
        : "The basic writer couldn't follow that note.";
      return { text: r.text, by: "basic", note: (note ? note + " " : "") + heard + " Full notes like yours need the AI writer (SETUP.md steps 2 to 5)." };
    };
    const session = await getSession();
    if (cfg.API_URL && session) {
      try {
        const res = await fetch(cfg.API_URL.replace(/\/$/, "") + "/api/listing", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ car: { ...car, photos: undefined }, tone, instructions, previous }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.description) return { text: W.sanitize(j.description, car), by: "ai" };
        return basic((j.error || "The AI writer couldn't be reached.") + " Used the basic writer.");
      } catch (_) {
        return basic("The AI writer couldn't be reached. Used the basic writer.");
      }
    }
    return basic("");
  }

  root.QuickLotStore = {
    accountMode,
    DEFAULT_SETTINGS,
    signIn,
    signOut,
    getSession,
    userEmail,
    loadSettings,
    saveSettings,
    postingStatus,
    recordPost,
    saveCar,
    listCars,
    writeListing,
  };
})(typeof self !== "undefined" ? self : globalThis);
