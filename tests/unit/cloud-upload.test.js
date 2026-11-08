import { test } from "node:test";
import assert from "node:assert/strict";
import { configure, isEnabled, validate, toRecord, deliveryUrls } from "../../js/cloud-upload.js";

test("configure is off without a cloud name", () => {
  configure(undefined);
  assert.equal(isEnabled(), false);
  configure({ cloudName: "" });
  assert.equal(isEnabled(), false);
  assert.match(validate({ name: "a.mp3", size: 1 }), /not configured/);
});

test("validate enforces format and size", () => {
  configure({ cloudName: "tivkdskh", maxBytes: 1000 });
  assert.equal(validate({ name: "song.MP3", size: 999 }), null);
  assert.match(validate({ name: "song.txt", size: 1 }), /not a supported format/);
  assert.match(validate({ name: "song.mp3", size: 1001 }), /larger than/);
});

test("delivery urls and record mapping", () => {
  configure({ cloudName: "tivkdskh" });
  const { src, cover } = deliveryUrls("mixtape/abc123");
  assert.equal(src, "https://res.cloudinary.com/tivkdskh/video/upload/mixtape/abc123.mp3");
  assert.match(cover, /^https:\/\/res\.cloudinary\.com\/tivkdskh\/video\/upload\/fl_waveform,.*\/mixtape\/abc123\.png$/);

  const rec = toRecord({ public_id: "mixtape/abc123", duration: 159.4, bytes: 10, secure_url: "https://res.cloudinary.com/tivkdskh/video/upload/v1/mixtape/abc123.mp4" }, { title: "T", artist: "A" });
  assert.equal(rec.id, "cloud-mixtape/abc123");
  assert.equal(rec.provider, "cloudinary");
  assert.equal(rec.canonicalUrl, src);
  assert.equal(rec.duration, 159);

  const eager = toRecord({ public_id: "x", eager: [{ secure_url: "https://res.cloudinary.com/tivkdskh/video/upload/f_mp3/x.mp3" }] }, { title: "T", artist: "A" });
  assert.equal(eager.canonicalUrl, "https://res.cloudinary.com/tivkdskh/video/upload/f_mp3/x.mp3");
  assert.equal(eager.duration, undefined);
});
