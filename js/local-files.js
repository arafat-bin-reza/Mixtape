const DB = "music-player", STORE = "local-tracks";
const urls = new Map();
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}

function toTrack(rec) {
  const src = URL.createObjectURL(rec.blob);
  urls.set(rec.id, src);
  return { id: rec.id, title: rec.title, artist: rec.artist, src, cover: null, duration: rec.duration, source: "local" };
}

function describe(name) {
  const base = name.replace(AUDIO_EXT, "").replace(/_+/g, " ").trim();
  const [a, ...rest] = base.split(" - ");
  return rest.length ? { artist: a.trim(), title: rest.join(" - ").trim() } : { artist: "Local file", title: base };
}

function probe(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (fn, v) => { URL.revokeObjectURL(url); clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => done(rej, new Error("timeout")), 8000);
    a.preload = "metadata";
    a.onloadedmetadata = () => done(res, Math.round(a.duration) || 0);
    a.onerror = () => done(rej, new Error("unsupported"));
    a.src = url;
  });
}

export async function loadAll() {
  try {
    const recs = await tx("readonly", (s) => s.getAll());
    return { tracks: recs.sort((a, b) => a.added - b.added).map(toTrack), warning: null };
  } catch {
    return { tracks: [], warning: "Saved files can't be loaded in this browser mode." };
  }
}

export async function add(files) {
  const added = [], rejected = [];
  let unsaved = 0;
  for (const file of files) {
    if (!file.type.startsWith("audio/") && !AUDIO_EXT.test(file.name)) { rejected.push(file.name); continue; }
    let duration;
    try { duration = await probe(file); } catch { rejected.push(file.name); continue; }
    const rec = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...describe(file.name), duration, added: Date.now(), blob: file };
    try { await tx("readwrite", (s) => s.put(rec)); } catch { unsaved++; }
    added.push(toTrack(rec));
  }
  return { added, rejected, unsaved };
}

export async function remove(id) {
  const url = urls.get(id);
  if (url) { URL.revokeObjectURL(url); urls.delete(id); }
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* already gone */ }
}
