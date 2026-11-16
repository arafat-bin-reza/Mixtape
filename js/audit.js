// Usage audit log (plan.md Part D). A state subscriber: no other module reports to it.
// describe() and diff() are pure so they run under node --test. Inert until configure() gets an endpoint:
// no visitor id is created, nothing is stored and no request is made.
import { getState, subscribe } from "./state.js";
import * as storage from "./storage.js";
import { describeItem } from "./url-tracks.js";

// The collector accepts 64 KB and 50 events per request and 150 library tracks; sizes are UTF-8 bytes, not characters.
const MAX_QUEUE = 200, BATCH = 20, MAX_EVENTS = 50, MAX_BYTES = 48000, MAX_LIBRARY = 150, LIBRARY_BYTES = 40000;
const encoder = new TextEncoder();
const bytes = (v) => encoder.encode(JSON.stringify(v)).length;
let cfg = null, visitor = null, session = null, seq = 0;
let queue = [], stored = false, sending = false, healthy = true;
let prev = null, tracksRef = null, failedRef = null;
let pos = 0, dur = 0, preview = false;
const clock = { on: false, since: 0, total: 0 };

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const isPersonal = (t) => t.source === "local" || t.source === "url";

/** Maps a track to the logged fields. Device-only files have no meaningful URL (a blob: address), so none is sent. */
export function describe(t) {
  const d = {
    trackId: t.id, source: t.source, provider: t.provider, kind: t.kind,
    url: t.source === "local" ? undefined : t.src, externalId: t.externalId,
    title: t.title, artist: t.artist, duration: t.duration || undefined, cover: t.cover || undefined,
  };
  if (t.file) Object.assign(d, { fileName: t.file.name, bytes: t.file.bytes, mime: t.file.mime, shared: t.file.shared });
  return d;
}

/**
 * Compares two snapshots { ids, currentId, playing, failed, item } and returns the events to emit.
 * `prev` also carries `started` (play_start already sent for the current track) and `nearEnd`
 * (the last known position was at the end of the track). Returns { events, started }.
 */
export function diff(prev, next) {
  const events = [];
  const had = new Set(prev.ids), has = new Set(next.ids);
  for (const id of next.ids) if (!had.has(id)) events.push({ type: "track_add", trackId: id });
  for (const id of prev.ids) if (!has.has(id)) events.push({ type: "track_remove", trackId: id });
  const failed = next.failed.filter((id) => !prev.failed.includes(id));
  for (const id of failed) events.push({ type: "play_error", trackId: id });

  const changed = prev.currentId !== next.currentId;
  const errored = failed.includes(prev.currentId);
  let started = !!prev.started;
  if (started && (changed || errored || (prev.playing && !next.playing && prev.nearEnd))) {
    events.push({ type: "play_end", trackId: prev.currentId, reason: errored ? "error" : changed && !prev.nearEnd ? "skipped" : "ended" });
    started = false;
  }
  if (!started && next.playing && next.currentId && !next.failed.includes(next.currentId)) {
    events.push({ type: "play_start", trackId: next.currentId });
    started = true;
  }
  if (next.item && next.item !== prev.item && next.currentId) events.push({ type: "collection_item", trackId: next.currentId, itemUri: next.item });
  return { events, started };
}

// ---------- Queue and delivery ----------

function persist() {
  if (!queue.length && !stored) return;
  storage.save("audit-queue", queue.slice(-MAX_QUEUE));
  stored = queue.length > 0;
}

function emit(type, fields = {}, n = ++seq) {
  queue.push({ sessionId: session, seq: n, ts: Date.now(), type, ...fields });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= BATCH) flush();
}

function take() {
  const batch = [];
  let size = 0;
  for (const e of queue) {
    size += bytes(e);
    if (batch.length && (batch.length >= MAX_EVENTS || size > MAX_BYTES)) break;
    batch.push(e);
  }
  return batch;
}
const body = (batch) => JSON.stringify({ visitorId: visitor, events: batch });
const drop = (batch) => { queue = queue.filter((e) => !batch.includes(e)); };

async function flush() {
  if (!cfg || sending || !queue.length) return;
  sending = true;
  const batch = take();
  let ok = false;
  try {
    // text/plain keeps this a "simple" request: no CORS preflight.
    const r = await fetch(cfg.endpoint, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: body(batch) });
    if (r.status >= 500 || r.status === 429) throw new Error(String(r.status));
    drop(batch); // delivered, or rejected as malformed (retrying would not help)
    ok = true;
  } catch { /* offline, blocked or collector down: keep for the next flush or the next visit */ }
  healthy = ok;
  persist();
  sending = false;
  if (ok && queue.length >= BATCH) flush();
}

function onHide(closing) {
  try {
    if (!closing) { flush(); return; } // tab hidden but alive: a normal flush reports its own result
    if (prev?.started) { closeStretch(Date.now()); endPlay(prev.currentId, "closed"); prev.started = false; clock.on = false; }
    if (!queue.length) return;
    const batch = take();
    // A beacon cannot report failure. If the last flush failed, keep the events for the next visit as well;
    // the collector ignores duplicates (unique session + seq).
    if (navigator.sendBeacon?.(cfg.endpoint, body(batch)) && healthy) drop(batch);
    persist();
  } catch { /* never surface audit failures */ }
}

// ---------- State subscriber ----------

function closeStretch(now) {
  if (clock.on) clock.total += now - clock.since;
  clock.since = now;
}

function endPlay(trackId, reason) {
  emit("play_end", { trackId, reason, listenedSec: Math.round(clock.total / 100) / 10, positionSec: Math.round(pos * 10) / 10, durationSec: dur || undefined, preview: preview || undefined });
  clock.total = 0;
}

function onState(s) {
  try {
    const cur = s.tracks[s.order[s.position]];
    if (s.tracks === tracksRef && s.failed === failedRef && cur?.id === prev.currentId && s.playing === prev.playing && s.item === prev.item) {
      pos = s.currentTime; dur = s.duration; preview = s.preview; // plain time tick: nothing to report
      return;
    }
    const now = Date.now();
    closeStretch(now);
    const next = {
      ids: s.tracks === tracksRef ? prev.ids : s.tracks.map((t) => t.id),
      currentId: cur?.id ?? null, playing: s.playing, failed: s.failed, item: s.item,
    };
    const nearEnd = dur > 0 && pos >= dur - Math.min(2, dur * 0.1);
    const { events, started } = diff({ ...prev, nearEnd }, next);
    const find = (id) => s.tracks.find((t) => t.id === id);
    for (const e of events) {
      const t = find(e.trackId);
      switch (e.type) {
        case "track_add": if (t && isPersonal(t)) emit("track_add", describe(t)); break;
        case "track_remove": emit("track_remove", { trackId: e.trackId }); break;
        case "play_error": emit("play_error", { trackId: e.trackId, url: t && describe(t).url, message: s.error || undefined }); break;
        case "play_end": endPlay(e.trackId, e.reason); break;
        case "play_start": if (t) emit("play_start", { ...describe(t), preview: s.preview, shuffle: s.shuffle, repeat: s.repeat }); break;
        case "collection_item": {
          const n = ++seq; // reserve the slot now; the title arrives from oEmbed
          describeItem(e.itemUri).then((m) => emit("collection_item", { trackId: e.trackId, itemUri: e.itemUri, title: m.title || undefined }, n));
          break;
        }
      }
    }
    if (next.currentId !== prev.currentId) { pos = 0; dur = 0; preview = false; clock.total = 0; }
    prev = { ...next, started };
    tracksRef = s.tracks; failedRef = s.failed;
    clock.on = s.playing && started;
  } catch { /* auditing must never break playback */ }
}

// ---------- Public API ----------

export function configure(c) {
  if (!c?.endpoint) { cfg = null; return null; }
  cfg = { flushSeconds: 15, retentionDays: 365, ...c };
  visitor = storage.load("visitor", null);
  if (!visitor) { visitor = uuid(); storage.save("visitor", visitor); }
  session = uuid();
  queue = storage.load("audit-queue", []);
  if (!Array.isArray(queue)) queue = [];
  stored = queue.length > 0;
  return cfg;
}
export const isEnabled = () => !!cfg;
export const config = () => cfg;
export const visitorId = () => visitor;

async function clientHints() {
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues(["platformVersion", "model"]);
    if (!h) return {};
    return { platform: h.platform, platformVersion: h.platformVersion, model: h.model || undefined, mobile: h.mobile, brands: h.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") };
  } catch { return {}; }
}

/** Call once, after the playlist is built. Sends session_start with the library snapshot, then watches state. */
export async function start() {
  if (!cfg || prev) return;
  try {
    const hints = await clientHints();
    const s = getState();
    const count = (src) => s.tracks.filter((t) => t.source === src).length;
    const personal = s.tracks.filter(isPersonal);
    // Library snapshot: the personal tracks already in this browser, so links added before auditing existed
    // (or while the collector was unreachable) still reach the catalogue. Cut off at what one request can carry.
    const library = [];
    let size = 0;
    for (const t of personal) {
      const d = describe(t);
      size += bytes(d);
      if (library.length >= MAX_LIBRARY || size > LIBRARY_BYTES) break;
      library.push(d);
    }
    emit("session_start", {
      userAgent: navigator.userAgent, ...hints,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, viewport: `${innerWidth}x${innerHeight}`,
      language: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      referrer: document.referrer || undefined, standalone: matchMedia("(display-mode: standalone)").matches,
      repo: count("repo"), shared: count("shared"), personal: personal.length,
      library, libraryTruncated: library.length < personal.length || undefined,
    }, 0);

    const cur = s.tracks[s.order[s.position]];
    prev = { ids: s.tracks.map((t) => t.id), currentId: cur?.id ?? null, playing: false, failed: s.failed, item: s.item, started: false };
    tracksRef = s.tracks; failedRef = s.failed;
    subscribe(onState);
    onState(s);
    setInterval(flush, cfg.flushSeconds * 1000);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") onHide(false); });
    addEventListener("pagehide", () => onHide(true));
    flush();
  } catch { /* stay silent */ }
}
