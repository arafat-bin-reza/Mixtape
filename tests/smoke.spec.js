import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const repoCount = JSON.parse(readFileSync("data/tracks.json", "utf8")).length;

test.beforeEach(async ({ page }) => {
  // Keep smoke tests independent of the Cloudinary account and the shared list.
  await page.route("**/config.json", (r) => r.fulfill({ json: {} }));
});

test("loads with no console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("#tracks li")).toHaveCount(repoCount);
  expect(errors).toEqual([]);
});

test("play button toggles", async ({ page }) => {
  await page.goto("/");
  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Play");
});

test("next moves the highlight", async ({ page }) => {
  await page.goto("/");
  await page.click("#next");
  await expect(page.locator("#tracks li").nth(1)).toHaveAttribute("aria-current", "true");
});

test("shuffle and repeat toggle", async ({ page }) => {
  await page.goto("/");
  await page.click("#shuffle");
  await expect(page.locator("#shuffle")).toHaveAttribute("aria-pressed", "true");
  await page.click("#repeat");
  await expect(page.locator("#repeat")).toHaveAttribute("data-mode", "all");
});
