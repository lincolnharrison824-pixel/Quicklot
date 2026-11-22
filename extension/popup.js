// QuickLot popup: sign-in, first-time setup, and the one-button posting flow.

const S = self.QuickLotStore;
const W = self.QuickLotWriter;
const view = document.getElementById("view");
const navCars = document.getElementById("nav-cars");
const navSettings = document.getElementById("nav-settings");

let settings = null;
let car = null;
let draft = { description: "", by: "" };

const esc = (s) =>
  String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => (n ? "$" + Math.round(n).toLocaleString("en-US") : "");
const miles = (n) => (n ? Math.round(n).toLocaleString("en-US") : "");

function applyTheme(s) {
  document.body.dataset.theme = s.theme || "light";
  document.body.dataset.accent = s.accent || "blue";
}

function render(html) {
  view.innerHTML = html;
}

function showNav(on) {
  navCars.hidden = !on;
  navSettings.hidden = !on;
}

// ---------- Start ----------

async function start() {
  if (S.accountMode && !(await S.getSession())) return renderSignIn();
  settings = await S.loadSettings();
  applyTheme(settings);
  if (!settings.setup_done || !settings.risk_accepted_at) return renderSetupRisk();
  showNav(true);
  renderMain();
}

// ---------- Sign in ----------

function renderSignIn(error) {
  showNav(false);
  render(`
    <h1>Sign in</h1>
    <p>QuickLot saves your settings and your cars to your account.</p>
    <button class="btn" id="google">Continue with Google</button>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}`);
  document.getElementById("google").onclick = async () => {
    try {
      await S.signIn();
      start();
    } catch (e) {
      renderSignIn(e.message || "Sign-in didn't finish. Try again.");
    }
  };
}

// ---------- First-time setup ----------

function renderSetupRisk() {
  showNav(false);
  render(`
    <h1>Before you start</h1>
    <div class="warn">
      QuickLot fills in Marketplace listings on your personal Facebook profile. Facebook can limit or
      restrict accounts that post a lot or that it thinks are automated. Nobody can promise your account
      won't be restricted, including us.
    </div>
    <p>To lower the risk, QuickLot never posts for you. You review and click Publish on every listing,
      and it limits how many cars you post a day and spaces them out.</p>
    <label class="check"><input type="checkbox" id="agree" /> <span>I understand the risk to my Facebook account.</span></label>
    <button class="btn" id="next" disabled>Continue</button>`);
  const agree = document.getElementById("agree");
  const next = document.getElementById("next");
  agree.onchange = () => (next.disabled = !agree.checked);
  next.onclick = async () => {
    settings = await S.saveSettings({ risk_accepted_at: new Date().toISOString() });
    renderSetupTone();
  };
}

const TONE_SAMPLES = {
  friendly: "Just got this one in and it's a really nice SUV. Message me and I'll get you set up to see it.",
  direct: "2023 GV70, 46k miles, $32,145. Leather, sunroof, AWD. Message me to see it.",
  energy: "This GV70 is a great one! Loaded and ready to go. Message me today!",
};

function renderSetupTone() {
  render(`
    <h1>How do you write?</h1>
    <p>QuickLot writes your listings in this style. You can change it later.</p>
    <div class="choices">
      ${Object.entries(W.TONES)
        .map(([key, name]) => `<button class="choice" data-tone="${key}" aria-pressed="${settings.tone === key}"><b>${name}</b><span>${esc(TONE_SAMPLES[key])}</span></button>`)
        .join("")}
    </div>
    <button class="btn" id="next">Continue</button>`);
  view.querySelectorAll("[data-tone]").forEach((b) => {
    b.onclick = () => {
      settings.tone = b.dataset.tone;
      view.querySelectorAll("[data-tone]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    };
  });
  document.getElementById("next").onclick = async () => {
    settings = await S.saveSettings({ tone: settings.tone });
    renderSetupTheme();
  };
}

const ACCENTS = { blue: "#2563eb", green: "#15803d", red: "#dc2626", graphite: "#374151" };

function themePicker() {
  return `
    <h2>Look</h2>
    <div class="row">
      <button class="choice" data-theme-pick="light" aria-pressed="${settings.theme === "light"}"><b>Light</b></button>
      <button class="choice" data-theme-pick="dark" aria-pressed="${settings.theme === "dark"}"><b>Dark</b></button>
    </div>
    <h2>Accent color</h2>
    <div class="row">
      ${Object.entries(ACCENTS)
        .map(([k, c]) => `<button class="swatch" data-accent-pick="${k}" aria-label="${k}" aria-pressed="${settings.accent === k}" style="background:${c}"></button>`)
        .join("")}
    </div>`;
}

function wireThemePicker() {
  view.querySelectorAll("[data-theme-pick]").forEach((b) => {
    b.onclick = () => {
      settings.theme = b.dataset.themePick;
      view.querySelectorAll("[data-theme-pick]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      applyTheme(settings);
    };
  });
  view.querySelectorAll("[data-accent-pick]").forEach((b) => {
    b.onclick = () => {
      settings.accent = b.dataset.accentPick;
      view.querySelectorAll("[data-accent-pick]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      applyTheme(settings);
    };
  });
}

function renderSetupTheme() {
  render(`
    <h1>Pick your look</h1>
    ${themePicker()}
    <button class="btn" id="done">Finish setup</button>`);
  wireThemePicker();
  document.getElementById("done").onclick = async () => {
    settings = await S.saveSettings({ theme: settings.theme, accent: settings.accent, setup_done: true });
    showNav(true);
    renderMain();
  };
}

// ---------- Main: read the car on this tab ----------

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) return { ok: false, reason: "Open a car on your dealership's website first." };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/reader-dealeron.js"] });
    return res && res.result ? res.result : { ok: false, reason: "Couldn't read this page." };
  } catch (_) {
    return { ok: false, reason: "QuickLot can't read this page. Open a car on your dealership's website." };
  }
}

async function postingLine() {
  const st = await S.postingStatus();
  let line = `${st.usedToday} of ${st.cap} posts used today.`;
  if (st.capReached) line = `You've used all ${st.cap} posts for today.`;
  else if (st.waitUntil) line += ` Next one at ${new Date(st.waitUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  return { st, line };
}

async function renderMain() {
  render(`<p>Reading this page...</p>`);
  const result = await readActiveTab();
  if (!result.ok) {
    render(`
      <h1>Open a car first</h1>
      <p>${esc(result.reason)}</p>
      <p class="muted">Go to a vehicle on your dealership's website, then click QuickLot again.</p>
      ${S.accountMode ? "" : `<p class="muted">Local mode: not signed in. Listings use the basic writer.</p>`}`);
    return;
  }
  car = result;
  draft = { description: "", by: "" };
  renderCar();
}

function renderCar(error) {
  const title = W.buildTitle(car);
  const needPrice = !car.price;
  const needMiles = !car.mileage;
  render(`
    <h1>${esc(title)}</h1>
    <div class="card">
      <div class="facts">
        <div><span>Price</span><b>${car.price ? esc(money(car.price)) : "Not shown"}</b></div>
        <div><span>Miles</span><b>${car.mileage ? esc(miles(car.mileage)) : "Not shown"}</b></div>
        <div><span>Color</span><b>${esc(car.exteriorColor || "Not shown")}</b></div>
        <div><span>Photos</span><b>${car.photos.length ? Math.min(car.photos.length, 20) + (car.photos.length > 20 ? " of " + car.photos.length : "") : car.stockPhotosOnly ? "Stock only" : "None found"}</b></div>
      </div>
    </div>
    ${!car.photos.length ? `<div class="warn">${car.stockPhotosOnly ? "The dealer site only has stock pictures for this car, not real photos." : "No photos found on this page."} You'll need to add photos on Marketplace yourself.</div>` : ""}
    ${needPrice ? `<label class="field">Asking price<input type="number" id="price" placeholder="e.g. 32145" /></label>` : ""}
    ${needMiles ? `<label class="field">Miles<input type="number" id="miles" placeholder="e.g. 46696" /></label>` : ""}
    ${draft.description
      ? `<label class="field">Description <span class="muted">(edit anything you like)</span><textarea id="desc">${esc(draft.description)}</textarea></label>
         ${draft.note ? `<p class="muted">${esc(draft.note)}</p>` : ""}
         <label class="field">What should change? <span class="muted">(optional)</span>
           <textarea id="changes" class="short" maxlength="400" placeholder="For example: make it shorter, mention it's a one-owner, sound more excited"></textarea></label>
         <div class="row"><button class="btn secondary" id="rewrite">Rewrite</button></div>
         <button class="btn" id="fill">Fill Marketplace</button>
         <p class="muted" id="posting"></p>`
      : `<button class="btn" id="write">Write listing</button>`}
    ${error ? `<div class="error">${esc(error)}</div>` : ""}`);

  const takeInputs = () => {
    const p = document.getElementById("price");
    const m = document.getElementById("miles");
    if (p && Number(p.value) > 0) car.price = Number(p.value);
    if (m && Number(m.value) > 0) car.mileage = Number(m.value);
    if (!car.price) return "Type the asking price first. Marketplace needs it.";
    if (!car.mileage) return "Type the miles first. Marketplace needs them.";
    return "";
  };

  const write = async (rewrite) => {
    const problem = takeInputs();
    if (problem) return renderCar(problem);
    const changesEl = document.getElementById("changes");
    const descEl = document.getElementById("desc");
    const instructions = rewrite && changesEl ? changesEl.value.trim().slice(0, 400) : "";
    const previous = rewrite && descEl ? descEl.value : "";
    render(`<p>${rewrite ? "Rewriting" : "Writing"} your listing...</p>`);
    const out = await S.writeListing(car, settings.tone, instructions, previous);
    draft = { description: out.text, by: out.by, note: out.note };
    renderCar();
  };

  const w = document.getElementById("write");
  if (w) w.onclick = () => write(false);
  const r = document.getElementById("rewrite");
  if (r) r.onclick = () => write(true);

  const f = document.getElementById("fill");
  if (f) {
    postingLine().then(({ st, line }) => {
      const el = document.getElementById("posting");
      if (el) el.textContent = line;
      if (st.capReached || st.waitUntil) f.disabled = true;
    });
    f.onclick = async () => {
      const problem = takeInputs();
      if (problem) return renderCar(problem);
      const description = W.sanitize(document.getElementById("desc").value, car);
      if (!description) return renderCar("The description is empty.");
      f.disabled = true;
      f.textContent = "Opening Marketplace...";
      const res = await chrome.runtime.sendMessage({ type: "startFill", car, title, description });
      if (!res || !res.ok) {
        draft.description = description;
        return renderCar((res && res.error) || "Something went wrong. Try again.");
      }
      window.close();
    };
  }
}

// ---------- My cars ----------

async function renderCars() {
  render(`<p>Loading...</p>`);
  const cars = await S.listCars();
  render(`
    <h1>My cars</h1>
    ${cars.length
      ? cars
          .map((c, i) => `<div class="list-item"><b>${esc(c.title)}</b>
            <span class="muted">${[money(c.price), c.mileage ? miles(c.mileage) + " miles" : "", new Date(c.created_at).toLocaleDateString()].filter(Boolean).map(esc).join(" · ")}</span>
            <div><button class="link" data-copy="${i}">Copy description</button></div></div>`)
          .join("")
      : `<p>Cars you post will show up here.</p>`}
    <button class="btn secondary" id="back">Back</button>`);
  view.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      await navigator.clipboard.writeText(cars[Number(b.dataset.copy)].description || "");
      b.textContent = "Copied";
    };
  });
  document.getElementById("back").onclick = renderMain;
}

// ---------- Settings ----------

async function renderSettings(message) {
  const email = S.accountMode ? await S.userEmail() : "";
  render(`
    <h1>Settings</h1>
    <h2>Writing style</h2>
    <div class="choices">
      ${Object.entries(W.TONES).map(([k, n]) => `<button class="choice" data-tone="${k}" aria-pressed="${settings.tone === k}"><b>${n}</b></button>`).join("")}
    </div>
    ${themePicker()}
    <h2>Posting limits</h2>
    <label class="field">Most posts per day (1 to 10)<input type="number" id="cap" min="1" max="10" value="${esc(settings.daily_cap)}" /></label>
    <label class="field">Minutes between posts (at least 5)<input type="number" id="spacing" min="5" max="240" value="${esc(settings.spacing_minutes)}" /></label>
    <button class="btn" id="save">Save</button>
    ${message ? `<p class="muted">${esc(message)}</p>` : ""}
    ${S.accountMode ? `<p class="muted" style="margin-top:16px">Signed in${email ? " as " + esc(email) : ""}.</p><button class="link" id="signout">Sign out</button>` : `<p class="muted" style="margin-top:16px">Local mode: settings are saved in this browser only.</p>`}`);
  view.querySelectorAll("[data-tone]").forEach((b) => {
    b.onclick = () => {
      settings.tone = b.dataset.tone;
      view.querySelectorAll("[data-tone]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    };
  });
  wireThemePicker();
  document.getElementById("save").onclick = async () => {
    settings = await S.saveSettings({
      tone: settings.tone,
      theme: settings.theme,
      accent: settings.accent,
      daily_cap: document.getElementById("cap").value,
      spacing_minutes: document.getElementById("spacing").value,
    });
    renderSettings("Saved.");
  };
  const so = document.getElementById("signout");
  if (so) so.onclick = async () => {
    await S.signOut();
    start();
  };
}

navCars.onclick = renderCars;
navSettings.onclick = () => renderSettings();

start().catch((e) => render(`<div class="error">${esc(e.message || e)}</div>`));
