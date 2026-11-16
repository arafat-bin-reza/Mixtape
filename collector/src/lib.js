// Pure helpers for the collector: validation, User-Agent matching, CSV. No Workers APIs, so they run under node --test.

const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_BODY = 64 * 1024, MAX_EVENTS = 50;

const S = (n) => (v) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
const N = (v) => (typeof v === "number" && isFinite(v) ? v : undefined);
const B = (v) => (typeof v === "boolean" ? v : undefined);
const TID = S(200);
const TRACK = {
  trackId: TID, source: S(16), provider: S(16), kind: S(16), url: S(2000), externalId: S(300), title: S(300), artist: S(300),
  duration: N, cover: S(2000), fileName: S(300), bytes: N, mime: S(100), shared: B,
};
export const MAX_LIBRARY = 150;
const shape = (spec, e) => {
  const out = {};
  for (const [k, fn] of Object.entries(spec)) {
    const v = fn(e[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
};
/** The library snapshot in session_start: the personal tracks already in the visitor's browser. */
const LIBRARY = (v) => (Array.isArray(v) ? v.slice(0, MAX_LIBRARY).filter((t) => t && typeof t === "object").map((t) => shape(TRACK, t)).filter((t) => t.trackId) : undefined);
const SHAPES = {
  session_start: {
    userAgent: S(500), platform: S(50), platformVersion: S(50), model: S(100), mobile: B, brands: S(300), screen: S(40), viewport: S(40),
    language: S(35), timeZone: S(64), referrer: S(500), standalone: B, repo: N, shared: N, personal: N, library: LIBRARY, libraryTruncated: B,
  },
  track_add: TRACK,
  track_remove: { trackId: TID },
  play_start: { ...TRACK, preview: B, shuffle: B, repeat: S(8) },
  play_end: { trackId: TID, listenedSec: N, positionSec: N, durationSec: N, reason: S(16), preview: B },
  collection_item: { trackId: TID, itemUri: S(200), title: S(300) },
  play_error: { trackId: TID, url: S(2000), message: S(500) },
};

/** Validates one event and returns it with only known, length-limited fields, or null. */
export function clean(e) {
  const spec = e && typeof e === "object" && Object.hasOwn(SHAPES, e.type) ? SHAPES[e.type] : null;
  if (!spec || !ID.test(e.sessionId) || !Number.isInteger(e.seq) || e.seq < 0 || N(e.ts) === undefined) return null;
  const fields = shape(spec, e);
  if (e.type !== "session_start" && !fields.trackId) return null;
  return { sessionId: e.sessionId, seq: e.seq, ts: e.ts, type: e.type, fields };
}

/** Parses a request body. Returns { visitorId, events } or { error }. Invalid events are dropped, not fatal. */
export function parseBatch(text) {
  let b;
  try { b = JSON.parse(text); } catch { return { error: "json" }; }
  if (!b || typeof b !== "object" || !ID.test(b.visitorId) || !Array.isArray(b.events)) return { error: "shape" };
  if (!b.events.length || b.events.length > MAX_EVENTS) return { error: "count" };
  const events = b.events.map(clean).filter(Boolean);
  return events.length ? { visitorId: b.visitorId, events } : { error: "events" };
}

/** Small User-Agent matcher so the admin views are readable without a dependency. */
export function parseUA(ua = "", hints = {}) {
  const has = (re) => re.test(ua);
  const browser =
    has(/Edg(e|A|iOS)?\//) ? "Edge" : has(/OPR\/|Opera/) ? "Opera" : has(/SamsungBrowser\//) ? "Samsung Internet" :
    has(/Firefox\/|FxiOS\//) ? "Firefox" : has(/Chrome\/|CriOS\//) ? "Chrome" : has(/Safari\//) ? "Safari" : "Other";
  const os =
    has(/Windows/) ? "Windows" : has(/Android/) ? "Android" : has(/iPhone|iPad|iPod/) ? "iOS" : has(/CrOS/) ? "ChromeOS" :
    has(/Mac OS X|Macintosh/) ? "macOS" : has(/Linux/) ? "Linux" : hints.platform || "Other";
  const tablet = has(/iPad|Tablet/) || (has(/Android/) && !has(/Mobile/));
  const deviceType = tablet ? "tablet" : hints.mobile === true || has(/Mobi|iPhone|iPod|Android/) ? "mobile" : "desktop";
  // Client Hints give a usable version for Android and macOS; on Windows the number only separates 11 (13 and up) from 10.
  const v = hints.platformVersion;
  const named = !v ? os : os === "Windows" ? `Windows ${parseInt(v, 10) >= 13 ? 11 : 10}` : os === "Android" || os === "macOS" ? `${os} ${v}` : os;
  return { browser, os: named, deviceType, deviceModel: hints.model || null };
}

/** CSV with quoting; cells that a spreadsheet would run as a formula are prefixed with an apostrophe. */
export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

