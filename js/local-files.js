// User-added files kept only in this browser (IndexedDB). Used as the fallback when cloud upload is off or fails.
import { tx, STORES } from "./db.js";
import { probe } from "./probe.js";

const urls = new Map();
// Any audio or video extension: the browser reports an empty MIME type for many of these, so the type alone is not enough.
// Whether a file can actually be decoded is decided later, by Cloudinary or by probe().
const MEDIA_EXT = /\.(mp3|mp2|mpga|m4a|m4b|aac|ogg|oga|opus|wav|wave|flac|aif|aiff|aifc|amr|wma|mka|weba|caf|ac3|ape|wv|tta|dsf|au|snd|ra|mid|midi|3ga|mp4|m4v|mov|webm|mkv|avi|wmv|flv|f4v|mpg|mpeg|mpe|m2v|ts|mts|m2ts|3gp|3g2|ogv|vob|mxf|asf)$/i;

function toTrack(rec) {
  const src = URL.createObjectURL(rec.blob);
  urls.set(rec.id, src);
  return { id: rec.id, title: rec.title, artist: rec.artist, src, cover: null, duration: rec.duration, source: "local", added: rec.added };
}

/** Guesses title/artist from a filename like "Artist - Title.mp3". */
export function describe(name) {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/_+/g, " ").trim();
  const [a, ...rest] = base.split(" - ");
  return rest.length ? { artist: a.trim(), title: rest.join(" - ").trim() } : { artist: "Local file", title: base };
}

/** True for any audio or video file. Video is accepted because it is always played back as audio. */
export const isMediaFile = (file) => /^(audio|video)\//.test(file.type || "") || MEDIA_EXT.test(file.name);

async function probeFile(file) {
  const url = URL.createObjectURL(file);
  try { return await probe(url); } finally { URL.revokeObjectURL(url); }
}

export async function loadAll() {
  try {
    const recs = await tx(STORES.local, "readonly", (s) => s.getAll());
    return { tracks: recs.sort((a, b) => a.added - b.added).map(toTrack), warning: null };
  } catch {
    return { tracks: [], warning: "Saved files can't be loaded in this browser mode." };
  }
}

export async function add(files, meta = {}) {
  const added = [], rejected = [];
  let unsaved = 0;
  for (const file of files) {
    if (!isMediaFile(file)) { rejected.push(file.name); continue; }
    let duration;
    try { duration = await probeFile(file); } catch { rejected.push(file.name); continue; }
    const rec = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...describe(file.name), ...meta, duration, added: Date.now(), blob: file };
    try { await tx(STORES.local, "readwrite", (s) => s.put(rec)); } catch { unsaved++; }
    added.push({ ...toTrack(rec), file: { name: file.name, bytes: file.size, mime: file.type } }); // file details are for the audit log only; not persisted
  }
  return { added, rejected, unsaved };
}

export async function remove(id) {
  const url = urls.get(id);
  if (url) { URL.revokeObjectURL(url); urls.delete(id); }
  try { await tx(STORES.local, "readwrite", (s) => s.delete(id)); } catch { /* already gone */ }
}
