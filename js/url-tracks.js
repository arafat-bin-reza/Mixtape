// Tracks that live at a URL: direct media links, SoundCloud / YouTube / Vimeo links, and Cloudinary uploads.
// parse() and the record helpers have no DOM dependency so they can be unit-tested in Node.
import { tx, STORES } from "./db.js";
import { probe } from "./probe.js";

export const MEDIA_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)$/i;
export const SUPPORTED_TEXT = "Mixtape can play direct audio/video links, SoundCloud, YouTube and Vimeo.";
export const PROVIDER_NAMES = { youtube: "YouTube", soundcloud: "SoundCloud", vimeo: "Vimeo", cloudinary: "Cloud", direct: "Link" };

const UNSUPPORTED = {
  "facebook.com": "Facebook", "fb.watch": "Facebook", "fb.com": "Facebook", "instagram.com": "Instagram", "tiktok.com": "TikTok",
  "twitter.com": "X", "x.com": "X", "spotify.com": "Spotify", "apple.com": "Apple Music", "on.soundcloud.com": "SoundCloud short",
};
const SC_RESERVED = new Set(["discover", "search", "stream", "you", "upload", "pages", "charts", "tags", "terms-of-use", "people", "popular", "mobile"]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const host = (u) => u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
export const hash = (s) => { let h = 5381; for (const c of String(s)) h = (Math.imul(h, 33) + c.codePointAt(0)) >>> 0; return h.toString(36); };

/**
 * Classifies a pasted link. Returns { provider, externalId, canonicalUrl, id, ... } or { error, platform? }.
 * error: "empty" | "invalid" | "unsupported" | "playlist"
 */
export function parse(input) {
  let s = String(input ?? "").trim();
  if (!s) return { error: "empty" };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return { error: "invalid" }; }
  const hostOk = u.hostname.includes(".") || u.hostname === "localhost" || u.hostname.startsWith("[");
  if (!/^https?:$/.test(u.protocol) || !hostOk) return { error: "invalid" };
  const h = host(u);

  for (const [domain, platform] of Object.entries(UNSUPPORTED)) {
    if (h === domain || h.endsWith("." + domain)) return { error: "unsupported", platform };
  }

  // YouTube
  let ytId;
  if (h === "youtu.be") ytId = u.pathname.split("/").filter(Boolean)[0] ?? "";
  else if (/^((music|gaming)\.)?youtube(-nocookie)?\.com$/.test(h)) {
    ytId = u.searchParams.get("v") || /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] || "";
  }
  if (ytId !== undefined) {
    if (!YT_ID.test(ytId)) return { error: "invalid" };
    return { provider: "youtube", externalId: ytId, canonicalUrl: `https://www.youtube.com/watch?v=${ytId}`, id: `url-youtube-${ytId}` };
  }

  // SoundCloud
  if (h === "soundcloud.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[1] === "sets") return { error: "playlist" };
    if (parts.length === 2 && !SC_RESERVED.has(parts[0])) {
      const ext = `${parts[0]}/${parts[1]}`;
      return { provider: "soundcloud", externalId: ext, canonicalUrl: `https://soundcloud.com/${ext}`, id: `url-soundcloud-${hash(ext)}` };
    }
    return { error: "invalid" };
  }

  // Vimeo
  if (h === "vimeo.com" || h === "player.vimeo.com") {
    const m = /^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)(?:\/([a-f0-9]+))?/.exec(u.pathname);
    if (!m) return { error: "invalid" };
    const vh = m[2] || u.searchParams.get("h") || undefined;
    return { provider: "vimeo", externalId: m[1], hash: vh, canonicalUrl: `https://vimeo.com/${m[1]}${vh ? "/" + vh : ""}`, id: `url-vimeo-${m[1]}` };
  }

  // Anything else: treat as a direct media link.
  u.hash = "";
  return { provider: "direct", externalId: u.href, canonicalUrl: u.href, id: `url-direct-${hash(u.href)}`, known: MEDIA_EXT.test(u.pathname) };
}

export function errorMessage(parsed) {
  switch (parsed.error) {
    case "empty": return "";
    case "unsupported": return `${parsed.platform} links can't be played here. ${SUPPORTED_TEXT}`;
    case "playlist": return "Playlists aren't supported yet. Paste a link to a single track.";
    default: return `That doesn't look like a playable link. ${SUPPORTED_TEXT}`;
  }
}

const OEMBED = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  soundcloud: (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  vimeo: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
};

async function getJson(url, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Fetches title / artist / cover / duration for a parsed link. Throws for direct links that cannot be played. */
export async function describe(p) {
  if (p.provider === "direct") {
    const url = new URL(p.canonicalUrl);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "");
    const base = { title: name.replace(MEDIA_EXT, "").replace(/[-_+]+/g, " ").trim() || url.hostname, artist: url.hostname, cover: null };
    try { return { ...base, duration: await probe(p.canonicalUrl) }; }
    catch { if (p.known) return { ...base, duration: undefined }; throw new Error("unplayable"); }
  }
  const candidates = [OEMBED[p.provider](p.canonicalUrl), `https://noembed.com/embed?url=${encodeURIComponent(p.canonicalUrl)}`];
  let meta = null;
  for (const url of candidates) {
    try { meta = await getJson(url); if (meta?.title) break; } catch { meta = null; }
  }
  return {
    title: meta?.title || "Untitled",
    artist: meta?.author_name || PROVIDER_NAMES[p.provider],
    cover: meta?.thumbnail_url || (p.provider === "youtube" ? `https://i.ytimg.com/vi/${p.externalId}/hqdefault.jpg` : null),
    duration: meta?.duration ? Math.round(meta.duration) : undefined,
  };
}

export function toTrack(rec) {
  return {
    id: rec.id, title: rec.title, artist: rec.artist, src: rec.canonicalUrl, cover: rec.cover ?? null, duration: rec.duration,
    provider: rec.provider, externalId: rec.externalId, hash: rec.hash, source: "url", added: rec.added,
  };
}

/** Persists a URL track record and returns the playlist track. */
export async function save(rec) {
  const record = {
    id: rec.id, provider: rec.provider, externalId: rec.externalId, hash: rec.hash, canonicalUrl: rec.canonicalUrl,
    title: rec.title, artist: rec.artist, cover: rec.cover ?? null, duration: rec.duration, added: rec.added ?? Date.now(),
  };
  try { await tx(STORES.url, "readwrite", (s) => s.put(record)); } catch { /* storage unavailable: still playable this session */ }
  return toTrack(record);
}

export async function loadAll() {
  try {
    const recs = await tx(STORES.url, "readonly", (s) => s.getAll());
    return recs.sort((a, b) => a.added - b.added).map(toTrack);
  } catch { return []; }
}

export async function remove(id) {
  try { await tx(STORES.url, "readwrite", (s) => s.delete(id)); } catch { /* already gone */ }
}
