import { test, expect } from "@playwright/test";

const TONE = `http://localhost:${process.env.PORT || 8000}/tests/fixtures/tone.wav`;
const ENDPOINT = "https://audit.test/v1/events";

/** Enables auditing against a routed endpoint and returns the list every received event is pushed to. */
async function collect(page) {
  const events = [];
  await page.route("**/config.json", (r) => r.fulfill({ json: { audit: { endpoint: ENDPOINT, flushSeconds: 1 } } }));
  await page.route(ENDPOINT, (r) => {
    const body = JSON.parse(r.request().postData());
    events.push(...body.events.map((e) => ({ ...e, visitorId: body.visitorId })));
    r.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  return events;
}
const ofType = (events, type) => events.filter((e) => e.type === type);

test("opening the app posts session_start and shows a dismissible notice", async ({ page }) => {
  const events = await collect(page);
  await page.goto("/");
  await expect.poll(() => ofType(events, "session_start").length).toBe(1);
  const [start] = ofType(events, "session_start");
  expect(start.seq).toBe(0);
  expect(start.userAgent).toContain("Mozilla");
  expect(start.screen).toMatch(/^\d+x\d+@/);
  expect(start.visitorId).toMatch(/^[A-Za-z0-9-]{8,64}$/);

  await expect(page.locator("#audit-notice")).toBeVisible();
  await page.click("#audit-notice-more");
  await expect(page.locator("#privacy-visitor")).toHaveText(start.visitorId);
  await page.click("#privacy-close");
  await page.click("#audit-notice-ok");
  await expect(page.locator("#audit-notice")).toBeHidden();

  // Same visitor, new session, and the notice stays dismissed.
  await page.reload();
  await expect.poll(() => ofType(events, "session_start").length).toBe(2);
  const [a, b] = ofType(events, "session_start");
  expect(b.visitorId).toBe(a.visitorId);
  expect(b.sessionId).not.toBe(a.sessionId);
  await expect(page.locator("#audit-notice")).toBeHidden();
});

test("audit.notice: false hides the notice but keeps logging and the Privacy panel", async ({ page }) => {
  const events = await collect(page);
  await page.route("**/config.json", (r) => r.fulfill({ json: { audit: { endpoint: ENDPOINT, flushSeconds: 1, notice: false } } }));
  await page.goto("/");
  await expect.poll(() => ofType(events, "session_start").length).toBe(1);
  await expect(page.locator("#audit-notice")).toBeHidden();
  await page.click("#privacy-link");
  await expect(page.locator("#privacy-audit")).toBeVisible();
});

test("audit.privacyLink: false hides the Privacy link but keeps logging", async ({ page }) => {
  const events = await collect(page);
  await page.route("**/config.json", (r) => r.fulfill({ json: { audit: { endpoint: ENDPOINT, flushSeconds: 1, privacyLink: false } } }));
  await page.goto("/");
  await expect.poll(() => ofType(events, "session_start").length).toBe(1);
  await expect(page.locator("#privacy-link")).toBeHidden();
  await page.click("#audit-notice-more");
  await expect(page.locator("#privacy-audit")).toBeVisible();
});

test("adding a link and playing it to the end is logged", async ({ page }) => {
  const events = await collect(page);
  await page.goto("/");
  await page.click("#add-link");
  await page.fill("#link-url", TONE);
  await expect(page.locator("#link-add")).toBeEnabled();
  await page.click("#link-add");

  await expect.poll(() => ofType(events, "track_add").length).toBe(1);
  const [add] = ofType(events, "track_add");
  expect(add).toMatchObject({ source: "url", provider: "direct", url: TONE, title: "tone", duration: 2 });

  await page.locator("#tracks li").last().locator(".row").click();
  await expect.poll(() => ofType(events, "play_end").length, { timeout: 15000 }).toBe(1);
  expect(ofType(events, "play_start")).toHaveLength(1);
  expect(ofType(events, "play_start")[0]).toMatchObject({ trackId: add.trackId, url: TONE });
  const [end] = ofType(events, "play_end");
  expect(end).toMatchObject({ trackId: add.trackId, reason: "ended" });
  expect(end.listenedSec).toBeGreaterThan(1);
  expect(end.listenedSec).toBeLessThan(5);

  // The next visit carries the link in its library snapshot and does not report it as newly added.
  expect(ofType(events, "session_start")[0].library).toEqual([]);
  await page.reload();
  await expect.poll(() => ofType(events, "session_start").length).toBe(2);
  expect(ofType(events, "session_start")[1].personal).toBe(1);
  expect(ofType(events, "session_start")[1].library).toMatchObject([{ trackId: add.trackId, url: TONE, title: "tone" }]);
  await page.locator("#tracks li").last().locator(".rm").click();
  await expect.poll(() => ofType(events, "track_remove").length).toBe(1);
  expect(ofType(events, "track_add")).toHaveLength(1);
});

test("skipping a playing track is logged as skipped", async ({ page }) => {
  const events = await collect(page);
  await page.goto("/");
  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await page.click("#next");
  await expect.poll(() => ofType(events, "play_start").length).toBe(2);
  expect(ofType(events, "play_end")).toHaveLength(1);
  expect(ofType(events, "play_end")[0].reason).toBe("skipped");
  expect(ofType(events, "play_start")[0].source).toBe("repo");

  // Leaving the page closes the open play through a beacon.
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  await expect.poll(() => ofType(events, "play_end").length).toBe(2);
  expect(ofType(events, "play_end")[1]).toMatchObject({ trackId: ofType(events, "play_start")[1].trackId, reason: "closed" });
});

test("events survive a collector outage and are delivered later", async ({ page }) => {
  const events = [];
  let down = true;
  await page.route("**/config.json", (r) => r.fulfill({ json: { audit: { endpoint: ENDPOINT, flushSeconds: 1 } } }));
  await page.route(ENDPOINT, (r) => {
    if (down) return r.abort();
    events.push(...JSON.parse(r.request().postData()).events);
    r.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("music-player:audit-queue") || "[]").length)).toBeGreaterThan(0);
  down = false;
  await page.reload();
  await expect.poll(() => ofType(events, "session_start").length).toBe(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("music-player:audit-queue"))).toBe("[]");
});

test("without an audit endpoint nothing is sent or stored", async ({ page }) => {
  let requests = 0;
  await page.route("**/config.json", (r) => r.fulfill({ json: {} }));
  await page.route("https://audit.test/**", (r) => { requests++; r.abort(); });
  await page.goto("/");
  await page.click("#play");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await page.click("#next");
  await expect(page.locator("#audit-notice")).toBeHidden();
  await page.click("#privacy-link");
  await expect(page.locator("#privacy-audit")).toBeHidden();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /visitor|audit/.test(k)));
  expect(keys).toEqual([]);
  expect(requests).toBe(0);
});
