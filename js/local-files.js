// User-added files kept only in this browser (IndexedDB). Used as the fallback when cloud upload is off or fails.
import { tx, STORES } from "./db.js";
import { probe } from "./probe.js";

const urls = new Map();
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)$/i;

function toTrack(rec) {
  const src = URL.createObjectURL(rec.blob);
  urls.set(rec.id, src);
  return { id: rec.id, title: rec.title, artist: rec.artist, src, cover: null, duration: rec.duration, source: "local", added: rec.added };
}

/** Guesses title/artist from a filename like "Artist - Title.mp3". */
export function describe(name) {
  const base = name.replace(AUDIO_EXT, "").replace(/_+/g, " ").trim();
  const [a, ...rest] = base.split(" - ");
  return rest.length ? { artist: a.trim(), title: rest.join(" - ").trim() } : { artist: "Local file", title: base };
}

export const isAudioFile = (file) => file.type.startsWith("audio/") || file.type.startsWith("video/") || AUDIO_EXT.test(file.name);

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
    if (!isAudioFile(file)) { rejected.push(file.name); continue; }
    let duration;
    try { duration = await probeFile(file); } catch { rejected.push(file.name); continue; }
    const rec = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...describe(file.name), ...meta, duration, added: Date.now(), blob: file };
    try { await tx(STORES.local, "readwrite", (s) => s.put(rec)); } catch { unsaved++; }
    added.push(toTrack(rec));
  }
  return { added, rejected, unsaved };
}

export async function remove(id) {
  const url = urls.get(id);
  if (url) { URL.revokeObjectURL(url); urls.delete(id); }
  try { await tx(STORES.local, "readwrite", (s) => s.delete(id)); } catch { /* already gone */ }
}
