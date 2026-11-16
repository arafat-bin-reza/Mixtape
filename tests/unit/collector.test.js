import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, parseBatch, parseUA, toCsv, MAX_EVENTS } from "../../collector/src/lib.js";

const ev = (over) => ({ sessionId: "session-0001", seq: 1, ts: 1000, type: "track_add", trackId: "url-youtube-abc", ...over });

test("clean keeps known fields, truncates strings and drops the rest", () => {
  const c = clean(ev({ title: "x".repeat(1000), duration: 12, bogus: "no", bytes: "12" }));
  assert.equal(c.fields.title.length, 300);
  assert.equal(c.fields.duration, 12);
  assert.equal("bogus" in c.fields, false);
  assert.equal("bytes" in c.fields, false); // wrong type
});

test("clean rejects malformed events", () => {
  assert.equal(clean(ev({ type: "nope" })), null);
  assert.equal(clean(ev({ type: "constructor" })), null);
  assert.equal(clean(ev({ sessionId: "x" })), null);
  assert.equal(clean(ev({ seq: -1 })), null);
  assert.equal(clean(ev({ seq: 1.5 })), null);
  assert.equal(clean(ev({ trackId: undefined })), null);
  assert.equal(clean(null), null);
  assert.ok(clean({ sessionId: "session-0001", seq: 0, ts: 1, type: "session_start" })); // no trackId needed
});

test("parseBatch validates the envelope and drops bad events", () => {
  assert.deepEqual(parseBatch("{"), { error: "json" });
  assert.deepEqual(parseBatch(JSON.stringify({ visitorId: "short", events: [ev()] })), { error: "shape" });
  assert.deepEqual(parseBatch(JSON.stringify({ visitorId: "visitor-0001", events: [] })), { error: "count" });
  assert.deepEqual(parseBatch(JSON.stringify({ visitorId: "visitor-0001", events: Array(MAX_EVENTS + 1).fill(ev()) })), { error: "count" });
  assert.deepEqual(parseBatch(JSON.stringify({ visitorId: "visitor-0001", events: [ev({ type: "nope" })] })), { error: "events" });
  const ok = parseBatch(JSON.stringify({ visitorId: "visitor-0001", events: [ev(), ev({ type: "nope" })] }));
  assert.equal(ok.events.length, 1);
});

test("parseUA names browser, OS and device type", () => {
  const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const chrome = parseUA(chromeUA);
  assert.deepEqual([chrome.browser, chrome.os, chrome.deviceType], ["Chrome", "Windows", "desktop"]);
  assert.equal(parseUA(chromeUA, { platformVersion: "19.0.0" }).os, "Windows 11");
  assert.equal(parseUA(chromeUA, { platformVersion: "10.0.0" }).os, "Windows 10");
  const edge = parseUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0");
  assert.equal(edge.browser, "Edge");
  const iphone = parseUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  assert.deepEqual([iphone.browser, iphone.os, iphone.deviceType], ["Safari", "iOS", "mobile"]);
  const pixel = parseUA("Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", { model: "Pixel 9", platformVersion: "15.0.0", mobile: true });
  assert.deepEqual([pixel.os, pixel.deviceType, pixel.deviceModel], ["Android 15.0.0", "mobile", "Pixel 9"]);
  const tab = parseUA("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
  assert.equal(tab.deviceType, "tablet");
  const fx = parseUA("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0");
  assert.deepEqual([fx.browser, fx.os], ["Firefox", "Linux"]);
});

test("toCsv quotes cells and defuses spreadsheet formulas", () => {
  assert.equal(toCsv([]), "");
  assert.equal(toCsv([{ a: 'say "hi", ok', b: "=SUM(A1)", c: -5, d: null }]), 'a,b,c,d\r\n"say ""hi"", ok",\'=SUM(A1),-5,\r\n');
});
