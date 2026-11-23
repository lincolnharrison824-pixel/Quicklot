// QuickLot: vehicle page reader for dealership websites.
// Injected into the dealership tab with chrome.scripting.executeScript({ files }).
// The value of the last expression (the IIFE result) is returned to the extension.
// It only reads the page the user has open. It never clicks or changes anything.
//
// Dealer websites are built by a handful of companies, and most of them publish the car's details
// in standard places. This reader checks those places in order of how reliable they are:
//   1. DealerOn's vehicle element (data-vin, data-odometer, ...)
//   2. Dealer.com's data layer (window.DDC.dataLayer.vehicles)
//   3. The auto industry's shared analytics data (window.asc_datalayer), used by many site companies
//   4. Search-engine data blocks (schema.org JSON-LD: Car / Vehicle / Product / Offer)
//   5. The visible page text ("Mileage: 74,932", "Exterior Color", the page heading, a VIN anywhere)
// Whatever is still missing, the popup asks the salesperson for.

(() => {
  const num = (v) => {
    if (v === null || v === undefined || typeof v === "object") return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const clean = (v) => {
    if (v === null || v === undefined || typeof v === "object") return "";
    const s = String(v).trim();
    return /^(null|undefined|n\/a|na|none|unknown|-)$/i.test(s) ? "" : s;
  };
  const pick = (...vals) => {
    for (const v of vals) {
      const c = clean(v);
      if (c) return c;
    }
    return "";
  };
  const pickNum = (...vals) => {
    for (const v of vals) {
      const n = num(v);
      if (n) return n;
    }
    return null;
  };
  const nameOf = (v) => (v && typeof v === "object" ? v.name : v);
  // "ford" -> "Ford", but leave "BMW", "GMC" and "F-150" alone.
  const titleCase = (s) =>
    s && s === s.toLowerCase() ? s.replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s;
  const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/;
  const isVin = (v) => VIN_RE.test(String(v || "").toUpperCase()) && /\d/.test(v) && /[A-Z]/i.test(v);

  // ---------- 1. DealerOn ----------
  const dEl =
    document.querySelector("[data-vin][data-odometer]") ||
    document.querySelector("[data-vin][data-year]");
  const d = dEl ? dEl.dataset : {};

  // ---------- 2. Dealer.com ----------
  let ddc = {};
  try {
    const list = window.DDC && window.DDC.dataLayer && window.DDC.dataLayer.vehicles;
    if (Array.isArray(list) && list.length === 1) ddc = list[0] || {};
  } catch (_) {}

  // ---------- 3. Shared auto analytics data (ASC) ----------
  let asc = {};
  try {
    const items = window.asc_datalayer && window.asc_datalayer.items;
    if (Array.isArray(items) && items.length === 1) asc = items[0] || {};
  } catch (_) {}

  // ---------- 4. JSON-LD ----------
  const ld = [];
  const pushLd = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(pushLd);
    ld.push(x);
    if (Array.isArray(x["@graph"])) x["@graph"].forEach(pushLd);
    if (x.mainEntity) pushLd(x.mainEntity);
    if (x.itemOffered) pushLd(x.itemOffered);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      pushLd(JSON.parse(s.textContent));
    } catch (_) {
      // Ignore broken blocks.
    }
  }
  const types = (x) => [].concat(x["@type"] || []).map(String);
  const isCarType = (x) => types(x).some((t) => /^(Car|Vehicle|Motorcycle|MotorizedBicycle|BusOrCoach)$/i.test(t));
  // Some sites list several cars ("similar vehicles"); only trust the block when there is one car,
  // or when its VIN shows up in the page address.
  const carBlocks = ld.filter(isCarType);
  const urlUpper = location.href.toUpperCase();
  const vehicle =
    carBlocks.find((x) => x.vehicleIdentificationNumber && urlUpper.includes(String(x.vehicleIdentificationNumber).toUpperCase())) ||
    (carBlocks.length === 1 ? carBlocks[0] : {}) ||
    {};
  const products = ld.filter((x) => types(x).includes("Product") && !isCarType(x));
  const product = products.length === 1 ? products[0] : {};
  const offersRaw = vehicle.offers || product.offers || {};
  const offers = Array.isArray(offersRaw) ? offersRaw[0] || {} : offersRaw;
  const dealerBlock = ld.find((x) => types(x).includes("AutoDealer")) || {};
  const seller = [offers.seller, vehicle.seller, dealerBlock].find((x) => x && x.name) || {};
  const sellerAddr = seller.address || {};

  // ---------- 5. Visible page text ----------
  const bodyText = document.body ? document.body.innerText : "";
  // Finds "Label: value" or "Label\nvalue" in the visible text.
  const fromText = (labels) => {
    for (const label of [].concat(labels)) {
      const m = bodyText.match(new RegExp("(?:^|\\n)\\s*" + label + "\\s*:?[ \\t]*\\n?[ \\t]*([^\\n]{1,60})", "i"));
      const v = m ? clean(m[1].replace(/^[\s:.\-–#]+/, "")) : "";
      if (v) return v;
    }
    return "";
  };
  const heading = clean(document.querySelector("h1") && document.querySelector("h1").innerText).replace(/\s+/g, " ");
  // "Used 2021 Ford Expedition Limited" -> year 2021, rest "Ford Expedition Limited"
  const headMatch = (heading || document.title).match(/\b(19[5-9]\d|20[0-4]\d)\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)\s+([^|\n]+)/);

  // ---------- VIN ----------
  let vin = pick(
    d.vin,
    ddc.vin,
    isVin(asc.item_id) ? asc.item_id : "",
    vehicle.vehicleIdentificationNumber,
    isVin(product.productID) ? product.productID : "",
    window.vdpVin,
    (fromText(["VIN", "VIN #", "VIN Number"]).toUpperCase().match(VIN_RE) || [""])[0]
  ).toUpperCase();
  if (!vin) {
    const m = urlUpper.match(VIN_RE) || document.title.toUpperCase().match(VIN_RE);
    if (m && isVin(m[0])) vin = m[0];
  }
  if (!vin) {
    // A VIN anywhere in the text, but only when exactly one shows up (other cars' VINs mean we can't tell).
    const all = [...new Set((bodyText.toUpperCase().match(new RegExp(VIN_RE.source, "g")) || []).filter(isVin))];
    if (all.length === 1) vin = all[0];
  }

  // ---------- Year / make / model / trim ----------
  const year = pickNum(
    d.year,
    ddc.modelYear || ddc.year,
    asc.item_year,
    vehicle.vehicleModelDate,
    vehicle.modelDate,
    vehicle.productionDate && String(vehicle.productionDate).slice(0, 4),
    vehicle.releaseDate && String(vehicle.releaseDate).slice(0, 4),
    window.vdpYear,
    headMatch && headMatch[1]
  );
  let make = pick(
    d.make,
    ddc.make,
    nameOf(vehicle.manufacturer),
    nameOf(vehicle.brand),
    nameOf(product.brand),
    window.vdpMake,
    titleCase(clean(asc.item_make))
  );
  let model = pick(
    d.model,
    ddc.model,
    nameOf(vehicle.model),
    nameOf(product.model),
    window.vdpModel,
    titleCase(clean(asc.item_model))
  );
  let trim = pick(
    d.trim,
    ddc.trim,
    vehicle.vehicleConfiguration,
    window.vdpTrim,
    asc.item_variant && titleCase(clean(asc.item_variant))
  );
  // Fall back to the page heading: "2021 Ford Expedition Limited".
  if (headMatch && (!make || !model)) {
    const rest = headMatch[2] + " " + headMatch[3];
    const words = rest.trim().split(/\s+/);
    if (!make) make = words[0];
    if (!model) {
      const afterMake = rest.trim().slice(rest.toLowerCase().indexOf(make.toLowerCase()) + make.length).trim().split(/\s+/);
      model = afterMake[0] || "";
      if (!trim) trim = afterMake.slice(1).join(" ").replace(/\s+for sale.*$/i, "").slice(0, 40);
    }
  }
  // Don't repeat the make inside the model ("Ford Expedition").
  if (make && model.toLowerCase().startsWith(make.toLowerCase() + " ")) model = model.slice(make.length + 1);

  if (!vin && !(year && make && model)) {
    return { ok: false, reason: "This page doesn't look like a single car for sale." };
  }

  // ---------- Price ----------
  // Dealer.com shows both a "Price" and an "Internet Price"; use the lower one the shopper sees.
  const ddcPrices = [ddc.askingPrice, ddc.internetPrice, ddc.salePrice].map(num).filter((n) => n && n >= 500);
  const price =
    num(d.dotaggingItemPrice) ||
    (ddcPrices.length ? Math.min(...ddcPrices) : null) ||
    (num(asc.item_price) >= 500 ? num(asc.item_price) : null) ||
    num(offers.price) ||
    num(offers.lowPrice) ||
    num(offers.priceSpecification && offers.priceSpecification.price) ||
    num(d.price) ||
    null;

  // ---------- Miles ----------
  const odo = vehicle.mileageFromOdometer;
  let mileage =
    num(d.odometer) ||
    num(ddc.odometer) ||
    num(odo && typeof odo === "object" ? odo.value : odo) ||
    num((fromText(["Mileage", "Miles", "Odometer"]).match(/^[\d,]+/) || [""])[0]);
  if (!mileage) {
    // "81,701 mi." near the top of the page.
    const m = bodyText.slice(0, 6000).match(/\b(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(?:mi\.?|miles)\b(?!\s*per)/i);
    if (m) mileage = num(m[1]);
  }

  // ---------- New or used ----------
  const condText = [
    d.condition,
    ddc.newOrUsed || ddc.inventoryType,
    asc.item_condition,
    offers.itemCondition,
    vehicle.itemCondition,
    product.itemCondition,
  ]
    .map(clean)
    .join(" ");
  const path = location.pathname.toLowerCase();
  const condition = /used|pre-?owned|certified|cpo/i.test(condText) || /(^|[\/-])(used|pre-owned|certified)[\/-]/.test(path)
    ? "used"
    : /\bnew\b|newcondition/i.test(condText) || /(^|[\/-])new[\/-]/.test(path)
      ? "new"
      : /^used\b/i.test(heading)
        ? "used"
        : /^new\b/i.test(heading)
          ? "new"
          : "";

  // ---------- Description and features ----------
  const dealerComments = pick(vehicle.description, product.description, ddc.comments)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Placeholder text some sites leave in the data block.
  const comments = /^description$/i.test(dealerComments) ? "" : dealerComments;

  const highlightSelectors = [
    ".vehicle-highlights__label", // DealerOn
    "[class*='highlight'] li",
    "[class*='feature'] li",
    "[class*='Feature'] li",
    "[class*='option'] li",
  ];
  let highlights = [];
  for (const sel of highlightSelectors) {
    highlights = [...document.querySelectorAll(sel)]
      .map((e) => e.textContent.replace(/®|™/g, "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 60);
    if (highlights.length >= 3) break;
  }
  const ddcFeatures = Array.isArray(ddc.features)
    ? ddc.features.map((f) => clean(typeof f === "object" ? f.name || f.title : f)).filter(Boolean)
    : [];
  const commentFeatures = comments
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•*]+\s*/.test(l) && l.length < 80)
    .map((l) => l.replace(/^[-•*]+\s*/, "").replace(/®|™/g, ""));
  const features = [...new Set([...highlights, ...ddcFeatures, ...commentFeatures])].slice(0, 25);

  // ---------- Drivetrain ----------
  let drivetrain = pick(d.drivetrain, ddc.driveLine, fromText(["Drivetrain", "Drive Train", "Drive Type", "Drive"]));
  const dwc = clean(vehicle.driveWheelConfiguration);
  // Either a schema.org address ("https://schema.org/AllWheelDriveConfiguration") or plain words.
  if (!drivetrain && dwc) drivetrain = dwc.replace(/^https?:\/\/schema\.org\//i, "").replace(/Configuration$/, "");
  if (!drivetrain) {
    const t = (comments + " " + highlights.join(" ") + " " + trim).toLowerCase();
    if (/all-wheel|all wheel|\bawd\b/.test(t)) drivetrain = "AWD";
    else if (/four-wheel|four wheel|\b4wd\b|4x4/.test(t)) drivetrain = "4WD";
    else if (/front-wheel|front wheel|\bfwd\b/.test(t)) drivetrain = "FWD";
    else if (/rear-wheel|rear wheel|\brwd\b/.test(t)) drivetrain = "RWD";
  }
  // "Four Wheel Drive" -> "4WD" and so on, so Marketplace and the writer get the short form.
  if (/all[\s-]?wheel|\bawd\b/i.test(drivetrain)) drivetrain = "AWD";
  else if (/four[\s-]?wheel|\b4wd\b|4x4/i.test(drivetrain)) drivetrain = "4WD";
  else if (/front[\s-]?wheel|\bfwd\b/i.test(drivetrain)) drivetrain = "FWD";
  else if (/rear[\s-]?wheel|\brwd\b/i.test(drivetrain)) drivetrain = "RWD";
  drivetrain = drivetrain.slice(0, 30);

  // ---------- MPG ----------
  let mpg = fromText(["CITY/HIGHWAY", "MPG City/Hwy", "City/Hwy"]);
  if (!mpg && num(ddc.cityFuelEfficiency) && num(ddc.highwayFuelEfficiency)) {
    mpg = `${num(ddc.cityFuelEfficiency)}/${num(ddc.highwayFuelEfficiency)}`;
  }
  if (!mpg && Array.isArray(vehicle.fuelEfficiency) && vehicle.fuelEfficiency.length >= 2) {
    const vals = vehicle.fuelEfficiency.map((f) => num(f && f.value)).filter(Boolean);
    if (vals.length >= 2) mpg = `${vals[0]}/${vals[1]}`;
  }

  // ---------- Photos ----------
  // Real lot photos of this car only: no stock renders, logos, or photos of other cars.
  const STOCK_RE = /stock[_-]?(images?|photos?|asset)|\/assets\/stock\/|stockphoto|evox|chromedata|izmo|colors_png|\/oem\/|jellybean|ACTUAL_PHOTO_NOT/i;
  const JUNK_RE = /\.(js|css|html?|php|aspx?|json|mp4|m3u8|woff2?)(\?|$)|\/videos?\/|logo|icon|sprite|badge|placeholder|loading|spinner|carfax|autocheck|banner|button|\/flags?\/|avatar|\.svg(\?|$)|\.gif(\?|$)|1x1|pixel|facebook\.com|google|doubleclick/i;
  const absolute = (u) => {
    try {
      return new URL(String(u).trim().split(/\s+/)[0].replace(/^url\(["']?|["']?\)$/g, ""), location.href).href;
    } catch (_) {
      return "";
    }
  };
  let stockSeen = false;
  const keep = (u) => {
    if (!u || !/^https?:/.test(u)) return false;
    if (JUNK_RE.test(u)) return false;
    if (STOCK_RE.test(u)) {
      stockSeen = true;
      return false;
    }
    return true;
  };
  const dedupe = (urls) => {
    const seen = new Map();
    for (const u of urls) {
      const url = new URL(u);
      // The same photo often appears in several sizes; keep the first copy of each picture.
      const key = (url.host + url.pathname).toLowerCase().replace(/\/(thumbs?|small|medium|large)\//, "/").replace(/\/thumb_/, "/");
      if (!seen.has(key)) seen.set(key, u);
    }
    return [...seen.values()];
  };

  let photos = [];
  let photoSource = "";

  // a) Dealer.com lists the photos in its data layer.
  if (Array.isArray(ddc.images) && ddc.images.length) {
    const real = ddc.images.filter((i) => i && i.uri && (!i.provider || /ACTUAL/i.test(i.provider)));
    if (!real.length) stockSeen = true;
    photos = dedupe(real.map((i) => absolute(i.uri)).filter(keep));
    photoSource = "ddc";
  }

  // b) DealerOn keeps photos under /inventoryphotos/<id>/<vin>/.
  if (!photos.length) {
    const vinPath = "/" + vin.toLowerCase() + "/";
    const found = [];
    for (const n of document.querySelectorAll("img, source, [data-src], [data-lazy]")) {
      const candidates = [
        n.currentSrc,
        n.src,
        n.getAttribute("data-src"),
        n.getAttribute("data-lazy"),
        ...(n.getAttribute("srcset") ? n.getAttribute("srcset").split(",") : []),
      ];
      for (const c of candidates) {
        if (!c || !/\/inventoryphotos\//i.test(c)) continue;
        const u = absolute(c);
        const lower = u.toLowerCase();
        if (vin && !lower.includes(vinPath)) continue;
        if (lower.includes("/thumbs/")) continue;
        found.push(u.split("?")[0]);
      }
    }
    if (found.length) {
      const photoNumber = (u) => {
        const m = u.match(/\/(\d+)\.(jpe?g|png|webp)$/i);
        return m ? Number(m[1]) : 9999;
      };
      photos = dedupe(found)
        .sort((a, b) => photoNumber(a) - photoNumber(b))
        .map((u) => u + "?width=1280");
      photoSource = "dealeron";
    }
    if (!photos.length && document.querySelector('img[src*="/assets/stock/"], source[srcset*="/assets/stock/"]')) stockSeen = true;
  }

  // c) The page's photo gallery: the gallery-like block holding the most pictures.
  if (!photos.length) {
    const IMG_EXT = /\.(jpe?g|png|webp|avif)(\?|$)/i;
    const urlsIn = (root) => {
      const out = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        for (const a of el.attributes || []) {
          const name = a.name.toLowerCase();
          const val = a.value;
          if (!val || val.length > 4000) continue;
          if (name === "srcset" || name === "data-srcset") {
            val.split(",").forEach((p) => out.push(absolute(p)));
          } else if (name === "style") {
            const m = val.match(/url\(([^)]+)\)/g);
            if (m) m.forEach((x) => out.push(absolute(x)));
          } else if (/^(src|data-[\w-]*|href|content|poster)$/.test(name)) {
            const looksLikeImage = IMG_EXT.test(val) || (/src|image|img|photo|source|bg|background|zoom|full|large/.test(name) && /^(https?:)?\/\//.test(val) && !/\.(html?|php|aspx?)(\?|$)/i.test(val));
            if (looksLikeImage) out.push(absolute(val));
          }
        }
        if (el.tagName === "IMG" && el.currentSrc) out.push(el.currentSrc);
      }
      return out.filter(keep);
    };
    const galleryRe = /gallery|carousel|swiper|slick|slider|slideshow|photo|media-?viewer|vehicle-?images|lightbox|fotorama/i;
    // Skip "similar vehicles" and other-car blocks.
    const otherCarsRe = /similar|recommend|related|recent|you-?may|might-?like|other|compare|specials?/i;
    let best = [];
    for (const el of document.querySelectorAll("[class], [id]")) {
      const label = (typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
      if (!galleryRe.test(label) || otherCarsRe.test(label)) continue;
      if (el.closest("header, footer, nav")) continue;
      const urls = dedupe(urlsIn(el));
      if (urls.length > best.length) best = urls;
    }
    if (best.length >= 2) {
      photos = best;
      photoSource = "gallery";
    }
  }

  // d) Picture addresses that contain the VIN.
  if (!photos.length && vin) {
    const html = document.documentElement.innerHTML;
    const re = new RegExp("https?:\\/\\/[^\"'\\s<>)]*" + vin + "[^\"'\\s<>)]*\\.(?:jpe?g|png|webp)[^\"'\\s<>)]*", "gi");
    const urls = dedupe((html.match(re) || []).map((u) => u.replace(/&amp;/g, "&")).filter(keep));
    if (urls.length) {
      photos = urls;
      photoSource = "vin";
    }
  }

  // e) Whatever pictures the data blocks name (often only the first photo).
  if (!photos.length) {
    const named = []
      .concat(vehicle.image || [], product.image || [])
      .map((i) => (i && typeof i === "object" ? i.url || i.contentUrl : i));
    const og = document.querySelector('meta[property="og:image"]');
    if (og) named.push(og.content);
    photos = dedupe(named.map(absolute).filter(keep));
    photoSource = photos.length ? "named" : "";
  }

  const stockPhotosOnly = photos.length === 0 && stockSeen;

  return {
    ok: true,
    stockPhotosOnly,
    source: photoSource || "page",
    url: location.href,
    dealer: pick(
      window.DlronGlobal_DealerName,
      ddc.accountName,
      nameOf(seller),
      document.querySelector('meta[property="og:site_name"]') && document.querySelector('meta[property="og:site_name"]').content
    ),
    city: pick(window.DlronGlobal_DealerCity, ddc.address && ddc.address.city, sellerAddr.addressLocality),
    state: pick(window.DlronGlobal_DealerState, ddc.address && ddc.address.state, sellerAddr.addressRegion),
    year,
    make,
    model,
    trim,
    vin,
    stock: pick(d.stocknum, ddc.stockNumber, asc.item_number, vehicle.sku, product.sku, fromText(["Stock", "Stock #", "Stock Number"]).split(/\s/)[0]),
    price,
    mileage,
    condition,
    bodyType: pick(vehicle.bodyType, vehicle["bodyType "], ddc.bodyStyle, asc.item_type && titleCase(clean(asc.item_type)), fromText(["Body Style", "Body Type", "Body"])),
    exteriorColor: pick(d.extcolor, ddc.exteriorColor, vehicle.color, product.color, asc.item_color, fromText(["Exterior Color", "Exterior", "Ext. Color", "Color"])),
    interiorColor: pick(d.intcolor, ddc.interiorColor, vehicle.vehicleInteriorColor, fromText(["Interior Color", "Interior", "Int. Color"])),
    transmission: pick(d.trans, ddc.transmission, nameOf(vehicle.vehicleTransmission), fromText(["Transmission", "Trans"])),
    engine: pick(d.engine, ddc.engineSize && ddc.engine ? `${ddc.engineSize} ${ddc.engine}` : ddc.engine, nameOf(vehicle.vehicleEngine), fromText(["Engine"])),
    fuelType: pick(vehicle.fuelType, ddc.normalFuelType, ddc.fuelType, asc.item_fuel_type && titleCase(clean(asc.item_fuel_type)), fromText(["Fuel Type", "Fuel"])),
    drivetrain,
    mpg,
    features,
    dealerComments: comments,
    photos,
  };
})();
