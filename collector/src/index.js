// Mixtape audit collector (plan.md Part D): a Cloudflare Worker writing to D1.
// POST /v1/events is public and validated; /v1/admin/* needs the ADMIN_TOKEN secret.
// Pure helpers live in lib.js: a Worker entry module may only export handlers.
import { MAX_BODY, parseBatch, parseUA, toCsv } from "./lib.js";

const nul = (v) => v ?? null;

async function store(db, { visitorId, events }, { ip, cf, ua, now }) {
  const stmts = [];
  const upsertSession = db.prepare(
    "INSERT INTO sessions (id, visitor_id, started_at, last_seen_at, ip, country, region, city, asn, as_org, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at");
  for (const id of new Set(events.map((e) => e.sessionId))) {
    stmts.push(upsertSession.bind(id, visitorId, now, now, ip, nul(cf.country), nul(cf.region), nul(cf.city), nul(cf.asn), nul(cf.asOrganization), nul(ua)));
  }
  const first = stmts.length;
  const insertEvent = db.prepare(
    "INSERT OR IGNORE INTO events (session_id, visitor_id, seq, client_ts, received_at, ip, type, track_id, listened_sec, reason, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const e of events) {
    const { trackId, listenedSec, reason, ...detail } = e.fields;
    stmts.push(insertEvent.bind(e.sessionId, visitorId, e.seq, e.ts, now, ip, e.type, nul(trackId), nul(listenedSec), nul(reason), JSON.stringify(detail)));
  }
  const results = await db.batch(stmts);

  // Follow-up writes only for events that were really inserted, so a retried batch neither double counts nor overwrites device details.
  const follow = [];
  const upsertTrack = db.prepare(
    "INSERT INTO tracks (track_id, source, provider, kind, url, external_id, title, artist, duration, cover, file_name, bytes, mime, " +
    "first_seen_at, first_visitor_id, first_ip, last_seen_at, add_count, play_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(track_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, " +
    "add_count = tracks.add_count + excluded.add_count, play_count = tracks.play_count + excluded.play_count, " +
    "url = COALESCE(tracks.url, excluded.url), title = COALESCE(tracks.title, excluded.title), artist = COALESCE(tracks.artist, excluded.artist), " +
    "duration = COALESCE(tracks.duration, excluded.duration), cover = COALESCE(tracks.cover, excluded.cover), " +
    "file_name = COALESCE(tracks.file_name, excluded.file_name), bytes = COALESCE(tracks.bytes, excluded.bytes), mime = COALESCE(tracks.mime, excluded.mime)");
  events.forEach((e, i) => {
    if (!results[first + i]?.meta?.changes) return;
    const f = e.fields;
    if (e.type === "session_start") {
      const d = parseUA(ua || f.userAgent, f);
      follow.push(db.prepare(
        "UPDATE sessions SET browser=?, os=?, device_type=?, device_model=?, screen=?, language=?, time_zone=?, referrer=? WHERE id=? AND visitor_id=?",
      ).bind(d.browser, d.os, d.deviceType, d.deviceModel, nul(f.screen), nul(f.language), nul(f.timeZone), nul(f.referrer), e.sessionId, visitorId));
    } else if (e.type === "track_add" || e.type === "play_start") {
      follow.push(upsertTrack.bind(
        f.trackId, nul(f.source), nul(f.provider), nul(f.kind), nul(f.url), nul(f.externalId), nul(f.title), nul(f.artist), nul(f.duration), nul(f.cover),
        nul(f.fileName), nul(f.bytes), nul(f.mime), now, visitorId, ip, now,
        e.type === "track_add" && !f.existing ? 1 : 0, e.type === "play_start" ? 1 : 0));
    } else if (e.type === "play_end" && f.listenedSec > 0) {
      follow.push(db.prepare("UPDATE tracks SET listened_sec = listened_sec + ?, last_seen_at = ? WHERE track_id = ?").bind(f.listenedSec, now, f.trackId));
    }
  });
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
  const text = await req.text();
  if (text.length > MAX_BODY) return new Response("Too large", { status: 413, headers: cors });
  const batch = parseBatch(text);
  if (batch.error) return new Response("Bad request", { status: 400, headers: cors });
  // A storage failure must never reach the app: log it and still answer 204.
  try { await store(env.DB, batch, { ip, cf: req.cf || {}, ua: req.headers.get("User-Agent"), now: Date.now() }); }
  catch (err) { console.error("store failed", err?.message || err); }
  return new Response(null, { status: 204, headers: cors });
}

// ---------- Admin ----------

const VIEWS = {
  sessions: { time: "started_at", order: "started_at DESC", filters: { ip: "ip", visitor: "visitor_id" } },
  events: { time: "received_at", order: "received_at DESC, id DESC", filters: { ip: "ip", visitor: "visitor_id", track: "track_id", session: "session_id", type: "type" } },
  tracks: { time: "first_seen_at", order: "last_seen_at DESC", filters: { track: "track_id", provider: "provider", visitor: "first_visitor_id", ip: "first_ip" } },
};

async function sameToken(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const when = (v) => (v == null || v === "" ? null : /^\d+$/.test(v) ? Number(v) : Date.parse(v) || null);

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
  const view = VIEWS[/^\/v1\/admin\/(sessions|events|tracks)$/.exec(path)?.[1]];
  if (!view) return new Response("Not found", { status: 404 });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const q = url.searchParams, where = [], args = [];
  const from = when(q.get("from")), to = when(q.get("to"));
  if (from != null) { where.push(`${view.time} >= ?`); args.push(from); }
  if (to != null) { where.push(`${view.time} <= ?`); args.push(to); }
  for (const [param, col] of Object.entries(view.filters)) {
    if (q.get(param)) { where.push(`${col} = ?`); args.push(q.get(param)); }
  }
  const limit = Math.min(Math.max(parseInt(q.get("limit"), 10) || 500, 1), 5000);
  const table = Object.keys(VIEWS).find((k) => VIEWS[k] === view);
  const sql = `SELECT * FROM ${table}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${view.order} LIMIT ?`;
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
    return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${table}.csv"` } });
  }
  return Response.json(rows);
}

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
