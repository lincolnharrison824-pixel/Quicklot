// QuickLot: listing writer helpers used by the popup.
// - buildTitle: the Marketplace title line.
// - writeLocal: a no-cost template writer, used when no backend is set up.
// - sanitize: enforces the listing rules on any text (no VIN, no stock number, no footer).

(function (root) {
  const TONES = {
    friendly: "Friendly",
    direct: "Straight to the point",
    energy: "High energy",
  };

  const fmtMoney = (n) => (n ? "$" + Math.round(n).toLocaleString("en-US") : "");
  const fmtMiles = (n) => (n ? Math.round(n).toLocaleString("en-US") + " miles" : "");

  function buildTitle(car) {
    return [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
  }

  // Pick the features a buyer cares about, in a sensible order, without repeats.
  const PRIORITY = [
    /awd|4wd|all-wheel/i,
    /leather/i,
    /sunroof|moonroof|panoramic/i,
    /heated seat|ventilat/i,
    /heated steering/i,
    /carplay|android auto/i,
    /navigation/i,
    /remote start/i,
    /adaptive cruise/i,
    /blind spot/i,
    /surround|360|camera/i,
    /third row|3rd row/i,
    /tow/i,
    /premium audio|lexicon|bose|harman|bang/i,
  ];
  function keyFeatures(car, max = 5) {
    const list = (car.features || []).filter((f) => !/^bluetooth$/i.test(f));
    const picked = [];
    for (const re of PRIORITY) {
      const hit = list.find((f) => re.test(f) && !picked.includes(f));
      if (hit) picked.push(hit);
      if (picked.length >= max) break;
    }
    for (const f of list) {
      if (picked.length >= max) break;
      if (!picked.includes(f)) picked.push(f);
    }
    return picked.map((f) => (f === "4WD/AWD" && car.drivetrain ? car.drivetrain : f)).map(lowerFeature);
  }

  // "Leather Seats" -> "leather seats", but keep AWD, CarPlay, Android Auto and other names as written.
  function lowerFeature(f) {
    return f
      .split(" ")
      .map((w) => (/^[A-Z0-9/]{2,}$/.test(w) || /[a-z][A-Z]/.test(w) || /^(Apple|Android|Auto|Bose|Lexicon|Harman)$/.test(w) ? w : w.toLowerCase()))
      .join(" ");
  }

  function writeLocal(car, tone, opts = {}) {
    const name = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
    const price = opts.omitPrice ? "" : fmtMoney(car.price);
    const miles = opts.omitMiles ? "" : fmtMiles(car.mileage);
    const feats = keyFeatures(car, opts.maxFeatures || 5);
    const featLine = feats.length ? feats.join(", ") : "";
    const place = car.city ? car.city : "town";
    const color = car.exteriorColor || "";

    let lines;
    if (tone === "direct") {
      lines = [
        `${name}${color ? ", " + color : ""}.`,
        [miles, price ? "asking " + price : ""].filter(Boolean).join(", ") + ".",
        featLine ? `Has ${featLine}.` : "",
        `In ${place} and ready to drive. Message me to see it.`,
      ];
    } else if (tone === "energy") {
      lines = [
        `This ${name} is a great one!`,
        [miles ? `Only ${miles}` : "", price ? `asking ${price}` : ""].filter(Boolean).join(", ") + ".",
        featLine ? `Loaded with ${featLine}.` : "",
        `It's here in ${place} and won't last long. Message me today and come take it for a drive!`,
      ];
    } else {
      lines = [
        `Just got this ${name}${color ? " in " + color : ""} and it's a really nice one.`,
        [miles, price ? `asking ${price}` : ""].filter(Boolean).join(", ") + ".",
        featLine ? `It has ${featLine}.` : "",
        `I'm in ${place}. Send me a message and I'll get you set up to see it.`,
      ];
    }
    return sanitize(lines.filter((l) => l && l !== ".").join("\n"), car);
  }

  // The free writer can follow a few simple change requests. Anything else needs the AI writer.
  function rewriteLocal(car, tone, instructions) {
    const t = String(instructions || "").toLowerCase();
    const opts = {};
    const understood = [];
    let useTone = tone;
    if (/excit|energy|hype|pumped|upbeat/.test(t)) { useTone = "energy"; understood.push("more excited"); }
    else if (/friendl|warm|casual|personal/.test(t)) { useTone = "friendly"; understood.push("friendlier"); }
    else if (/direct|straight|to the point|plain|simple/.test(t)) { useTone = "direct"; understood.push("more direct"); }
    if (/short|brief|less|trim it|cut/.test(t)) { opts.maxFeatures = 2; understood.push("shorter"); }
    else if (/long|more detail|more feature|add feature/.test(t)) { opts.maxFeatures = 8; understood.push("more features"); }
    if (/(no|without|remove|drop|don'?t (mention|include|show)) (the )?price/.test(t)) { opts.omitPrice = true; understood.push("no price"); }
    if (/(no|without|remove|drop|don'?t (mention|include|show)) (the )?(miles|mileage)/.test(t)) { opts.omitMiles = true; understood.push("no miles"); }
    return { text: writeLocal(car, useTone, opts), understood };
  }

  // Remove anything the listing rules forbid, whatever wrote the text.
  function sanitize(text, car) {
    let t = String(text || "");
    if (car && car.vin) t = t.split(car.vin).join("");
    if (car && car.stock) t = t.replace(new RegExp("\\b" + car.stock.replace(/[^A-Za-z0-9]/g, "") + "\\b", "gi"), "");
    t = t
      .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "") // any VIN-shaped string
      .replace(/^.*\b(vin|stock\s*#?|stock number)\b.*$/gim, "")
      .replace(/^.*\b(price (does not|doesn't) include|plus tax|tax,? title|subject to (prior )?sale|availability)\b.*$/gim, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // no emojis
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return t;
  }

  root.QuickLotWriter = { TONES, buildTitle, writeLocal, rewriteLocal, sanitize, keyFeatures };
  if (typeof module !== "undefined") module.exports = root.QuickLotWriter;
})(typeof globalThis !== "undefined" ? globalThis : this);
