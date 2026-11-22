// QuickLot: DealerOn vehicle page reader.
// Injected into the dealership tab with chrome.scripting.executeScript({ files }).
// The value of the last expression (the IIFE result) is returned to the extension.
// It only reads the page the user has open. It never clicks or changes anything.

(() => {
  const num = (v) => {
    if (v === null || v === undefined) return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());

  // 1. Structured data blocks (schema.org JSON-LD).
  const ld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      (Array.isArray(j) ? j : [j]).forEach((x) => x && ld.push(x));
    } catch (_) {
      // Ignore broken blocks.
    }
  }
  const typeIs = (x, t) => [].concat(x["@type"] || []).includes(t);
  const vehicle = ld.find((x) => typeIs(x, "Vehicle") || typeIs(x, "Car")) || {};
  const product = ld.find((x) => typeIs(x, "Product")) || {};

  // 2. DealerOn's vehicle element with data-* attributes.
  const el =
    document.querySelector("[data-vin][data-odometer]") ||
    document.querySelector("[data-vin][data-year]");
  const d = el ? el.dataset : {};

  // 3. The "Vehicle Information" block as visible text, as a last resort.
  const bodyText = document.body ? document.body.innerText : "";
  const fromText = (label) => {
    const m = bodyText.match(new RegExp(label + "\\s*\\n\\s*([^\\n]+)", "i"));
    return m ? m[1].trim() : "";
  };

  const vin = clean(d.vin || vehicle.vehicleIdentificationNumber || product.productID || window.vdpVin);
  if (!vin && !d.year && !vehicle.name) {
    return { ok: false, reason: "This page doesn't look like a single vehicle on a DealerOn site." };
  }

  const offers = vehicle.offers || product.offers || {};
  const price =
    num(d.dotaggingItemPrice) ||
    num(offers.price) ||
    num(offers.priceSpecification && offers.priceSpecification.price) ||
    num(d.price);

  const mileage =
    num(d.odometer) ||
    num(vehicle.mileageFromOdometer && (vehicle.mileageFromOdometer.value || vehicle.mileageFromOdometer)) ||
    num(fromText("MILEAGE"));

  const conditionRaw = clean(offers.itemCondition || product.itemCondition);
  const path = location.pathname.toLowerCase();
  const condition = /used/i.test(conditionRaw) || path.startsWith("/used-")
    ? "used"
    : /new/i.test(conditionRaw) || path.startsWith("/new-")
      ? "new"
      : "";

  const dealerComments = clean(vehicle.description || product.description)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const highlights = [...document.querySelectorAll(".vehicle-highlights__label")]
    .map((e) => e.textContent.replace(/®|™/g, "").trim())
    .filter(Boolean);

  // Bulleted lines in the dealer comments ("- Heated seats") are useful features too.
  const commentFeatures = dealerComments
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, ""));

  const features = [...new Set([...highlights, ...commentFeatures])].slice(0, 25);

  let drivetrain = clean(d.drivetrain);
  if (!drivetrain) {
    const t = (dealerComments + " " + highlights.join(" ")).toLowerCase();
    if (/all-wheel|\bawd\b/.test(t)) drivetrain = "AWD";
    else if (/four-wheel|\b4wd\b|4x4/.test(t)) drivetrain = "4WD";
    else if (/front-wheel|\bfwd\b/.test(t)) drivetrain = "FWD";
    else if (/rear-wheel|\brwd\b/.test(t)) drivetrain = "RWD";
  }

  // Real lot photos of this car only. Stock renders live under /assets/stock/ and are skipped,
  // and so are photos of other cars ("Vehicles You Might Like") and thumbnails.
  const vinPath = "/" + vin.toLowerCase() + "/";
  const seen = new Map();
  const nodes = document.querySelectorAll("img, source, [data-src], [data-lazy]");
  for (const n of nodes) {
    const candidates = [
      n.currentSrc,
      n.src,
      n.getAttribute && n.getAttribute("data-src"),
      n.getAttribute && n.getAttribute("data-lazy"),
      ...(n.getAttribute && n.getAttribute("srcset") ? n.getAttribute("srcset").split(",") : []),
    ];
    for (const c of candidates) {
      if (!c || !/\/inventoryphotos\//i.test(c)) continue;
      const url = new URL(c.trim().split(/\s+/)[0], location.href);
      const lower = url.pathname.toLowerCase();
      if (vin && !lower.includes(vinPath)) continue;
      if (lower.includes("/thumbs/")) continue;
      const key = url.origin + lower;
      if (!seen.has(key)) seen.set(key, url.origin + url.pathname);
    }
  }
  const photoNumber = (u) => {
    const m = u.match(/\/(\d+)\.(jpe?g|png|webp)$/i);
    return m ? Number(m[1]) : 9999;
  };
  const photos = [...seen.values()]
    .sort((a, b) => photoNumber(a) - photoNumber(b))
    .map((u) => u + "?width=1280");

  return {
    ok: true,
    source: "dealeron",
    url: location.href,
    dealer: clean(window.DlronGlobal_DealerName) || "",
    city: clean(window.DlronGlobal_DealerCity) || "",
    state: clean(window.DlronGlobal_DealerState) || "",
    year: num(d.year || vehicle.vehicleModelDate || window.vdpYear),
    make: clean(d.make || (vehicle.manufacturer && vehicle.manufacturer.name) || product.brand || window.vdpMake),
    model: clean(d.model || vehicle.model || product.model || window.vdpModel),
    trim: clean(d.trim || window.vdpTrim),
    vin,
    stock: clean(d.stocknum || product.sku),
    price,
    mileage,
    condition,
    bodyType: clean(vehicle.bodyType || fromText("BODY STYLE")),
    exteriorColor: clean(d.extcolor || product.color || fromText("EXTERIOR COLOR")),
    interiorColor: clean(d.intcolor || fromText("INTERIOR COLOR")),
    transmission: clean(d.trans || fromText("TRANSMISSION")),
    engine: clean(d.engine || (vehicle.vehicleEngine && vehicle.vehicleEngine.name) || fromText("ENGINE")),
    fuelType: clean(vehicle.fuelType || fromText("FUEL TYPE")),
    drivetrain,
    mpg: fromText("CITY/HIGHWAY"),
    features,
    dealerComments,
    photos,
  };
})();
