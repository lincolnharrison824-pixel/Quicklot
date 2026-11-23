// End-to-end check of the extension against a mock Marketplace form.
// Run: node tests/e2e-extension.mjs   (uses the preinstalled Playwright Chromium)
// It does NOT touch the real Facebook: facebook.com and the dealer photos are answered locally.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, "../extension");
const mockForm = fs.readFileSync(path.join(here, "mock/marketplace-vehicle.html"), "utf8");
const car = JSON.parse(fs.readFileSync(path.join(here, "fixtures/gv70.json"), "utf8"));
car.interiorColor = "Gray"; // Facebook US spells it Gray
car.photos = [1, 2, 3].map((n) => `https://www.genesisofconway.com/inventoryphotos/21131/kmumadtb5pu123389/ip/${n}.jpg?width=1280`);
// 1x1 JPEG
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "ql-"));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
await ctx.route("https://www.facebook.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: mockForm }));
await ctx.route("https://www.genesisofconway.com/inventoryphotos/**", (r) => r.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg }));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
console.error("extension id:", extId);

const errors = [];
const results = {};

// 1. Popup renders the first-time setup in local mode.
const popup = await ctx.newPage();
popup.on("pageerror", (e) => errors.push("popup: " + e.message));
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForSelector("h1");
results.firstScreen = await popup.textContent("h1");
await popup.check("#agree");
await popup.click("#next");
await popup.waitForSelector("[data-tone]");
results.toneScreen = await popup.textContent("h1");
await popup.click('[data-tone="energy"]');
await popup.click("#next");
await popup.click('[data-theme-pick="dark"]');
await popup.click('[data-accent-pick="green"]');
await popup.click("#done");
await popup.waitForSelector("h1");
results.afterSetup = await popup.textContent("h1");
results.theme = await popup.evaluate(() => [document.body.dataset.theme, document.body.dataset.accent]);
results.savedSettings = await popup.evaluate(() => chrome.storage.local.get("settings").then((v) => v.settings));

// 2. Background opens Marketplace and the filler fills the form.
const description = self_write(car);
function self_write(c) { return `Test description for ${c.year} ${c.make} ${c.model}.`; }
const startRes = await popup.evaluate(
  ([car, description]) => chrome.runtime.sendMessage({ type: "startFill", car, title: "2023 Genesis GV70 2.5T", description }),
  [car, description],
);
results.startFill = startRes;
console.error("startFill:", JSON.stringify(startRes));
let form = null;
for (let i = 0; i < 100 && !form; i++) {
  form = ctx.pages().find((p) => p.url().includes("/marketplace/create/vehicle")) || null;
  if (!form) await new Promise((r) => setTimeout(r, 200));
}
if (!form) throw new Error("Marketplace tab never opened. Pages: " + ctx.pages().map((p) => p.url()).join(", "));
form.on("pageerror", (e) => errors.push("form: " + e.message));
await form.waitForSelector("#quicklot-panel", { timeout: 15000 });
await form.waitForFunction(() => document.getElementById("quicklot-panel")?.textContent.includes("Done filling"), null, { timeout: 30000 });
results.formState = await form.evaluate(() => window.state);
results.clickedNext = await form.evaluate(() => window.clickedForbidden);
results.panel = await form.evaluate(() => document.getElementById("quicklot-panel").innerText);

// 3. Daily cap and spacing: a second post right away is refused.
results.secondStart = await popup.evaluate(
  ([car, description]) => chrome.runtime.sendMessage({ type: "startFill", car, title: "x", description }),
  [car, description],
);

// 4. My cars has the car.
results.cars = await popup.evaluate(() => chrome.storage.local.get("cars").then((v) => (v.cars || []).map((c) => c.title)));

// 5. Popup car screen: a "Call For Price" car asks for the price before writing.
await popup.evaluate((car) => {
  const noPrice = { ...car, price: null };
  readActiveTab = async () => noPrice; // stand-in for reading the dealer tab
  renderMain();
}, car);
await popup.waitForSelector("#write");
results.askedForPrice = await popup.isVisible("#price");
await popup.click("#write");
await popup.waitForSelector(".error");
results.priceError = await popup.textContent(".error");
await popup.fill("#price", "29999");
await popup.click("#write");
await popup.waitForSelector("#desc");
results.writtenDescription = await popup.inputValue("#desc");
results.fillDisabledBySpacing = await popup.isDisabled("#fill");

console.log(JSON.stringify({ results, errors }, null, 2));
await ctx.close();
