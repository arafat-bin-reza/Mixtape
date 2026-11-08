import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, errorMessage, toTrack } from "../../js/url-tracks.js";

const yt = (input) => { const p = parse(input); assert.equal(p.provider, "youtube", input); assert.equal(p.externalId, "dQw4w9WgXcQ", input); return p; };

test("YouTube link shapes normalise to one id", () => {
  for (const u of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD",
    "https://youtu.be/dQw4w9WgXcQ?si=xyz",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    const p = yt(u);
    assert.equal(p.canonicalUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(p.id, "url-youtube-dQw4w9WgXcQ");
  }
  assert.equal(parse("https://www.youtube.com/watch?v=short").error, "invalid");
  assert.equal(parse("https://www.youtube.com/feed/subscriptions").error, "invalid");
});

test("SoundCloud track links", () => {
  const p = parse("https://soundcloud.com/some-artist/some-track?in=playlist");
  assert.equal(p.provider, "soundcloud");
  assert.equal(p.externalId, "some-artist/some-track");
  assert.equal(p.canonicalUrl, "https://soundcloud.com/some-artist/some-track");
  assert.equal(parse("https://m.soundcloud.com/some-artist/some-track").id, p.id);
  assert.equal(parse("https://soundcloud.com/some-artist/sets/album").error, "playlist");
  assert.equal(parse("https://soundcloud.com/discover").error, "invalid");
  assert.equal(parse("https://on.soundcloud.com/abc123").error, "unsupported");
});

test("Vimeo link shapes", () => {
  assert.deepEqual(parse("https://vimeo.com/123456"), { provider: "vimeo", externalId: "123456", hash: undefined, canonicalUrl: "https://vimeo.com/123456", id: "url-vimeo-123456" });
  assert.equal(parse("https://player.vimeo.com/video/123456?h=abcdef12").hash, "abcdef12");
  assert.equal(parse("https://vimeo.com/123456/abcdef12").canonicalUrl, "https://vimeo.com/123456/abcdef12");
  assert.equal(parse("https://vimeo.com/channels/staffpicks/123456").externalId, "123456");
  assert.equal(parse("https://vimeo.com/about").error, "invalid");
});

test("unsupported platforms are named", () => {
  for (const [u, platform] of [
    ["https://www.facebook.com/watch/?v=1", "Facebook"],
    ["https://fb.watch/abc/", "Facebook"],
    ["https://www.instagram.com/reel/abc/", "Instagram"],
    ["https://www.tiktok.com/@user/video/1", "TikTok"],
    ["https://x.com/user/status/1", "X"],
    ["https://open.spotify.com/track/abc", "Spotify"],
  ]) {
    const p = parse(u);
    assert.equal(p.error, "unsupported", u);
    assert.equal(p.platform, platform, u);
    assert.match(errorMessage(p), new RegExp(platform));
  }
});

test("direct media links", () => {
  const p = parse("https://cdn.example.com/music/My%20Song.mp3?token=1#t=10");
  assert.equal(p.provider, "direct");
  assert.equal(p.known, true);
  assert.equal(p.canonicalUrl, "https://cdn.example.com/music/My%20Song.mp3?token=1");
  assert.equal(parse("https://cdn.example.com/music/My%20Song.mp3?token=1").id, p.id, "fragment ignored in id");
  assert.equal(parse("https://res.cloudinary.com/tivkdskh/video/upload/abc.mp3").provider, "direct");
  assert.equal(parse("https://example.com/stream").known, false);
  assert.equal(parse("http://localhost:8000/a.wav").provider, "direct");
  assert.equal(parse("http://127.0.0.1:8000/a.wav").provider, "direct");
  assert.equal(parse("http://[::1]:8000/a.wav").provider, "direct");
});

test("junk input", () => {
  assert.equal(parse("").error, "empty");
  assert.equal(parse("   ").error, "empty");
  assert.equal(parse("not a url").error, "invalid");
  assert.equal(parse("ftp://example.com/a.mp3").error, "invalid");
  assert.equal(parse("javascript:alert(1)").error, "invalid");
  assert.equal(errorMessage(parse("")), "");
});

test("toTrack maps a stored record to a playlist track", () => {
  const t = toTrack({ id: "url-youtube-x", provider: "youtube", externalId: "x", canonicalUrl: "https://www.youtube.com/watch?v=x", title: "T", artist: "A", cover: null, duration: 10, added: 5 });
  assert.equal(t.source, "url");
  assert.equal(t.src, "https://www.youtube.com/watch?v=x");
  assert.equal(t.provider, "youtube");
});
