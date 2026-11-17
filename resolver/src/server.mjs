// YouTube audio resolver (plan.md, "play linked videos as audio only", Phase 2).
// GET /v1/audio?id=<video id> finds the video's audio-only stream with yt-dlp and proxies its bytes,
// passing Range through so the browser's <audio> element can seek. The site never imports this file;
// it only requests that URL when config.json has playback.resolver.
//
// This extracts content from YouTube, which the YouTube terms prohibit. It binds to 127.0.0.1 by
// default and is meant to be run privately; see resolver/README.md before exposing it.
import http from "node:http";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const ID = /^[\w-]{11}$/;
const PASS = ["content-type", "content-length", "content-range", "last-modified", "etag"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks yt-dlp for the direct URL of the best audio-only stream. M4A first: Safari cannot play WebM/Opus.
 * Resolves to { url, availableAt }: YouTube refuses a freshly issued URL with 403 until a few seconds
 * have passed (yt-dlp's own downloader sleeps for the same reason), and availableAt is that moment in ms.
 */
export function ytDlpResolve(id, { bin = process.env.YTDLP_PATH || "yt-dlp", timeout = 25000 } = {}) {
  return new Promise((res, rej) => {
    const args = ["-f", "bestaudio[ext=m4a]/bestaudio", "-O", "%(url)s", "-O", "%(available_at)s", "--no-playlist", "--no-warnings", `https://www.youtube.com/watch?v=${id}`];
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      const [url, at] = String(stdout || "").trim().split(/\r?\n/);
      if (err || !/^https?:\/\//.test(url || "")) return rej(new Error(String(stderr || err?.message || "no stream found").trim().split(/\r?\n/).pop()));
      res({ url, availableAt: Number(at) > 0 ? Number(at) * 1000 : 0 });
    });
  });
}

/**
 * Builds the request handler. Options:
 *   resolve(id) -> Promise<url | { url, availableAt }>   stream lookup (yt-dlp by default; tests inject a fake)
 *   retryMs                        pause before asking again for a stream that answered 403 (it may not be available yet)
 *   allowedOrigins                 if non-empty, the request's Origin or Referer must start with one of them.
 *                                  Both headers can be forged; this only stops other sites embedding the URL.
 *   maxStreams                     concurrent proxied responses before answering 503
 */
export function createHandler({ resolve = ytDlpResolve, allowedOrigins = [], maxStreams = 8, cacheMax = 500, retryMs = 1500 } = {}) {
  const cache = new Map(); // id -> { promise, until }
  let streams = 0;

  function lookup(id, fresh = false) {
    const hit = cache.get(id);
    if (!fresh && hit && hit.until > Date.now()) return hit.promise;
    const entry = { until: Date.now() + 60000, promise: null };
    entry.promise = resolve(id).then(async (found) => {
      const { url, availableAt = 0 } = typeof found === "string" ? { url: found } : found;
      // Not usable yet: wait (never more than 15 s) rather than hand out a URL that answers 403.
      const wait = Math.min(availableAt + 300 - Date.now(), 15000);
      if (wait > 0) await sleep(wait);
      // googlevideo URLs carry their own expiry (epoch seconds); otherwise keep the answer for an hour.
      const exp = Number(new URL(url).searchParams.get("expire")) * 1000;
      entry.until = exp > Date.now() ? exp - 60000 : Date.now() + 3600000;
      return url;
    });
    entry.promise.catch(() => { if (cache.get(id) === entry) cache.delete(id); });
    cache.delete(id);
    cache.set(id, entry);
    if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    return entry.promise;
  }

  const send = (res, status, text, headers = {}) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(text);
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://resolver");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    if (url.pathname === "/healthz") return send(res, 200, "ok");
    if (url.pathname !== "/v1/audio") return send(res, 404, "Not found");

    if (allowedOrigins.length) {
      const from = req.headers.origin || req.headers.referer || "";
      if (!allowedOrigins.some((o) => from === o || from.startsWith(`${o}/`))) return send(res, 403, "Origin not allowed");
    }
    const id = url.searchParams.get("id") || "";
    if (!ID.test(id)) return send(res, 400, "Bad video id");
    if (streams >= maxStreams) return send(res, 503, "Busy", { "Retry-After": "5" });

    streams++;
    const abort = new AbortController();
    let released = false;
    const release = () => { if (!released) { released = true; streams--; abort.abort(); } };
    res.on("close", release);

    try {
      const headers = req.headers.range ? { Range: req.headers.range } : {};
      const open = async (fresh) => fetch(await lookup(id, fresh), { headers, signal: abort.signal });
      let up = await open(false);
      const refused = () => up.status === 403 || up.status === 410;
      // A refusal can mean "not available yet": give the same URL two more tries before looking it up again once.
      for (let i = 0; i < 2 && refused(); i++) { await up.body?.cancel(); await sleep(retryMs); up = await open(false); }
      if (refused()) { await up.body?.cancel(); up = await open(true); }
      if (!up.ok) { await up.body?.cancel(); return send(res, 502, `Upstream answered ${up.status}`); }

      const out = { "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
      for (const h of PASS) { const v = up.headers.get(h); if (v) out[h] = v; }
      res.writeHead(up.status, out);
      if (req.method === "HEAD" || !up.body) { await up.body?.cancel(); return res.end(); }
      Readable.fromWeb(up.body).on("error", () => res.destroy()).pipe(res);
    } catch (e) {
      if (!res.headersSent) send(res, 502, `Could not resolve this video: ${e.message}`);
      else res.destroy();
    }
  };
}

// Run directly: node src/server.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8790), host = process.env.HOST || "127.0.0.1";
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const maxStreams = Number(process.env.MAX_STREAMS || 8);
  http.createServer(createHandler({ allowedOrigins, maxStreams })).listen(port, host, () => {
    console.log(`Mixtape resolver on http://${host}:${port} (origins: ${allowedOrigins.join(", ") || "any"})`);
  });
}
