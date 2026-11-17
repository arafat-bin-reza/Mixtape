import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHandler } from "../../resolver/src/server.mjs";

// A stand-in for the stream host: serves 100 bytes with Range support, and can be told to refuse one request.
const DATA = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
let upstream, base, refuse = 0;

before(async () => {
  upstream = http.createServer((req, res) => {
    if (refuse > 0) { refuse--; res.writeHead(403); return res.end(); }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (!m) { res.writeHead(200, { "Content-Type": "audio/mp4", "Content-Length": DATA.length }); return res.end(DATA); }
    const start = +m[1], end = m[2] ? +m[2] : DATA.length - 1;
    res.writeHead(206, { "Content-Type": "audio/mp4", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${DATA.length}` });
    res.end(DATA.subarray(start, end + 1));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${upstream.address().port}/stream`;
});
after(() => upstream.close());

async function withResolver(opts, fn) {
  const server = http.createServer(createHandler(opts));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); server.close(); }
}
const ID = "dQw4w9WgXcQ";

test("resolver proxies the whole stream and caches the lookup", async () => {
  let lookups = 0;
  await withResolver({ resolve: async () => { lookups++; return base; } }, async (url) => {
    const r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mp4");
    assert.equal(r.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), DATA);
    await (await fetch(`${url}/v1/audio?id=${ID}`)).arrayBuffer();
    assert.equal(lookups, 1);
  });
});

test("resolver passes Range through so the browser can seek", async () => {
  await withResolver({ resolve: async () => base }, async (url) => {
    const r = await fetch(`${url}/v1/audio?id=${ID}`, { headers: { Range: "bytes=10-19" } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 10-19/100");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), DATA.subarray(10, 20));
  });
});

test("resolver retries a refused stream, then looks it up again once", async () => {
  let lookups = 0;
  await withResolver({ resolve: async () => { lookups++; return base; }, retryMs: 5 }, async (url) => {
    refuse = 1; // refused once: the same URL works on the retry, no second lookup
    let r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 200);
    await r.arrayBuffer();
    assert.equal(lookups, 1);

    refuse = 3; // refused on every try of the cached URL: looked up again
    r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 200);
    await r.arrayBuffer();
    assert.equal(lookups, 2);

    refuse = 4; // still refused after the second lookup: reported, not retried for ever
    r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 502);
    refuse = 0;
  });
});

test("resolver waits until a fresh stream URL becomes available", async () => {
  await withResolver({ resolve: async () => ({ url: base, availableAt: Date.now() + 400 }) }, async (url) => {
    const t0 = Date.now();
    const r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 200);
    await r.arrayBuffer();
    assert.ok(Date.now() - t0 >= 400, "answered before the stream was available");
  });
});

test("resolver rejects bad ids, unknown routes and failed lookups", async () => {
  await withResolver({ resolve: async () => { throw new Error("Video unavailable"); } }, async (url) => {
    assert.equal((await fetch(`${url}/v1/audio?id=../etc`)).status, 400);
    assert.equal((await fetch(`${url}/v1/audio`)).status, 400);
    assert.equal((await fetch(`${url}/nope`)).status, 404);
    assert.equal((await fetch(`${url}/v1/audio?id=${ID}`, { method: "POST" })).status, 405);
    const r = await fetch(`${url}/v1/audio?id=${ID}`);
    assert.equal(r.status, 502);
    assert.match(await r.text(), /Video unavailable/);
    assert.equal(await (await fetch(`${url}/healthz`)).text(), "ok");
  });
});

test("resolver enforces the origin allowlist when one is set", async () => {
  await withResolver({ resolve: async () => base, allowedOrigins: ["https://example.github.io"] }, async (url) => {
    assert.equal((await fetch(`${url}/v1/audio?id=${ID}`)).status, 403);
    assert.equal((await fetch(`${url}/v1/audio?id=${ID}`, { headers: { Referer: "https://example.github.io.evil.test/" } })).status, 403);
    const ok = await fetch(`${url}/v1/audio?id=${ID}`, { headers: { Referer: "https://example.github.io/Mixtape/" } });
    assert.equal(ok.status, 200);
    await ok.arrayBuffer();
  });
});

test("resolver answers 503 when every stream slot is in use", async () => {
  await withResolver({ resolve: async () => base, maxStreams: 0 }, async (url) => {
    assert.equal((await fetch(`${url}/v1/audio?id=${ID}`)).status, 503);
  });
});
