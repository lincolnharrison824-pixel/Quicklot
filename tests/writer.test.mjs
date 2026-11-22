// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const W = require("../extension/lib/writer.js");
const car = require("./fixtures/gv70.json");

test("each tone includes price, miles and town, and never the VIN or stock number", () => {
  for (const tone of ["friendly", "direct", "energy"]) {
    const t = W.writeLocal(car, tone);
    assert.match(t, /\$32,145/);
    assert.match(t, /46,696/);
    assert.match(t, /Conway/);
    assert.ok(!t.includes(car.vin), tone + " has VIN");
    assert.ok(!t.includes(car.stock), tone + " has stock number");
  }
});

test("sanitize removes VIN, stock number, footers and emojis", () => {
  const dirty = "Clean SUV 🚗\nVIN: KMUMADTB5PU123389\nStock # 6GC2274A\nAsk for Lincoln.\nPrice does not include tax, title and fees.\nSubject to prior sale.";
  const t = W.sanitize(dirty, car);
  assert.equal(t, "Clean SUV\n\nAsk for Lincoln.");
});

test("title is year make model trim", () => {
  assert.equal(W.buildTitle(car), "2023 Genesis GV70 2.5T");
});

test("basic writer follows simple change notes", () => {
  const r = W.rewriteLocal(car, "friendly", "make it shorter and more excited, no price");
  assert.deepEqual(r.understood, ["more excited", "shorter", "no price"]);
  assert.ok(!r.text.includes("$32,145"));
  assert.match(r.text, /great one!/);
});
