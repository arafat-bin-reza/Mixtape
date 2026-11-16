import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const repoCount = JSON.parse(readFileSync("data/tracks.json", "utf8")).length;
const FIXTURE = "tests/fixtures/tone.wav";
const CONFIG = { cloudinary: { cloudName: "tivkdskh", uploadPreset: "mixtape-unsigned", folder: "mixtape", sharedTag: "mixtape-public", maxBytes: 1048576 } };
const UPLOAD_URL = "https://api.cloudinary.com/v1_1/tivkdskh/video/upload";

function stubCloudinary(page, { fail, silent } = {}) {
  const uploads = [];
  page.route("**/config.json", (r) => r.fulfill({ json: CONFIG }));
  page.route("https://res.cloudinary.com/tivkdskh/video/list/**", (r) => r.fulfill({ status: 401, body: "" }));
  page.route(UPLOAD_URL, async (r) => {
    uploads.push(r.request());
    if (fail) return r.fulfill({ status: 400, json: { error: { message: "Upload preset not found" } } });
    if (silent) return r.fulfill({ json: { public_id: "mixtape/silent1", duration: 2, bytes: 32044, is_audio: false, audio: {}, video: { codec: "h264" } } });
    r.fulfill({ json: { public_id: "mixtape/abc123", duration: 2, bytes: 32044, secure_url: "https://res.cloudinary.com/tivkdskh/video/upload/v1/mixtape/abc123.wav" } });
  });
  // Serve the "transcoded" rendition and waveform from local fixtures.
  page.route("https://res.cloudinary.com/tivkdskh/video/upload/**", (r) => {
    const url = r.request().url();
    if (url.endsWith(".mp3")) return r.fulfill({ body: readFileSync(FIXTURE), contentType: "audio/wav" });
    r.fulfill({ status: 404, body: "" });
  });
  return uploads;
}

test("files upload to Cloudinary and become playable cloud tracks", async ({ page }) => {
  const uploads = stubCloudinary(page);
  await page.goto("/");
  await page.setInputFiles("#file", FIXTURE);

  const dialog = page.locator("#upload-dialog");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.locator(".consent")).toContainText("uploaded to Mixtape's cloud storage");
  await expect(dialog.locator(".u-title")).toHaveValue("tone");
  await dialog.locator(".u-artist").fill("Cloud Artist");
  await page.click("#upload-start");
  await expect(page.locator("#upload-start")).toHaveText("Close");
  await expect(dialog.locator(".status")).toHaveText("Uploaded.");
  await page.click("#upload-start");
  await expect(dialog).not.toHaveAttribute("open", "");

  expect(uploads).toHaveLength(1);
  const body = uploads[0].postData() || "";
  expect(body).toContain('name="upload_preset"\r\n\r\nmixtape-unsigned');
  expect(body).toContain('name="folder"\r\n\r\nmixtape');
  expect(body).toContain("caption=tone|alt=Cloud Artist");
  expect(body).not.toContain("api_key");

  const row = page.locator("#tracks li").last();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(row.locator(".badge")).toHaveText("Cloud");
  await row.locator(".row").click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#dur")).toHaveText("0:02");

  await page.reload();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(page.locator("#tracks li").last().locator(".badge")).toHaveText("Cloud");
});

test("a video in any container uploads and plays as audio", async ({ page }) => {
  const uploads = stubCloudinary(page);
  await page.goto("/");
  await page.setInputFiles("#file", { name: "clip.mkv", mimeType: "video/x-matroska", buffer: readFileSync(FIXTURE) });
  const dialog = page.locator("#upload-dialog");
  await expect(dialog.locator(".consent")).toContainText("played as audio only");
  await expect(dialog.locator(".u-title")).toHaveValue("clip");
  await expect(dialog.locator(".keep")).toBeHidden();
  await page.click("#upload-start");
  await expect(dialog.locator(".status")).toHaveText("Uploaded.");
  await page.click("#upload-start");
  expect(uploads).toHaveLength(1);

  const row = page.locator("#tracks li").last();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(row.locator(".badge")).toHaveText("Cloud");
  const played = page.waitForRequest((r) => r.url().endsWith("/mixtape/abc123.mp3"));
  await row.locator(".row").click();
  await played;
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#cover")).toHaveAttribute("data-embed", "");
});

test("a video with no audio track is refused after upload", async ({ page }) => {
  stubCloudinary(page, { silent: true });
  await page.goto("/");
  await page.setInputFiles("#file", { name: "silent.mp4", mimeType: "video/mp4", buffer: readFileSync(FIXTURE) });
  await page.click("#upload-start");
  const dialog = page.locator("#upload-dialog");
  await expect(dialog.locator(".status")).toContainText("no audio track");
  await expect(dialog.locator(".keep")).toBeVisible();
  await page.click("#upload-start");
  await expect(page.locator("#tracks li")).toHaveCount(repoCount);
});

test("files that are neither audio nor video are rejected before any request is sent", async ({ page }) => {
  const uploads = stubCloudinary(page);
  await page.goto("/");
  await page.setInputFiles("#file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  const dialog = page.locator("#upload-dialog");
  await expect(dialog.locator(".status")).toContainText("not an audio or video file");
  await expect(page.locator("#upload-start")).toBeDisabled();
  expect(uploads).toHaveLength(0);
});

test("oversize files are rejected before any request is sent", async ({ page }) => {
  const uploads = stubCloudinary(page);
  await page.route("**/config.json", (r) => r.fulfill({ json: { cloudinary: { ...CONFIG.cloudinary, maxBytes: 100 } } }));
  await page.goto("/");
  await page.setInputFiles("#file", FIXTURE);
  const dialog = page.locator("#upload-dialog");
  await expect(dialog.locator(".status")).toContainText("larger than");
  await expect(page.locator("#upload-start")).toBeDisabled();
  await expect(dialog.locator(".keep")).toBeVisible();
  expect(uploads).toHaveLength(0);
});

test("a failed upload offers to keep the file on this device", async ({ page }) => {
  stubCloudinary(page, { fail: true });
  await page.goto("/");
  await page.setInputFiles("#file", FIXTURE);
  await page.click("#upload-start");
  const dialog = page.locator("#upload-dialog");
  await expect(dialog.locator(".status")).toContainText("Upload preset not found");
  await dialog.locator(".keep").click();
  await expect(dialog.locator(".status")).toContainText("Kept on this device only");
  await page.click("#upload-start");
  const row = page.locator("#tracks li").last();
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(row.locator(".badge")).toHaveCount(0);
  await expect(row.locator(".rm")).toBeVisible();
});

test("without cloud config, Add files stores on the device only", async ({ page }) => {
  let requests = 0;
  await page.route("**/config.json", (r) => r.fulfill({ json: {} }));
  await page.route("https://api.cloudinary.com/**", (r) => { requests++; r.abort(); });
  await page.goto("/");
  await page.setInputFiles("#file", FIXTURE);
  await expect(page.locator("#upload-dialog")).not.toHaveAttribute("open", "");
  await expect(page.locator("#tracks li")).toHaveCount(repoCount + 1);
  await expect(page.locator("#tracks li").last().locator(".badge")).toHaveCount(0);
  expect(requests).toBe(0);
});
