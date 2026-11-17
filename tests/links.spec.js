import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const repoCount = JSON.parse(readFileSync("data/tracks.json", "utf8")).length;
const TONE = `http://localhost:${process.env.PORT || 8000}/tests/fixtures/tone.wav`;

test.beforeEach(async ({ page }) => {
  await page.route("**/config.json", (r) => r.fulfill({ json: {} }));
});

test("direct media link is added, persists, plays, and is not duplicated", async ({ page }) => {
  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", TONE);
  await expect(page.locator("#link-add")).toBeEnabled();
  await expect(page.locator("#link-title-input")).toHaveValue("tone");
  await expect(page.locator("#link-provider")).toContainText("0:02");
  await page.fill("#link-artist", "Test Artist");
  await page.click("#link-add");

  const rows = page.locator("#tracks li");
  await expect(rows).toHaveCount(repoCount + 1);
  const row = rows.last();
  await expect(row.locator(".badge")).toHaveText("Link");
  await expect(row.locator("small")).toHaveText("Test Artist");

  await row.locator(".row").click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#dur")).toHaveText("0:02");

  // Duplicate detection
  await page.click("#add-link");
  await page.fill("#link-url", TONE);
  await expect(page.locator("#link-status")).toContainText("already in the playlist");
  await expect(page.locator("#link-add")).toBeDisabled();
  await page.click("#link-cancel");

  // Survives reload
  await page.reload();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(page.locator("#tracks li").last().locator("b")).toContainText("tone");

  // Remove
  await page.locator("#tracks li").last().locator(".rm").click();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount);
});

test("the dialog is empty after a link is added and after Cancel", async ({ page }) => {
  await page.goto("/");
  const empty = async () => {
    await expect(page.locator("#link-dialog")).not.toHaveAttribute("open", "");
    for (const id of ["#link-url", "#link-title-input", "#link-artist"]) await expect(page.locator(id)).toHaveValue("");
    await expect(page.locator("#link-provider")).toHaveText("");
    await expect(page.locator("#link-cover")).not.toHaveAttribute("src", /./);
  };

  await page.click("#add-link");
  await page.fill("#link-url", TONE);
  await expect(page.locator("#link-add")).toBeEnabled();
  await page.fill("#link-artist", "Test Artist");
  await page.click("#link-add");
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await empty();

  await page.click("#add-link");
  await expect(page.locator("#link-url")).toHaveValue("");
  await expect(page.locator("#link-preview")).toBeHidden();
  await expect(page.locator("#link-status")).toHaveText("");
  await expect(page.locator("#link-add")).toBeDisabled();

  // Cancel clears too, including a lookup still waiting on the input debounce.
  await page.fill("#link-url", `${TONE}?v=2`);
  await page.click("#link-cancel");
  await empty();
  await page.waitForTimeout(600);
  await expect(page.locator("#link-add")).toBeDisabled();
  await empty();
});

test("unsupported platform links are rejected with an explanation", async ({ page }) => {
  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", "https://www.tiktok.com/@someone/video/123");
  await expect(page.locator("#link-status")).toContainText("TikTok links can't be played here");
  await expect(page.locator("#link-add")).toBeDisabled();
  await page.fill("#link-url", "not a link");
  await expect(page.locator("#link-status")).toContainText("doesn't look like a playable link");
  await expect(page.locator("#link-add")).toBeDisabled();
});

test("YouTube link uses oEmbed metadata and the stubbed player", async ({ page }) => {
  await page.route("**/oembed**", (r) => r.fulfill({ json: { title: "Stub Video", author_name: "Stub Channel", thumbnail_url: `${TONE}#thumb` } }));
  await page.route("https://noembed.com/**", (r) => r.fulfill({ json: {} }));
  await page.addInitScript(() => {
    window.__yt = { calls: [] };
    class Player {
      constructor(el, opts) {
        this.opts = opts; this.el = el; window.__yt.player = this;
        setTimeout(() => opts.events.onReady({ target: this }), 0);
      }
      state(s) { this.opts.events.onStateChange({ data: s, target: this }); }
      loadVideoById(id) { window.__yt.calls.push(["load", id]); this.state(1); }
      cueVideoById(id) { window.__yt.calls.push(["cue", id]); this.state(5); }
      playVideo() { window.__yt.calls.push(["play"]); this.state(1); }
      pauseVideo() { window.__yt.calls.push(["pause"]); this.state(2); }
      seekTo(t) { window.__yt.calls.push(["seek", t]); this.t = t; }
      getCurrentTime() { return this.t || 0; }
      getDuration() { return 213; }
      setVolume() {} mute() {} unMute() {} destroy() {}
    }
    window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  });

  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", "https://youtu.be/dQw4w9WgXcQ?si=share");
  await expect(page.locator("#link-title-input")).toHaveValue("Stub Video");
  await expect(page.locator("#link-artist")).toHaveValue("Stub Channel");
  await expect(page.locator("#link-provider")).toContainText("YouTube");
  await page.click("#link-add");

  const row = page.locator("#tracks li").last();
  await expect(row.locator(".badge")).toHaveText("YouTube");
  await row.locator(".row").click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#cover")).toHaveAttribute("data-embed", "youtube");
  // No playback options in config.json: the player stays visible and nothing is covered.
  await expect(page.locator("#cover")).not.toHaveAttribute("data-audio-only", "");
  await expect(page.locator("#embed")).toHaveCSS("opacity", "1");
  await expect(page.locator("#dur")).toHaveText("3:33");
  expect(await page.evaluate(() => window.__yt.calls[0])).toEqual(["load", "dQw4w9WgXcQ"]);

  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Play");
  expect(await page.evaluate(() => window.__yt.calls.at(-1))).toEqual(["pause"]);

  // Back to a repo track: the embed slot is hidden again and the html engine plays.
  await page.locator("#tracks li").first().locator(".row").click();
  await expect(page.locator("#cover")).toHaveAttribute("data-embed", "");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
});

/** Stubs Spotify's oEmbed (per request URL) and iFrame API. The fake controller records calls and the test emits playback_update events. */
async function stubSpotify(page, oembed = () => ({ title: "Stub Song", thumbnail_url: `${TONE}#thumb`, provider_name: "Spotify" })) {
  await page.route("https://open.spotify.com/oembed**", (r) => r.fulfill({ json: oembed(r.request().url()) }));
  await page.route("https://noembed.com/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://open.spotify.com/embed/iframe-api/v1", (r) => r.fulfill({ contentType: "text/javascript", body: `
    window.__sp = { calls: [], listeners: {}, uri: null, dur: 213000 };
    window.__sp.emit = (data) => (window.__sp.listeners.playback_update || []).forEach((fn) => fn({ data: { playingURI: window.__sp.uri, isBuffering: false, duration: window.__sp.dur, ...data } }));
    const controller = {
      addListener(ev, fn) { (window.__sp.listeners[ev] ??= []).push(fn); },
      loadEntity(u) { window.__sp.calls.push(["load", u]); window.__sp.uri = u; },
      play() { window.__sp.calls.push(["play"]); window.__sp.emit({ isPaused: false, position: 0 }); },
      resume() { window.__sp.calls.push(["resume"]); window.__sp.emit({ isPaused: false, position: 5000 }); },
      pause() { window.__sp.calls.push(["pause"]); window.__sp.emit({ isPaused: true, position: 5000 }); },
      seek(s) { window.__sp.calls.push(["seek", s]); },
      destroy() { window.__sp.calls.push(["destroy"]); },
    };
    const api = { createController(el, opts, cb) {
      window.__sp.calls.push(["create", opts.uri]); window.__sp.uri = opts.uri;
      const iframe = document.createElement("iframe"); el.replaceWith(iframe);
      setTimeout(() => { cb(controller); (window.__sp.listeners.ready || []).forEach((fn) => fn()); }, 0);
    } };
    window.onSpotifyIframeApiReady?.(api);
  ` }));
}

test("YouTube with playback options: artwork covers the player and suspected ads are muted", async ({ page }) => {
  await page.route("**/config.json", (r) => r.fulfill({ json: { playback: { hideVideo: true, muteAds: true } } }));
  await page.route("**/oembed**", (r) => r.fulfill({ json: { title: "Stub Video", author_name: "Stub Channel" } }));
  await page.route("https://noembed.com/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.addInitScript(() => {
    window.__yt = { sound: [], ad: null };
    class Player {
      constructor(el, opts) {
        this.opts = opts; window.__yt.player = this;
        setTimeout(() => opts.events.onReady({ target: this }), 0);
      }
      state(s) { this.opts.events.onStateChange({ data: s, target: this }); }
      // Stays unstarted after a load, as the real player does while a pre-roll ad runs.
      loadVideoById(id) { this.id = id; this.state(-1); }
      cueVideoById(id) { this.id = id; this.state(5); }
      playVideo() {} pauseVideo() { this.state(2); } seekTo() {}
      getCurrentTime() { return 7; }
      getDuration() { return 213; }
      getVideoData() { return { video_id: window.__yt.ad || this.id }; }
      setVolume() {} destroy() {}
      mute() { window.__yt.sound.push("mute"); }
      unMute() { window.__yt.sound.push("unmute"); }
    }
    window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  });
  const lastSound = () => page.evaluate(() => window.__yt.sound.at(-1));
  const cover = page.locator("#cover");

  await page.goto("/");
  await expect(page.locator("#ad-hint")).toBeHidden();
  await page.click("#add-link");
  await page.fill("#link-url", "https://youtu.be/dQw4w9WgXcQ");
  await expect(page.locator("#link-add")).toBeEnabled();
  await page.click("#link-add");
  await page.locator("#tracks li").last().locator(".row").click();

  // Pre-roll: the player is covered by the artwork and muted, then the hint appears.
  await expect(cover).toHaveAttribute("data-embed", "youtube");
  await expect(cover).toHaveAttribute("data-audio-only", "");
  await expect(page.locator("#embed")).toHaveCSS("opacity", "0");
  await expect(page.locator("#cover-letter")).toBeVisible();
  await expect.poll(lastSound).toBe("mute");
  await expect(page.locator("#ad-hint")).toBeVisible();
  await expect(page.locator("#cur")).toHaveText("0:00"); // the fake reports 7 s, but ad time is not forwarded
  // Nothing has started after 4 s, so the player is shown for a tap or a Skip click.
  await expect(cover).not.toHaveAttribute("data-audio-only", "", { timeout: 8000 });
  await expect(page.locator("#embed")).toHaveCSS("opacity", "1");

  // The track itself starts: sound back, hint gone, artwork back, time and duration flow again.
  await page.evaluate(() => window.__yt.player.state(1));
  await expect.poll(lastSound).toBe("unmute");
  await expect(page.locator("#ad-hint")).toBeHidden();
  await expect(cover).toHaveAttribute("data-audio-only", "");
  await expect(page.locator("#dur")).toHaveText("3:33");
  await expect(page.locator("#cur")).toHaveText("0:07");

  // Mid-roll: the player reports another video. "Show player" uncovers it until the ad ends.
  await page.evaluate(() => { window.__yt.ad = "AD0000000ad"; });
  await expect.poll(lastSound).toBe("mute");
  await expect(page.locator("#ad-hint")).toBeVisible();
  await page.click("#ad-show");
  await expect(cover).not.toHaveAttribute("data-audio-only", "");
  // The ad's own "ended" event must not advance the playlist.
  await page.evaluate(() => window.__yt.player.state(0));
  await expect(page.locator("#tracks li").last()).toHaveAttribute("aria-current", "true");
  await page.evaluate(() => { window.__yt.ad = null; window.__yt.player.state(1); });
  await expect.poll(lastSound).toBe("unmute");
  await expect(page.locator("#ad-hint")).toBeHidden();
  await expect(cover).toHaveAttribute("data-audio-only", "");
});

test("YouTube with hideVideo alone covers the player but never mutes it", async ({ page }) => {
  await page.route("**/config.json", (r) => r.fulfill({ json: { playback: { hideVideo: true } } }));
  await page.route("**/oembed**", (r) => r.fulfill({ json: { title: "Stub Video", author_name: "Stub Channel" } }));
  await page.route("https://noembed.com/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.addInitScript(() => {
    window.__yt = { sound: [], vars: null };
    class Player {
      constructor(el, opts) { this.opts = opts; window.__yt.vars = opts.playerVars; window.__yt.player = this; setTimeout(() => opts.events.onReady({ target: this }), 0); }
      state(s) { this.opts.events.onStateChange({ data: s, target: this }); }
      loadVideoById() { this.state(-1); }
      cueVideoById() { this.state(5); }
      playVideo() {} pauseVideo() { this.state(2); } seekTo() {}
      getCurrentTime() { return 0; } getDuration() { return 213; }
      getVideoData() { return { video_id: "AD0000000ad" }; }
      setVolume() {} destroy() {}
      mute() { window.__yt.sound.push("mute"); }
      unMute() { window.__yt.sound.push("unmute"); }
    }
    window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  });

  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", "https://youtu.be/dQw4w9WgXcQ");
  await expect(page.locator("#link-add")).toBeEnabled();
  await page.click("#link-add");
  await page.locator("#tracks li").last().locator(".row").click();

  const cover = page.locator("#cover");
  await expect(cover).toHaveAttribute("data-embed", "youtube");
  await expect(cover).toHaveAttribute("data-audio-only", "");
  expect(await page.evaluate(() => window.__yt.vars.controls)).toBe(0);
  // Still unstarted after 4 s: the player is uncovered. With muteAds off nothing is muted and no hint is shown,
  // even though the fake looks exactly like an ad.
  await expect(cover).not.toHaveAttribute("data-audio-only", "", { timeout: 8000 });
  await expect(page.locator("#ad-hint")).toBeHidden();
  expect(await page.evaluate(() => window.__yt.sound.includes("mute"))).toBe(false);
  await page.evaluate(() => window.__yt.player.state(1));
  await expect(cover).toHaveAttribute("data-audio-only", "");
});

test("YouTube through the resolver plays as plain audio, and falls back to the embed when it fails", async ({ page }) => {
  const RESOLVER = "https://resolver.test";
  await page.route("**/config.json", (r) => r.fulfill({ json: { playback: { hideVideo: true, muteAds: true, resolver: `${RESOLVER}/` } } }));
  await page.route("**/oembed**", (r) => r.fulfill({ json: { title: "Stub Video", author_name: "Stub Channel" } }));
  await page.route("https://noembed.com/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  const asked = [];
  await page.route(`${RESOLVER}/**`, (r) => {
    const url = new URL(r.request().url());
    asked.push(url.pathname + url.search);
    if (url.searchParams.get("id") === "dQw4w9WgXcQ") return r.fulfill({ body: readFileSync("tests/fixtures/tone.wav"), contentType: "audio/wav" });
    r.fulfill({ status: 502, body: "Could not resolve this video" });
  });
  await page.addInitScript(() => {
    window.__yt = { calls: [] };
    class Player {
      constructor(el, opts) { this.opts = opts; setTimeout(() => opts.events.onReady({ target: this }), 0); }
      state(s) { this.opts.events.onStateChange({ data: s, target: this }); }
      loadVideoById(id) { window.__yt.calls.push(["load", id]); this.state(1); }
      cueVideoById(id) { window.__yt.calls.push(["cue", id]); this.state(5); }
      playVideo() { this.state(1); } pauseVideo() { this.state(2); } seekTo() {}
      getCurrentTime() { return 0; } getDuration() { return 213; }
      setVolume() {} mute() {} unMute() {} destroy() {}
    }
    window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  });
  const add = async (link) => {
    await page.click("#add-link");
    await page.fill("#link-url", link);
    await expect(page.locator("#link-add")).toBeEnabled();
    await page.click("#link-add");
  };
  const cover = page.locator("#cover");

  await page.goto("/");
  await add("https://youtu.be/dQw4w9WgXcQ");
  const good = page.locator("#tracks li").last();
  await expect(good.locator(".badge")).toHaveText("YouTube");
  await good.locator(".row").click();

  // Served by the resolver: the html engine plays it, there is no embed, and the YouTube player is never built.
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#dur")).toHaveText("0:02");
  await expect(cover).toHaveAttribute("data-embed", "");
  await expect(page.locator("#ad-hint")).toBeHidden();
  expect(asked[0]).toBe("/v1/audio?id=dQw4w9WgXcQ");
  expect(await page.evaluate(() => window.__yt.calls.length)).toBe(0);

  // The resolver refuses this one: the track is not marked as failed, the embed takes over.
  await add("https://youtu.be/aaaaaaaaaaa");
  const bad = page.locator("#tracks li").last();
  await bad.locator(".row").click();
  await expect(cover).toHaveAttribute("data-embed", "youtube");
  await expect(cover).toHaveAttribute("data-audio-only", "");
  await expect.poll(() => page.evaluate(() => window.__yt.calls[0])).toEqual(["load", "aaaaaaaaaaa"]);
  await expect(bad).toHaveAttribute("aria-current", "true");
  await expect(bad).not.toHaveClass(/bad/);
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
});

test("Spotify link plays through the stubbed embed and reports preview, pause and end", async ({ page }) => {
  await stubSpotify(page);
  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", "https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=share");
  await expect(page.locator("#link-title-input")).toHaveValue("Stub Song");
  await expect(page.locator("#link-artist")).toHaveValue("Spotify");
  await expect(page.locator("#link-provider")).toContainText("Spotify");
  await expect(page.locator("#link-provider")).toContainText("preview");
  await page.click("#link-add");

  const rows = page.locator("#tracks li");
  const row = rows.last();
  await expect(row.locator(".badge")).toHaveText("Spotify");
  await row.locator(".row").click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#cover")).toHaveAttribute("data-embed", "spotify");
  await expect(page.locator("#vol-hint")).toBeVisible();
  await expect(page.locator("#preview-hint")).toBeHidden();
  await expect(page.locator("#dur")).toHaveText("3:33");
  expect(await page.evaluate(() => window.__sp.calls.slice(0, 2))).toEqual([["create", "spotify:track:4cOdK2wGLETKBW3PvgPWqT"], ["play"]]);

  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Play");
  expect(await page.evaluate(() => window.__sp.calls.at(-1))).toEqual(["pause"]);
  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  expect(await page.evaluate(() => window.__sp.calls.at(-1))).toEqual(["resume"]);

  // A 30 s duration means the visitor is not logged in: show the preview hint.
  await page.evaluate(() => { window.__sp.dur = 30000; window.__sp.emit({ isPaused: false, position: 10000 }); });
  await expect(page.locator("#preview-hint")).toBeVisible();
  await expect(page.locator("#dur")).toHaveText("0:30");

  // End of track, as the real embed does it: position reaches duration with isPaused still false, then silence.
  // With repeat "all" the playlist advances once, to the first row.
  await page.click("#repeat");
  await page.evaluate(() => { window.__sp.emit({ isPaused: false, position: 29000 }); window.__sp.emit({ isPaused: false, position: 30000 }); });
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#cover")).toHaveAttribute("data-embed", "");
  await expect(page.locator("#preview-hint")).toBeHidden();
  await expect(page.locator("#vol-hint")).toBeHidden();
  expect(await page.evaluate(() => window.__sp.calls.at(-1))).toEqual(["destroy"]);
});

test("Spotify album is one row whose heading follows the item being played, and ends after the last item", async ({ page }) => {
  await stubSpotify(page, (url) => (url.includes("spotify%3Atrack%3A")
    ? { title: "Item " + decodeURIComponent(url).slice(-1) }
    : { title: "Stub Album", thumbnail_url: `${TONE}#thumb` }));
  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3");
  await expect(page.locator("#link-title-input")).toHaveValue("Stub Album");
  await expect(page.locator("#link-artist")).toHaveValue("Spotify album");
  await expect(page.locator("#link-provider")).toContainText("whole thing");
  await page.click("#link-add");

  const rows = page.locator("#tracks li");
  const row = rows.last();
  await expect(row.locator(".badge")).toHaveText("Spotify");
  await expect(row.locator("small")).toHaveText("Spotify album");
  await row.locator(".row").click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#title")).toHaveText("Stub Album");
  // #play shows Pause as soon as the row is clicked; the fake embed API loads a moment later.
  await page.waitForFunction(() => window.__sp?.calls.length > 0);
  expect(await page.evaluate(() => window.__sp.calls[0])).toEqual(["create", "spotify:album:1DFixLWuPkv3KT3TnV35m3"]);

  // The embed reports which item is playing; the heading shows it with the collection beneath.
  await page.evaluate(() => { window.__sp.dur = 200000; window.__sp.emit({ playingURI: "spotify:track:A1", isPaused: false, position: 0 }); });
  await expect(page.locator("#title")).toHaveText("Item 1");
  await expect(page.locator("#artist")).toHaveText("Stub Album · Spotify album");
  await expect(page.locator("#dur")).toHaveText("3:20");

  // Item 1 reaches its end and item 2 follows at once: the row keeps playing.
  await page.evaluate(() => { window.__sp.emit({ playingURI: "spotify:track:A1", isPaused: false, position: 200000 }); window.__sp.emit({ playingURI: "spotify:track:A2", isPaused: false, position: 0 }); });
  await expect(page.locator("#title")).toHaveText("Item 2");
  await expect(page.locator("#cur")).toHaveText("0:00");
  await page.waitForTimeout(1600);
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");

  // The last item ends and the embed goes quiet: the row is over and, with repeat "all", the first row plays.
  await page.click("#repeat");
  await page.evaluate(() => window.__sp.emit({ playingURI: "spotify:track:A2", isPaused: false, position: 200000 }));
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#title")).not.toHaveText("Item 2");
  await expect(page.locator("#artist")).not.toContainText("Spotify album");
});

test("pasting a link on the page opens the dialog pre-filled", async ({ page }) => {
  await page.goto("/");
  // The paste listener is registered during startup, after config.json has loaded; rows appear after that.
  await expect(page.locator("#tracks li").first()).toBeVisible();
  await page.evaluate((url) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", url);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, TONE);
  await expect(page.locator("#link-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#link-url")).toHaveValue(TONE);
  await expect(page.locator("#link-add")).toBeEnabled();
});
