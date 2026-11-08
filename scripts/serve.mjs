// Minimal static file server with HTTP range support (needed for audio seeking).
// Usage: node scripts/serve.mjs [port]   (default 8000, or PORT env var)
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.argv[2] || process.env.PORT || 8000);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".flac": "audio/flac", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(root, path.normalize(pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); return; }

    const headers = {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "no-cache",
    };
    let start = 0, end = info.size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && info.size) {
      if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
      else if (range[2]) { start = Math.max(0, info.size - Number(range[2])); }
      if (start > end || start >= info.size) { res.writeHead(416, { "content-range": `bytes */${info.size}` }); res.end(); return; }
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["content-length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(e));
  }
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
