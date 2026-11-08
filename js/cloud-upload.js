// Uploads user files to Cloudinary with an unsigned preset and turns the result into playable URL tracks.
// Only the public cloud name and preset name are used; no API key or secret is ever needed in the browser.
import * as urlTracks from "./url-tracks.js";

const DEFAULT_FORMATS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "mp4", "m4v", "webm", "mov"];
let cfg = null;

export function configure(c) {
  cfg = c?.cloudName
    ? { uploadPreset: "mixtape-unsigned", folder: "mixtape", sharedTag: "", allowUploaderShare: false, maxBytes: 100 * 1024 * 1024, allowedFormats: DEFAULT_FORMATS, ...c }
    : null;
  return cfg;
}
export const isEnabled = () => !!cfg;
export const config = () => cfg;

const ext = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
const mb = (n) => `${Math.round(n / 1048576)} MB`;

/** Returns an error message or null. Server-side limits on the preset remain the real guard. */
export function validate(file) {
  if (!cfg) return "Cloud upload is not configured.";
  const e = ext(file.name);
  if (!cfg.allowedFormats.includes(e)) return `"${file.name}" is not a supported format (${cfg.allowedFormats.join(", ")}).`;
  if (file.size > cfg.maxBytes) return `"${file.name}" is larger than the ${mb(cfg.maxBytes)} limit.`;
  return null;
}

const escapeContext = (s) => String(s).replace(/([|=\\])/g, "\\$1");

export function deliveryUrls(publicId, cloudName = cfg?.cloudName) {
  const base = `https://res.cloudinary.com/${cloudName}/video/upload`;
  return {
    src: `${base}/${publicId}.mp3`,
    cover: `${base}/fl_waveform,co_rgb:8aa0ff,b_rgb:171a24,w_600,h_600/${publicId}.png`,
  };
}

/** Maps a Cloudinary upload response to a URL track record. */
export function toRecord(res, { title, artist }) {
  const { src, cover } = deliveryUrls(res.public_id);
  const eager = res.eager?.find((e) => /\.mp3$/i.test(e.secure_url || ""))?.secure_url;
  return {
    id: `cloud-${res.public_id}`, provider: "cloudinary", externalId: res.public_id, canonicalUrl: eager || src,
    title, artist, cover, duration: Math.round(res.duration || 0) || undefined, bytes: res.bytes, original: res.secure_url,
  };
}

export function upload(file, { title, artist, shared = false, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", cfg.uploadPreset);
    if (cfg.folder) fd.append("folder", cfg.folder);
    const tags = ["mixtape"];
    if (shared && cfg.allowUploaderShare && cfg.sharedTag) tags.push(cfg.sharedTag);
    fd.append("tags", tags.join(","));
    fd.append("context", `caption=${escapeContext(title)}|alt=${escapeContext(artist)}`);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cfg.cloudName}/video/upload`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Unexpected response from the upload service.")); }
        return;
      }
      let msg = `Upload failed (${xhr.status}).`;
      try { msg = JSON.parse(xhr.responseText).error.message || msg; } catch { /* keep default */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onabort = () => reject(Object.assign(new Error("Cancelled."), { cancelled: true }));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}

/** Uploads, persists, and returns the playlist track. */
export async function uploadTrack(file, opts) {
  const res = await upload(file, opts);
  return urlTracks.save(toRecord(res, opts));
}

/** Owner-curated public playlist: every Cloudinary resource tagged `sharedTag` (needs "Resource list" enabled in the console). */
export async function loadShared() {
  if (!cfg?.sharedTag) return [];
  try {
    const r = await fetch(`https://res.cloudinary.com/${cfg.cloudName}/video/list/${encodeURIComponent(cfg.sharedTag)}.json`, { cache: "no-cache" });
    if (!r.ok) return [];
    const { resources = [] } = await r.json();
    return resources
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((res) => {
        const ctx = res.context?.custom ?? res.context ?? {};
        const { src, cover } = deliveryUrls(res.public_id);
        return {
          id: `shared-${res.public_id}`, title: ctx.caption || res.public_id.split("/").pop(), artist: ctx.alt || "Shared",
          src, cover, duration: Math.round(res.duration || 0) || undefined, provider: "cloudinary", externalId: res.public_id, source: "shared",
        };
      });
  } catch { return []; }
}
