import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const repoCount = JSON.parse(readFileSync("data/tracks.json", "utf8")).length;
const TONE = "http://localhost:8000/tests/fixtures/tone.wav";

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

test("pasting a link on the page opens the dialog pre-filled", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((url) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", url);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, TONE);
  await expect(page.locator("#link-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#link-url")).toHaveValue(TONE);
  await expect(page.locator("#link-add")).toBeEnabled();
});
