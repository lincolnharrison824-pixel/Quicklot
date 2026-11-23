// Checks the dealer page reader against small copies of real car pages from different
// dealer website companies (built from what those pages contained in November 2026).
// Run: node --test tests/reader.test.mjs   (uses the preinstalled Playwright Chromium)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const readerSrc = fs.readFileSync(path.resolve(here, "../extension/lib/reader.js"), "utf8");

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (body, head = "") => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const PAGES = {
  // Dealer.com: everything in window.DDC.dataLayer, two prices on the page.
  "https://www.drivekelleychevrolet.com/used/Chevrolet/2024-Chevrolet-Equinox-68c3.htm": page(
    `<h1>2024 Chevrolet Equinox LT</h1><p>$23,957 Price</p><p>$24,617 Internet Price</p>
     <div class="ws-vehicle-gallery"><img src="https://pictures.dealer.com/k/kc/1402/a.jpg"></div>
     <script>window.DDC={dataLayer:{vehicles:[{vin:"3GNAXUEG1RS131674",modelYear:"2024",make:"Chevrolet",model:"Equinox",trim:"LT",
       askingPrice:"23957",internetPrice:"24617",salePrice:"261",odometer:"13666",newOrUsed:"used",exteriorColor:"Summit White",
       interiorColor:"Jet Black",transmission:"Automatic",engine:"Turbo 4-cylinder engine",engineSize:"1.5L",driveLine:"AWD",
       bodyStyle:"SUV",normalFuelType:"Gasoline",stockNumber:"P8304C",cityFuelEfficiency:"24",highwayFuelEfficiency:"30",
       accountName:"KELLEY CHEVROLET",address:{city:"Fort Wayne",state:"IN"},features:[],
       images:[{uri:"https://pictures.dealer.com/k/kc/1402/a.jpg",provider:"ACTUAL_PHOTO"},{uri:"https://pictures.dealer.com/k/kc/1234/b.jpg",provider:"ACTUAL_PHOTO"}]}]}};</script>`,
  ),
  // Jazel: shared auto analytics data + a Car block, photos only in the gallery's data-source.
  "https://www.chastangford.com/vehicle/1FMJU2AT0MEA63357/Used-2021-Ford-Expedition-Limited-Houston-TX/": page(
    `<h1>Used 2021 Ford Expedition Limited</h1><p>81,701 mi.</p><div>Transmission.:10-Speed Automatic</div>
     <div class="jazel-gallery">
       <div class="jazel-gallery__thumbnail" data-source="https://media-cdn-tango.jazelc.com/media/329712618?scale=1440%2F-1%2F100"></div>
       <div class="jazel-gallery__thumbnail" data-source="https://media-cdn-tango.jazelc.com/media/329712619?scale=1440%2F-1%2F100"></div>
       <div class="jazel-gallery__thumbnail" data-source="https://media-cdn-tango.jazelc.com/media/329712620?scale=1440%2F-1%2F100"></div>
       <script src="https://play.evn.tools/scripts/evnvideoplayer.js"></script>
       <img src="https://fl.b.evn.pictures/videos/abc/abc.jpeg">
     </div>
     <div class="similar-vehicles"><img src="https://media-cdn-tango.jazelc.com/media/1.jpg"><img src="https://media-cdn-tango.jazelc.com/media/2.jpg"><img src="https://media-cdn-tango.jazelc.com/media/3.jpg"><img src="https://media-cdn-tango.jazelc.com/media/4.jpg"></div>
     <script>window.asc_datalayer={items:[{item_id:"1FMJU2AT0MEA63357",item_number:"SLB03268A",item_price:"29,882",item_condition:"used",
       item_year:"2021",item_make:"ford",item_model:"expedition",item_variant:"limited",item_color:"White",item_fuel_type:"gasoline"}]};</script>`,
    ld({ "@type": "Car", name: "2021 Ford Expedition Limited", image: "https://media-cdn-tango.jazelc.com/media/329855343",
      description: "SPECIAL EDITION PACKAGE!<br>--- 3.5L EcoBoost® V6 ENGINE <br>--- 20-inch POLISHED ALUMINUM WHEELS",
      color: "White Metallic", "bodyType ": "Sport Utility", fuelType: "Gasoline", vehicleIdentificationNumber: "1FMJU2AT0MEA63357",
      vehicleEngine: { "@type": "EngineSpecification", name: "EcoBoost 3.5L V6" }, sku: "SLB03268A" }) +
      `<meta property="og:site_name" content="Chastang Ford">`,
  ),
  // Dealer eProcess: a complete Car block with an offers list, and only stock photos.
  "https://www.deery.com/auto/used-2014-dodge-grand-caravan-se/127252547/": page(
    `<h1>Used 2014 Dodge Grand Caravan SE in Cedar Falls, IA</h1>
     <img src="https://cloudflarestockimages.dealereprocess.com/resrc/images/stockphoto_asset-c_limit/v1/svp/Colors_PNG1280/2014/x.png">`,
    ld([{ "@context": "https://schema.org", "@type": "Car", description: "description", name: "Used 2014 Dodge Grand Caravan SE",
      image: "https://cloudflarestockimages.dealereprocess.com/resrc/images/stockphoto_asset-c_limit/v1/svp/x.png",
      model: "Grand Caravan", color: "Maximum Steel Metallic Clearcoat", vehicleIdentificationNumber: "2C4RDGBG5ER341048",
      vehicleInteriorColor: "Black/Light Graystone", vehicleModelDate: "2014", vehicleTransmission: "6-Speed Automatic",
      sku: "4112331", vehicleConfiguration: "SE", manufacturer: { "@type": "Organization", name: "Dodge" },
      mileageFromOdometer: { "@type": "QuantitativeValue", value: "103493", unitCode: "SMI" },
      offers: [{ "@type": "Offer", price: 4595, itemCondition: "https://schema.org/UsedCondition" }] },
      { "@type": "AutoDealer", name: "John Deery Motors", address: { addressLocality: "Cedar Falls", addressRegion: "IA" } }]),
  ),
  // Call-for-price car: price 0 everywhere, so the popup must ask.
  "https://www.vancouvertoyota.com/viewdetails/used/jteku5jr2m5954695/2021-toyota-4runner-sport-utility": page(
    `<h1>2021 Toyota 4Runner Limited</h1><p>MILEAGE:\n74,932 Miles</p>
     <img src="https://content.homenetiol.com/2003378/2243984/0x0/stock_images/5/2021TOS07_640/x_01.jpg">
     <script>window.asc_datalayer={items:[{item_id:"JTEKU5JR2M5954695",item_make:"Toyota",item_model:"4Runner",item_year:2021,item_price:0,item_condition:"used"}]};</script>`,
    ld({ "@type": "Vehicle", name: "Used 2021 Toyota 4Runner Limited", vehicleIdentificationNumber: "JTEKU5JR2M5954695",
      image: "https://content.homenetiol.com/2003378/2243984/0x0/stock_images/5/2021TOS07_640/x_01.jpg",
      vehicleModelDate: "2021", brand: { "@type": "Brand", name: "Toyota" }, model: "4Runner", vehicleConfiguration: "Limited",
      driveWheelConfiguration: "Four Wheel Drive", mileageFromOdometer: { value: 74932 },
      offers: { "@type": "Offer", price: "0", itemCondition: "https://schema.org/UsedCondition" } }),
  ),
  // A site with no data blocks at all: only the heading, a label list and a photo slider.
  "https://www.smalllot.example/inventory/1234": page(
    `<h1>Used 2019 Honda Accord Sport</h1>
     <ul><li>Price: $18,500</li></ul>
     <div>Mileage: 52,310 miles</div><div>Exterior Color: Modern Steel</div><div>VIN 1HGCV1F34KA012345</div>
     <div class="swiper"><img src="/photos/1234/1.jpg"><img src="/photos/1234/2.jpg"><img src="/img/logo.png"></div>`,
  ),
  // Not a car page.
  "https://www.smalllot.example/about-us": page(`<h1>About our dealership</h1><p>Family owned since 1975.</p>`),
};

let browser;
let ctx;
before(async () => {
  browser = await chromium.launch();
  ctx = await browser.newContext();
  await ctx.route("**/*", (route) => {
    const url = route.request().url().split("?")[0];
    const html = PAGES[url] || PAGES[url.replace(/\/$/, "")] || PAGES[url + "/"];
    if (html) return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
});
after(async () => {
  await browser?.close();
});

async function read(url) {
  const p = await ctx.newPage();
  await p.goto(url);
  const result = await p.evaluate(readerSrc);
  await p.close();
  return result;
}

test("Dealer.com", async () => {
  const car = await read("https://www.drivekelleychevrolet.com/used/Chevrolet/2024-Chevrolet-Equinox-68c3.htm");
  assert.equal(car.ok, true);
  assert.equal(car.vin, "3GNAXUEG1RS131674");
  assert.deepEqual([car.year, car.make, car.model, car.trim], [2024, "Chevrolet", "Equinox", "LT"]);
  assert.equal(car.price, 23957, "uses the lower price the shopper sees, not the 261 rebate");
  assert.equal(car.mileage, 13666);
  assert.equal(car.condition, "used");
  assert.equal(car.drivetrain, "AWD");
  assert.equal(car.mpg, "24/30");
  assert.equal(car.photos.length, 2);
  assert.equal(car.dealer, "KELLEY CHEVROLET");
});

test("Jazel", async () => {
  const car = await read("https://www.chastangford.com/vehicle/1FMJU2AT0MEA63357/Used-2021-Ford-Expedition-Limited-Houston-TX/");
  assert.equal(car.ok, true);
  assert.deepEqual([car.year, car.make, car.model, car.trim], [2021, "Ford", "Expedition", "Limited"]);
  assert.equal(car.price, 29882);
  assert.equal(car.mileage, 81701);
  assert.equal(car.transmission, "10-Speed Automatic");
  assert.equal(car.exteriorColor, "White Metallic");
  assert.equal(car.source, "gallery");
  assert.equal(car.photos.length, 3, "gallery photos only: no video, script or similar-vehicle photos");
  assert.ok(car.photos.every((u) => u.includes("media-cdn-tango.jazelc.com/media/3297126")));
  assert.ok(car.features.includes("20-inch POLISHED ALUMINUM WHEELS"));
  assert.equal(car.dealer, "Chastang Ford");
});

test("Dealer eProcess, stock photos only", async () => {
  const car = await read("https://www.deery.com/auto/used-2014-dodge-grand-caravan-se/127252547/");
  assert.equal(car.ok, true);
  assert.deepEqual([car.year, car.make, car.model, car.trim], [2014, "Dodge", "Grand Caravan", "SE"]);
  assert.equal(car.price, 4595);
  assert.equal(car.mileage, 103493);
  assert.equal(car.dealerComments, "", "drops the placeholder 'description' text");
  assert.equal(car.photos.length, 0);
  assert.equal(car.stockPhotosOnly, true);
  assert.equal(car.city, "Cedar Falls");
});

test("Call for price", async () => {
  const car = await read("https://www.vancouvertoyota.com/viewdetails/used/jteku5jr2m5954695/2021-toyota-4runner-sport-utility");
  assert.equal(car.ok, true);
  assert.equal(car.price, null, "no price, so the popup asks for one");
  assert.equal(car.mileage, 74932);
  assert.equal(car.drivetrain, "4WD");
  assert.equal(car.stockPhotosOnly, true);
});

test("Plain page with no data blocks", async () => {
  const car = await read("https://www.smalllot.example/inventory/1234");
  assert.equal(car.ok, true);
  assert.deepEqual([car.year, car.make, car.model, car.trim], [2019, "Honda", "Accord", "Sport"]);
  assert.equal(car.vin, "1HGCV1F34KA012345");
  assert.equal(car.mileage, 52310);
  assert.equal(car.exteriorColor, "Modern Steel");
  assert.equal(car.condition, "used");
  assert.equal(car.photos.length, 2, "slider photos without the logo");
});

test("Not a car page", async () => {
  const car = await read("https://www.smalllot.example/about-us");
  assert.equal(car.ok, false);
});
