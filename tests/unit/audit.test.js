import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, describe, configure, isEnabled } from "../../js/audit.js";

const base = { ids: ["a", "b"], currentId: "a", playing: false, failed: [], item: null, started: false, nearEnd: false };
const types = (prev, next) => diff({ ...base, ...prev }, { ...base, ...next }).events.map((e) => `${e.type}:${e.trackId}${e.reason ? ":" + e.reason : ""}`);

test("configure is inert without an endpoint", () => {
  assert.equal(configure(undefined), null);
  assert.equal(configure({ endpoint: "" }), null);
  assert.equal(isEnabled(), false);
});

test("no events when nothing watched has changed", () => {
  assert.deepEqual(types({}, {}), []);
  assert.deepEqual(types({ playing: true, started: true }, { playing: true }), []);
});

test("tracks added and removed", () => {
  assert.deepEqual(types({}, { ids: ["a", "b", "c"] }), ["track_add:c"]);
  assert.deepEqual(types({}, { ids: ["a"] }), ["track_remove:b"]);
});

test("play_start fires once per track, not again on resume", () => {
  const first = diff(base, { ...base, playing: true });
  assert.deepEqual(first.events, [{ type: "play_start", trackId: "a" }]);
  assert.equal(first.started, true);
  assert.deepEqual(types({ started: true }, { playing: true }), []);
  assert.equal(diff({ ...base, playing: true, started: true }, base).started, true); // paused mid-track
});

test("changing track ends the old play as skipped or ended", () => {
  assert.deepEqual(types({ playing: true, started: true }, { playing: true, currentId: "b" }), ["play_end:a:skipped", "play_start:b"]);
  assert.deepEqual(types({ playing: true, started: true, nearEnd: true }, { playing: true, currentId: "b" }), ["play_end:a:ended", "play_start:b"]);
  assert.deepEqual(types({ started: true }, { currentId: "b" }), ["play_end:a:skipped"]);
  assert.deepEqual(types({}, { currentId: "b" }), []); // never started: nothing to end
});

test("the last track finishing ends the play and allows a fresh start", () => {
  const r = diff({ ...base, playing: true, started: true, nearEnd: true }, base);
  assert.deepEqual(r.events, [{ type: "play_end", trackId: "a", reason: "ended" }]);
  assert.equal(r.started, false);
});

test("a failing track reports play_error, ends with reason error and is not restarted", () => {
  assert.deepEqual(types({ playing: true, started: true }, { playing: true, failed: ["a"] }), ["play_error:a", "play_end:a:error"]);
  assert.deepEqual(types({ playing: true }, { playing: true, failed: ["a"] }), ["play_error:a"]);
});

test("collection items are reported when the item changes", () => {
  assert.deepEqual(diff({ ...base, started: true, playing: true }, { ...base, playing: true, item: "spotify:track:x" }).events,
    [{ type: "collection_item", trackId: "a", itemUri: "spotify:track:x" }]);
  assert.deepEqual(types({ item: "spotify:track:x" }, { item: "spotify:track:x" }), []);
});

test("describe maps each kind of track", () => {
  const yt = describe({ id: "url-youtube-abc", title: "T", artist: "A", src: "https://www.youtube.com/watch?v=abc", cover: "c.jpg", duration: 12, provider: "youtube", externalId: "abc", source: "url" });
  assert.deepEqual(JSON.parse(JSON.stringify(yt)), {
    trackId: "url-youtube-abc", source: "url", provider: "youtube", url: "https://www.youtube.com/watch?v=abc", externalId: "abc", title: "T", artist: "A", duration: 12, cover: "c.jpg",
  });
  const sp = describe({ id: "url-spotify-album-x", title: "Al", artist: "Spotify album", src: "https://open.spotify.com/album/x", provider: "spotify", kind: "album", source: "url" });
  assert.equal(sp.kind, "album");
  const local = describe({ id: "local-1", title: "L", artist: "Local file", src: "blob:http://x/1", source: "local", duration: 3, file: { name: "L.mp3", bytes: 99, mime: "audio/mpeg" } });
  assert.equal(local.url, undefined); // blob: addresses mean nothing outside the tab
  assert.deepEqual([local.fileName, local.bytes, local.mime], ["L.mp3", 99, "audio/mpeg"]);
  const repo = describe({ id: "majboor", title: "M", artist: "X", src: "assets/audio/majboor.wav", source: "repo" });
  assert.deepEqual([repo.source, repo.url], ["repo", "assets/audio/majboor.wav"]);
  const shared = describe({ id: "shared-mixtape/a", title: "S", artist: "Shared", src: "https://res.cloudinary.com/c/video/upload/mixtape/a.mp3", provider: "cloudinary", externalId: "mixtape/a", source: "shared" });
  assert.deepEqual([shared.source, shared.provider], ["shared", "cloudinary"]);
});
