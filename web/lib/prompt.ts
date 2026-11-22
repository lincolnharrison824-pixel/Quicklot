// QuickLot: the instructions and input for writing one Marketplace description.

export type Tone = "friendly" | "direct" | "energy";

export type Car = {
  year?: number | null;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  stock?: string;
  price?: number | null;
  mileage?: number | null;
  condition?: string;
  bodyType?: string;
  exteriorColor?: string;
  interiorColor?: string;
  transmission?: string;
  engine?: string;
  fuelType?: string;
  drivetrain?: string;
  mpg?: string;
  features?: string[];
  dealerComments?: string;
  city?: string;
  state?: string;
};

const TONE_GUIDE: Record<Tone, string> = {
  friendly:
    "Friendly: warm and personal, like a salesperson texting a neighbor about a car they like. Relaxed, first person.",
  direct:
    "Straight to the point: short, plain sentences. Facts first, no hype, still sounds like a real person.",
  energy:
    "High energy: upbeat and excited, a couple of exclamation points at most, never cheesy or shouty. No all-caps words.",
};

export const SYSTEM_PROMPT = `You write Facebook Marketplace vehicle descriptions for a car salesperson who posts from their own personal profile.

Write the way a real local salesperson writes a quick post:
- Short: 3 to 5 sentences, under 90 words. Plain text only, no headings, no bullet lists, no hashtags.
- Personal and local: first person ("I", "me"), mention the town if given.
- Include the asking price (if given) and the mileage (if given), and 3 to 5 features a buyer actually cares about.
- End with a simple invite to message.

Never include:
- The VIN, the stock number, or any internal codes.
- A price or availability disclaimer or footer (no "plus tax, title and fees", "subject to prior sale", "price does not include", "call for availability").
- Emojis, "AI" mentions, or links. No phone numbers. No dealership boilerplate or warranty fine print.
- Anything not supported by the car details you are given. Don't invent features, history, owners, accidents or condition.

Reply with only the description text.`;

const money = (n?: number | null) => (n ? "$" + Math.round(n).toLocaleString("en-US") : "not given");
const miles = (n?: number | null) => (n ? Math.round(n).toLocaleString("en-US") : "not given");

export function buildUserMessage(car: Car, tone: Tone): string {
  // The VIN and stock number are deliberately left out of what the model sees.
  const lines = [
    `Tone: ${TONE_GUIDE[tone] || TONE_GUIDE.friendly}`,
    "",
    "Car details:",
    `Vehicle: ${[car.year, car.make, car.model, car.trim].filter(Boolean).join(" ")}`,
    `Condition: ${car.condition || "not given"}`,
    `Asking price: ${money(car.price)}`,
    `Mileage: ${miles(car.mileage)}`,
    `Exterior / interior: ${car.exteriorColor || "?"} / ${car.interiorColor || "?"}`,
    `Body: ${car.bodyType || "?"}; Drivetrain: ${car.drivetrain || "?"}; Engine: ${car.engine || "?"}; Transmission: ${car.transmission || "?"}; Fuel: ${car.fuelType || "?"}; MPG: ${car.mpg || "?"}`,
    `Features: ${(car.features || []).slice(0, 25).join(", ") || "none listed"}`,
    `Town: ${[car.city, car.state].filter(Boolean).join(", ") || "not given"}`,
    "",
    "Dealer's own notes (for facts only; don't copy their wording or fine print):",
    (car.dealerComments || "none").slice(0, 1500),
  ];
  return lines.join("\n");
}

// Same rules as the extension's sanitize(): strip anything the listing rules forbid.
export function sanitize(text: string, car: Car): string {
  let t = String(text || "");
  if (car.vin) t = t.split(car.vin).join("");
  if (car.stock) {
    const s = car.stock.replace(/[^A-Za-z0-9]/g, "");
    if (s) t = t.replace(new RegExp(`\\b${s}\\b`, "gi"), "");
  }
  return t
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "")
    .replace(/^.*\b(vin|stock\s*#?|stock number)\b.*$/gim, "")
    .replace(/^.*\b(price (does not|doesn't) include|plus tax|tax,? title|subject to (prior )?sale|availability)\b.*$/gim, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
