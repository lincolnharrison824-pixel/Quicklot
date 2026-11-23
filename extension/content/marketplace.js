// QuickLot: fills Facebook Marketplace's vehicle form on the page the user opened.
// Safety rules, enforced in code:
//   - It never clicks Next, Publish, Post or anything that submits the listing.
//   - It only touches this one form page. It never reads Messenger and never sends messages.
// When a field can't be filled, it says so in the QuickLot panel so the user fills it by hand.

(async () => {
  if (window.__quicklotFilling) return;
  window.__quicklotFilling = true;

  const job = await chrome.runtime.sendMessage({ type: "getJob" });
  if (!job) return;
  const { car, description, photos } = job;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const results = []; // { field, ok, note }
  const note = (field, ok, extra) => results.push({ field, ok, note: extra || "" });

  // ---------- Safety: refuse to click anything that could submit ----------
  const FORBIDDEN = /^(next|publish|post|list|list item|submit|send)$/i;
  function safeClick(el) {
    const text = norm(el.innerText || el.getAttribute("aria-label"));
    if (FORBIDDEN.test(text)) throw new Error("QuickLot refused to click " + text);
    // Facebook's menus listen for the full press sequence, not just "click".
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.click();
  }
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  async function waitFor(fn, timeout = 4000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ---------- Finding fields by their visible label ----------
  const panel = () => document.getElementById("quicklot-panel");
  function labelElements() {
    return [...document.querySelectorAll("label")].filter((l) => !panel() || !panel().contains(l));
  }
  function labelText(l) {
    if (l.getAttribute("aria-label")) return norm(l.getAttribute("aria-label"));
    const span = l.querySelector("span");
    return norm(span ? span.textContent : l.textContent);
  }
  function findField(names) {
    const wanted = [].concat(names).map(norm);
    const labels = labelElements();
    return (
      labels.find((l) => wanted.includes(labelText(l))) ||
      labels.find((l) => wanted.some((w) => labelText(l).startsWith(w)))
    );
  }

  // ---------- Typing into text boxes React will notice ----------
  function nativeSet(input, value) {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Facebook reformats numbers as you type ("32145" shows as "$32,145"), so numbers are
  // compared by their digits only.
  function sameValue(shown, wanted) {
    if (/^\d+$/.test(String(wanted))) return String(shown).replace(/\D/g, "") === String(wanted);
    return norm(shown) === norm(wanted);
  }
  async function typeInto(input, value) {
    const shown = () => (input.isContentEditable ? input.textContent : input.value);
    input.focus();
    await sleep(50);
    if (input.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      input.select && input.select();
      const ok = document.execCommand("insertText", false, value);
      if (!ok || !sameValue(shown(), value)) nativeSet(input, value);
    }
    input.blur();
    await sleep(150);
    return sameValue(shown(), value);
  }

  // ---------- Picking from dropdowns ----------
  function visibleOptions() {
    return [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]')].filter(
      (o) => isVisible(o) && (!panel() || !panel().contains(o)),
    );
  }
  // Open a dropdown, trying the ways Facebook's menus respond: a press on the label,
  // a press on its inner box, then the keyboard.
  async function openDropdown(label) {
    // Let the previous menu finish closing, so its options aren't mistaken for this one's.
    await waitFor(() => visibleOptions().length === 0, 2000);
    const ready = () => (visibleOptions().length ? visibleOptions() : null);
    const tries = [
      () => safeClick(label),
      () => safeClick(label.querySelector('[role="button"], [aria-haspopup], div') || label),
      () => {
        label.focus();
        for (const key of ["Enter", "ArrowDown", " "]) {
          label.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : key, bubbles: true }));
        }
      },
    ];
    for (const attempt of tries) {
      attempt();
      const opts = await waitFor(ready, 1500);
      if (opts) return opts;
    }
    return null;
  }

  function scrollParent(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }

  const seenOptions = {}; // for the support report: what a failed menu actually offered
  async function choose(label, wantedList) {
    label.scrollIntoView({ block: "center" });
    await sleep(150);
    let opts = await openDropdown(label);
    if (!opts) {
      seenOptions[labelText(label)] = "menu did not open";
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return null;
    }
    const wanted = wantedList.filter(Boolean).map(norm);
    const text = (o) => norm(o.innerText);
    const match = (list) =>
      list.find((o) => wanted.includes(text(o))) ||
      list.find((o) => wanted.some((w) => text(o).startsWith(w))) ||
      list.find((o) => wanted.some((w) => w.length > 3 && text(o).includes(w)));
    let hit = match(opts);
    if (!hit) {
      // The menu may still be filling in. Look once more.
      await sleep(700);
      opts = visibleOptions();
      hit = match(opts);
    }
    if (!hit && opts.length) {
      // Long menus (like Year) only show part of the list. Scroll through it.
      const scroller = scrollParent(opts[0]);
      if (scroller) {
        scroller.scrollTop = 0;
        for (let i = 0; i < 60 && !hit; i++) {
          await sleep(120);
          hit = match(visibleOptions());
          if (hit) break;
          const before = scroller.scrollTop;
          scroller.scrollTop += Math.max(120, scroller.clientHeight * 0.8);
          if (scroller.scrollTop === before) {
            await sleep(150);
            hit = match(visibleOptions());
            break;
          }
        }
        if (hit) hit.scrollIntoView({ block: "center" });
      }
    }
    if (!hit) {
      seenOptions[labelText(label)] = visibleOptions().slice(0, 15).map((o) => o.innerText.trim().slice(0, 30));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      safeClick(label); // close the list
      await sleep(150);
      return null;
    }
    const chosen = hit.innerText.trim();
    safeClick(hit);
    await sleep(300);
    return chosen;
  }

  // Fill one field, whether Facebook shows it as a dropdown or a text box.
  async function fill(fieldNames, value, options = {}) {
    const name = [].concat(fieldNames)[0];
    if (value === null || value === undefined || value === "") {
      note(name, false, options.missing || "Not on the dealer page. Please fill it in.");
      return false;
    }
    const label = findField(fieldNames);
    if (!label) {
      note(name, false, "Couldn't find this field. Please check it.");
      return false;
    }
    const input = label.querySelector("input:not([type=file]), textarea, [contenteditable=true]");
    const isDropdown = label.getAttribute("role") === "combobox" || !input || input.getAttribute("role") === "combobox";
    try {
      if (isDropdown && options.choices !== false) {
        const chosen = await choose(label, [].concat(options.choices || value));
        if (chosen) {
          // Dropdowns with a search box: some only show options after typing.
          note(name, true, chosen);
          return true;
        }
        if (input) {
          const ok = await typeInto(input, String(value));
          await sleep(500);
          const opt = visibleOptions().find((o) => norm(o.innerText).startsWith(norm(value)));
          if (opt) {
            safeClick(opt);
            note(name, true, opt.innerText.trim());
            return true;
          }
          note(name, ok, ok ? String(value) : "Please pick this one.");
          return ok;
        }
        note(name, false, "Please pick this one.");
        return false;
      }
      if (!input) {
        note(name, false, "Couldn't type into this field. Please fill it in.");
        return false;
      }
      const ok = await typeInto(input, String(value));
      note(name, ok, ok ? (options.show === false ? "" : String(value)) : "Please check this one.");
      return ok;
    } catch (e) {
      note(name, false, String(e.message || e));
      return false;
    }
  }

  // ---------- Photos ----------
  async function addPhotos() {
    if (!photos || !photos.length) {
      note("Photos", false, car.stockPhotosOnly
        ? "This car has no lot photos on the dealer's site yet, only stock pictures. Add your own photos."
        : "No photos came through. Add them by hand.");
      return;
    }
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"]'), 5000);
    if (!input) {
      note("Photos", false, "Couldn't find the photo upload. Add them by hand.");
      return;
    }
    const dt = new DataTransfer();
    for (const p of photos) {
      const bin = atob(p.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], p.name, { type: p.type }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    note("Photos", true, `${photos.length} added. Check they all uploaded.`);
    await sleep(1500);
  }

  // ---------- Mapping dealer wording to Marketplace's choices ----------
  const FB_COLORS = ["Black", "Blue", "Brown", "Gold", "Green", "Grey", "Pink", "Purple", "Red", "Silver", "Orange", "White", "Yellow", "Charcoal", "Off white", "Tan", "Beige", "Burgundy", "Turquoise"];
  function mapColor(c) {
    const t = norm(c);
    if (!t) return null;
    const alias = [
      [/gr[ae]y|gunmetal|graphite|slate/, "Grey"],
      [/silver|platinum|metallic gray/, "Silver"],
      [/white|pearl|snow|ivory|cream/, t.includes("off") ? "Off white" : "White"],
      [/charcoal/, "Charcoal"],
      [/maroon|burgundy|wine|merlot/, "Burgundy"],
      [/beige|sand|parchment|camel/, "Beige"],
      [/tan|saddle|cognac|brown|mocha|espresso|chestnut/, t.includes("tan") ? "Tan" : "Brown"],
      [/navy|blue|azure|cobalt/, "Blue"],
      [/green|olive|emerald|forest/, "Green"],
      [/red|crimson|ruby|scarlet/, "Red"],
      [/black|ebony|onyx|obsidian|jet/, "Black"],
      [/gold|champagne|bronze/, "Gold"],
      [/orange|copper/, "Orange"],
      [/yellow/, "Yellow"],
      [/purple|violet/, "Purple"],
    ];
    const exact = FB_COLORS.find((x) => norm(x) === t);
    if (exact) return exact;
    for (const [re, name] of alias) if (re.test(t)) return name;
    return null;
  }
  // Facebook spells some colors differently by region ("Gray" in the US, "Grey" elsewhere).
  function colorVariants(c) {
    if (!c) return undefined;
    const v = [c];
    if (c === "Grey") v.push("Gray");
    if (c === "Off white") v.push("Off-white", "Off White");
    return v;
  }
  function mapBody(b) {
    const t = norm(b);
    if (!t) return null;
    if (/suv|sport utility|crossover/.test(t)) return "SUV";
    if (/pickup|truck|crew cab/.test(t)) return "Truck";
    if (/sedan/.test(t)) return "Sedan";
    if (/coupe/.test(t)) return "Coupe";
    if (/hatch/.test(t)) return "Hatchback";
    if (/convertible|cabrio/.test(t)) return "Convertible";
    if (/wagon/.test(t)) return "Wagon";
    if (/minivan|van/.test(t)) return "Minivan";
    return "Other";
  }
  function mapFuel(f) {
    const t = norm(f);
    if (!t) return null;
    if (/plug/.test(t)) return ["Plug-in hybrid", "Plug-in Hybrid"];
    if (/hybrid/.test(t)) return ["Hybrid"];
    if (/electric/.test(t)) return ["Electric"];
    if (/diesel/.test(t)) return ["Diesel"];
    if (/flex/.test(t)) return ["Flex"];
    return ["Gasoline", "Gas", "Petrol"];
  }
  const mapTrans = (t) => (/manual/i.test(t || "") ? ["Manual transmission", "Manual"] : t ? ["Automatic transmission", "Automatic"] : null);

  // ---------- A short report the user can paste back if fields fail ----------
  function diagnostics() {
    const labels = labelElements().filter(isVisible).map((l) => ({
      text: labelText(l).slice(0, 40),
      role: l.getAttribute("role") || "",
      hasInput: Boolean(l.querySelector("input:not([type=file]), textarea, [contenteditable=true]")),
    }));
    return JSON.stringify({
      quicklot: chrome.runtime.getManifest().version,
      url: location.pathname,
      results: results.map((r) => [r.field, r.ok ? "ok" : "check", r.note.slice(0, 60)]),
      labels,
      seenOptions,
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      comboboxes: document.querySelectorAll('[role="combobox"]').length,
    });
  }

  // ---------- The panel that tells the user what happened ----------
  function showPanel(done) {
    let el = panel();
    if (!el) {
      el = document.createElement("div");
      el.id = "quicklot-panel";
      el.style.cssText = [
        "position:fixed", "right:20px", "bottom:20px", "z-index:2147483647", "width:340px", "max-height:70vh", "overflow:auto",
        "background:#fff", "color:#111827", "border:1px solid #e5e7eb", "border-radius:14px", "box-shadow:0 12px 32px rgba(0,0,0,.18)",
        "font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif", "padding:18px",
      ].join(";");
      document.body.appendChild(el);
    }
    const rows = results
      .map((r) => `<div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid #f3f4f6">
          <span style="flex:none;width:58px;font-weight:600;color:${r.ok ? "#047857" : "#b45309"}">${r.ok ? "Filled" : "Check"}</span>
          <span><b style="font-weight:600">${r.field}</b>${r.note ? `<br><span style="color:#4b5563">${escapeHtml(r.note)}</span>` : ""}</span>
        </div>`)
      .join("");
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:16px">QuickLot</strong>
        <button id="quicklot-close" style="border:0;background:none;font-size:13px;color:#6b7280;cursor:pointer">Hide</button>
      </div>
      <div style="margin-bottom:10px;color:#374151">${done ? "Done filling. Review every field, then click Next and Publish yourself. QuickLot never posts for you." : "Filling the form. Please wait..."}</div>
      ${rows}
      ${done ? `<button id="quicklot-copy" style="margin-top:12px;width:100%;padding:10px;border-radius:10px;border:1px solid #d1d5db;background:#f9fafb;font-weight:600;cursor:pointer">Copy description</button>
        <button id="quicklot-report" style="margin-top:8px;width:100%;padding:10px;border-radius:10px;border:1px solid #d1d5db;background:#fff;color:#4b5563;cursor:pointer">Copy report for QuickLot support</button>` : ""}`;
    el.querySelector("#quicklot-close").onclick = () => el.remove();
    const copy = el.querySelector("#quicklot-copy");
    if (copy) copy.onclick = async () => {
      await navigator.clipboard.writeText(description);
      copy.textContent = "Copied";
    };
    const rep = el.querySelector("#quicklot-report");
    if (rep) rep.onclick = async () => {
      await navigator.clipboard.writeText(diagnostics());
      rep.textContent = "Copied. Paste it into your QuickLot chat.";
    };
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // ---------- Fill, top to bottom ----------
  showPanel(false);
  await waitFor(() => findField(["Vehicle type"]), 10000);

  await fill("Vehicle type", "Car/Truck", { choices: ["Car/Truck", "Car/truck", "Car / Truck"] });
  await sleep(800); // the rest of the form appears after the vehicle type is chosen

  // Facebook's optional VIN box (the description never includes the VIN).
  if (car.vin && findField(["VIN"])) await fill("VIN", car.vin, { choices: false });

  await addPhotos();
  await fill("Year", car.year ? String(car.year) : "");
  await fill("Make", car.make);
  await fill("Model", car.model, { choices: false });
  if (car.trim && findField(["Trim"])) await fill("Trim", car.trim, { choices: false });
  await fill("Mileage", car.mileage ? String(Math.round(car.mileage)) : "", { missing: "Not on the dealer page. Please type the miles.", choices: false });
  await fill("Price", car.price ? String(Math.round(car.price)) : "", { missing: "No price on the dealer page. Please type it.", choices: false });
  await fill("Body style", mapBody(car.bodyType));
  for (const [fieldNames, raw] of [
    [["Exterior color", "Exterior colour"], car.exteriorColor],
    [["Interior color", "Interior colour"], car.interiorColor],
  ]) {
    const c = mapColor(raw);
    await fill(fieldNames, c, { choices: colorVariants(c), missing: `Pick the closest color to "${raw || "unknown"}".` });
  }
  const fuel = mapFuel(car.fuelType);
  await fill(["Fuel type", "Fuel"], fuel ? fuel[0] : "", { choices: fuel || undefined });
  const trans = mapTrans(car.transmission);
  await fill("Transmission", trans ? trans[0] : "", { choices: trans || undefined });
  note("Vehicle condition", false, "Pick this yourself. QuickLot doesn't guess condition.");
  note("Clean title", false, "Tick this only if the title is clean.");
  await fill("Description", description, { choices: false, show: false });

  showPanel(true);
  chrome.runtime.sendMessage({ type: "jobDone" });
})();
