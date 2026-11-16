import { test } from "node:test";
import assert from "node:assert/strict";
import { configure, isEnabled, validate, toRecord, deliveryUrls, hasNoAudio } from "../../js/cloud-upload.js";

test("configure is off without a cloud name", () => {
  configure(undefined);
  assert.equal(isEnabled(), false);
  configure({ cloudName: "" });
  assert.equal(isEnabled(), false);
  assert.match(validate({ name: "a.mp3", size: 1 }), /not configured/);
});

test("validate accepts any audio or video file and enforces size", () => {
  configure({ cloudName: "tivkdskh", maxBytes: 1000 });
  for (const name of ["song.MP3", "voice.amr", "take.aiff", "clip.mkv", "old.AVI"]) assert.equal(validate({ name, size: 999 }), null, name);
  assert.equal(validate({ name: "recording", type: "audio/x-whatever", size: 1 }), null);
  assert.equal(validate({ name: "clip", type: "video/x-matroska", size: 1 }), null);
  assert.match(validate({ name: "notes.txt", size: 1 }), /not an audio or video file/);
  assert.match(validate({ name: "photo.png", type: "image/png", size: 1 }), /not an audio or video file/);
  assert.match(validate({ name: "song.mp3", size: 1001 }), /larger than/);
});

test("allowedFormats is an optional restriction", () => {
  configure({ cloudName: "tivkdskh", allowedFormats: ["mp3"] });
  assert.equal(validate({ name: "song.mp3", size: 1 }), null);
  assert.match(validate({ name: "clip.mkv", size: 1 }), /not a supported format \(mp3\)/);
});

test("hasNoAudio only flags a video whose audio stream is empty", () => {
  assert.equal(hasNoAudio({ public_id: "x" }), false);
  assert.equal(hasNoAudio({ is_audio: true, audio: { codec: "mp3" }, video: {} }), false);
  assert.equal(hasNoAudio({ is_audio: false, audio: { codec: "aac" }, video: { codec: "h264" } }), false);
  assert.equal(hasNoAudio({ is_audio: false, audio: {}, video: { codec: "h264" } }), true);
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
