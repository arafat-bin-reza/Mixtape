import { test, expect } from "@playwright/test";

test("loads with no console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("#tracks li")).toHaveCount(3);
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
