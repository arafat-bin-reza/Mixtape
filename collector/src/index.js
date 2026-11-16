// Mixtape audit collector (plan.md Part D): a Cloudflare Worker writing to D1.
// POST /v1/events is public and validated; the /v1/admin/* data routes need the ADMIN_TOKEN secret.
// Pure helpers live in lib.js: a Worker entry module may only export handlers.
import { MAX_BODY, parseBatch, parseUA, toCsv } from "./lib.js";
import { ADMIN_PAGE } from "./admin-page.js";

const nul = (v) => v ?? null;
const J = (path) => `json_extract(value, '$.${path}')`;

// Rows travel as one JSON parameter and are expanded with json_each, so a batch costs a handful of
// queries however many events it holds (D1 limits the number of queries per Worker invocation).
async function store(db, { visitorId, events }, { ip, cf, ua, now }) {
  const sessionIds = [...new Set(events.map((e) => e.sessionId))];
  const rows = events.map((e) => {
    const { trackId, listenedSec, reason, library, ...detail } = e.fields;
    if (library) detail.libraryCount = library.length; // the tracks themselves go to the catalogue
    return { s: e.sessionId, q: e.seq, c: e.ts, t: e.type, k: nul(trackId), l: nul(listenedSec), r: nul(reason), d: JSON.stringify(detail) };
  });
  const [, inserted] = await db.batch([
    db.prepare(
      "INSERT INTO sessions (id, visitor_id, started_at, last_seen_at, ip, country, region, city, asn, as_org, user_agent) " +
      "SELECT value, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM json_each(?) WHERE true " +
      "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
    ).bind(visitorId, now, now, ip, nul(cf.country), nul(cf.region), nul(cf.city), nul(cf.asn), nul(cf.asOrganization), nul(ua), JSON.stringify(sessionIds)),
    db.prepare(
      "INSERT OR IGNORE INTO events (session_id, visitor_id, seq, client_ts, received_at, ip, type, track_id, listened_sec, reason, detail) " +
      `SELECT ${J("s")}, ?, ${J("q")}, ${J("c")}, ?, ?, ${J("t")}, ${J("k")}, ${J("l")}, ${J("r")}, ${J("d")} FROM json_each(?) ` +
      "RETURNING session_id, seq",
    ).bind(visitorId, now, ip, JSON.stringify(rows)),
  ]);

  // Follow-up writes only for events that were really inserted, so a retried batch neither double counts nor overwrites device details.
  const fresh = new Set(inserted.results.map((r) => `${r.session_id}:${r.seq}`));
  const follow = [], catalogue = [], listened = [];
  for (const e of events) {
    if (!fresh.has(`${e.sessionId}:${e.seq}`)) continue;
    const f = e.fields;
    if (e.type === "session_start") {
      const d = parseUA(ua || f.userAgent, f);
      follow.push(db.prepare(
        "UPDATE sessions SET browser=?, os=?, device_type=?, device_model=?, screen=?, language=?, time_zone=?, referrer=? WHERE id=? AND visitor_id=?",
      ).bind(d.browser, d.os, d.deviceType, d.deviceModel, nul(f.screen), nul(f.language), nul(f.timeZone), nul(f.referrer), e.sessionId, visitorId));
      for (const t of f.library || []) catalogue.push({ ...t, add: 0, play: 0 }); // already in the visitor's browser
    } else if (e.type === "track_add") catalogue.push({ ...f, add: 1, play: 0 });
    else if (e.type === "play_start") catalogue.push({ ...f, add: 0, play: 1 });
    else if (e.type === "play_end" && f.listenedSec > 0) listened.push({ id: f.trackId, sec: f.listenedSec });
  }
  if (catalogue.length) {
    follow.push(db.prepare(
      "INSERT INTO tracks (track_id, source, provider, kind, url, external_id, title, artist, duration, cover, file_name, bytes, mime, " +
      "first_seen_at, first_visitor_id, first_ip, last_seen_at, add_count, play_count) " +
      `SELECT ${["trackId", "source", "provider", "kind", "url", "externalId", "title", "artist", "duration", "cover", "fileName", "bytes", "mime"].map(J).join(", ")}, ` +
      `?, ?, ?, ?, ${J("add")}, ${J("play")} FROM json_each(?) WHERE true ` +
      "ON CONFLICT(track_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, " +
      "add_count = tracks.add_count + excluded.add_count, play_count = tracks.play_count + excluded.play_count, " +
      "url = COALESCE(tracks.url, excluded.url), title = COALESCE(tracks.title, excluded.title), artist = COALESCE(tracks.artist, excluded.artist), " +
      "duration = COALESCE(tracks.duration, excluded.duration), cover = COALESCE(tracks.cover, excluded.cover), " +
      "file_name = COALESCE(tracks.file_name, excluded.file_name), bytes = COALESCE(tracks.bytes, excluded.bytes), mime = COALESCE(tracks.mime, excluded.mime)",
    ).bind(now, visitorId, ip, now, JSON.stringify(catalogue)));
  }
  if (listened.length) {
    const json = JSON.stringify(listened);
    follow.push(db.prepare(
      `UPDATE tracks SET last_seen_at = ?, listened_sec = listened_sec + (SELECT SUM(${J("sec")}) FROM json_each(?) WHERE ${J("id")} = tracks.track_id) ` +
      `WHERE track_id IN (SELECT ${J("id")} FROM json_each(?))`,
    ).bind(now, json, json));
  }
  if (follow.length) await db.batch(follow);
}

async function ingest(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
  const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE) {
    const { success } = await env.RATE.limit({ key: ip });
    if (!success) return new Response("Too many requests", { status: 429, headers: cors });
  }
  if (Number(req.headers.get("Content-Length")) > MAX_BODY) return new Response("Too large", { status: 413, headers: cors });
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY) return new Response("Too large", { status: 413, headers: cors });
  const batch = parseBatch(new TextDecoder().decode(bytes));
  if (batch.error) return new Response("Bad request", { status: 400, headers: cors });
  // A storage failure must never reach the app: log it and still answer 204.
  try { await store(env.DB, batch, { ip, cf: req.cf || {}, ua: req.headers.get("User-Agent"), now: Date.now() }); }
  catch (err) { console.error("store failed", err?.message || err); }
  return new Response(null, { status: 204, headers: cors });
}

// ---------- Admin ----------

async function sameToken(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/** Milliseconds from a number or a date. A bare end date covers that whole day. */
function when(v, end = false) {
  if (v == null || v === "") return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (isNaN(t)) return null;
  return end && /^\d{4}-\d\d-\d\d$/.test(v) ? t + 86399999 : t;
}

/** Raw tables and the four views of plan.md section 36. `need` lists filters of which at least one is required. */
const QUERIES = {
  sessions: { sql: "SELECT * FROM sessions /*where*/ ORDER BY started_at DESC", time: "started_at", filters: { ip: "ip", visitor: "visitor_id" } },
  events: {
    sql: "SELECT * FROM events /*where*/ ORDER BY received_at DESC, id DESC", time: "received_at",
    filters: { ip: "ip", visitor: "visitor_id", track: "track_id", session: "session_id", type: "type" },
  },
  tracks: {
    sql: "SELECT * FROM tracks /*where*/ ORDER BY last_seen_at DESC", time: "first_seen_at",
    filters: { track: "track_id", provider: "provider", visitor: "first_visitor_id", ip: "first_ip" },
  },
  "report/visitors": {
    sql: "SELECT s.visitor_id, s.ip, s.country, s.city, s.browser, s.os, s.device_type, s.device_model, s.screen, COUNT(DISTINCT s.id) AS sessions, " +
      "ROUND(COALESCE(SUM(e.listened_sec), 0)) AS listened_sec, MIN(s.started_at) AS first_seen_at, MAX(s.last_seen_at) AS last_seen_at " +
      "FROM sessions s LEFT JOIN events e ON e.session_id = s.id AND e.type = 'play_end' /*where*/ GROUP BY s.visitor_id, s.ip ORDER BY last_seen_at DESC",
    time: "s.started_at", filters: { ip: "s.ip", visitor: "s.visitor_id" },
  },
  "report/activity": {
    sql: "SELECT e.received_at, e.visitor_id, e.ip, e.type, e.track_id, t.title, t.artist, t.url, e.listened_sec, e.reason " +
      "FROM events e LEFT JOIN tracks t ON t.track_id = e.track_id /*where*/ ORDER BY e.received_at DESC, e.seq DESC",
    time: "e.received_at", filters: { ip: "e.ip", visitor: "e.visitor_id" }, need: ["ip", "visitor"],
  },
  "report/links": {
    sql: "SELECT e.received_at, t.provider, t.title, t.artist, t.url, t.file_name, e.track_id, e.visitor_id, e.ip, s.country, s.city, s.browser, s.os, s.device_type " +
      "FROM events e LEFT JOIN tracks t ON t.track_id = e.track_id LEFT JOIN sessions s ON s.id = e.session_id /*where*/ ORDER BY e.received_at DESC",
    time: "e.received_at", filters: { ip: "e.ip", visitor: "e.visitor_id", track: "e.track_id" }, fixed: "e.type = 'track_add'",
  },
  "report/top": {
    sql: "SELECT track_id, title, artist, provider, url, play_count, add_count, ROUND(listened_sec) AS listened_sec, first_seen_at, last_seen_at " +
      "FROM tracks /*where*/ ORDER BY play_count DESC, listened_sec DESC",
    time: "last_seen_at", filters: { track: "track_id", provider: "provider" },
  },
  "report/plays": {
    sql: "SELECT e.received_at, e.visitor_id, e.ip, s.country, s.city, s.browser, s.os, s.device_type, e.listened_sec, e.reason " +
      "FROM events e LEFT JOIN sessions s ON s.id = e.session_id /*where*/ ORDER BY e.received_at DESC",
    time: "e.received_at", filters: { track: "e.track_id", ip: "e.ip", visitor: "e.visitor_id" }, need: ["track"], fixed: "e.type = 'play_end'",
  },
};

async function admin(req, env, url) {
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || !given || !(await sameToken(given, env.ADMIN_TOKEN))) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  const path = url.pathname.replace(/\/+$/, "");
  const del = /^\/v1\/admin\/visitors\/([A-Za-z0-9_-]{8,64})$/.exec(path);
  if (del) {
    if (req.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
    const r = await env.DB.batch([
      env.DB.prepare("DELETE FROM events WHERE visitor_id = ?").bind(del[1]),
      env.DB.prepare("DELETE FROM sessions WHERE visitor_id = ?").bind(del[1]),
      env.DB.prepare("UPDATE tracks SET first_visitor_id = NULL, first_ip = NULL WHERE first_visitor_id = ?").bind(del[1]),
    ]);
    return Response.json({ visitor: del[1], events: r[0].meta.changes, sessions: r[1].meta.changes, tracks: r[2].meta.changes });
  }
  const name = path.slice("/v1/admin/".length);
  const view = Object.hasOwn(QUERIES, name) ? QUERIES[name] : null;
  if (!view) return new Response("Not found", { status: 404 });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const q = url.searchParams, where = view.fixed ? [view.fixed] : [], args = [];
  if (view.need && !view.need.some((p) => q.get(p))) return new Response(`Needs one of: ${view.need.join(", ")}`, { status: 400 });
  const from = when(q.get("from")), to = when(q.get("to"), true);
  if (from != null) { where.push(`${view.time} >= ?`); args.push(from); }
  if (to != null) { where.push(`${view.time} <= ?`); args.push(to); }
  for (const [param, col] of Object.entries(view.filters)) {
    if (q.get(param)) { where.push(`${col} = ?`); args.push(q.get(param)); }
  }
  const limit = Math.min(Math.max(parseInt(q.get("limit"), 10) || 500, 1), 5000);
  const sql = view.sql.replace("/*where*/", where.length ? "WHERE " + where.join(" AND ") : "") + " LIMIT ?";
  const { results } = await env.DB.prepare(sql).bind(...args, limit).all();
  // Readable UTC timestamps beside the millisecond columns.
  const rows = results.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v;
      if (/_(at|ts)$/.test(k) && typeof v === "number") out[k.replace(/_(at|ts)$/, "_utc")] = new Date(v).toISOString();
    }
    return out;
  });
  if (q.get("format") === "csv") {
    return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace("/", "-")}.csv"`, "Cache-Control": "no-store" } });
  }
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** The admin page is a static shell with no data in it; every table it shows comes from the token-protected routes above. */
const adminPage = () => new Response(ADMIN_PAGE, {
  headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
});

async function purge(env) {
  const days = Number(env.RETENTION_DAYS) || 365;
  const cutoff = Date.now() - days * 86400000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE received_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM sessions WHERE last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM events WHERE events.session_id = sessions.id)").bind(cutoff),
    env.DB.prepare("UPDATE tracks SET first_ip = NULL, first_visitor_id = NULL WHERE first_seen_at < ? AND first_ip IS NOT NULL").bind(cutoff),
  ]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/v1/events") return await ingest(req, env);
      if (url.pathname === "/v1/admin" || url.pathname === "/v1/admin/") {
        return req.method === "GET" ? adminPage() : new Response("Method not allowed", { status: 405 });
      }
      if (url.pathname.startsWith("/v1/admin/")) return await admin(req, env, url);
    } catch (err) {
      console.error(err?.message || err);
      return new Response("Server error", { status: 500 });
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};
