// Usage: npm install && node scripts/generate-tracks.mjs
import { readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const AUDIO = "assets/audio", COVERS = "assets/covers", OUT = "data/tracks.json";
const EXT = new Set([".mp3", ".ogg", ".m4a", ".wav"]);

let mm;
try { mm = await import("music-metadata"); }
catch { console.error('Missing dependency. Run "npm install" first.'); process.exit(1); }

const previous = await readFile(OUT, "utf8").catch(() => "[]");
const previousTracks = (() => {
  try { return JSON.parse(previous); }
  catch { return []; }
})();
const savedById = new Map();
for (const track of Array.isArray(previousTracks) ? previousTracks : []) {
  if (!track?.id) continue;
  const id = String(track.id);
  savedById.set(id, track);
  const normalized = id.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  if (normalized && normalized !== id) savedById.set(normalized, track);
}

const files = (await readdir(AUDIO)).filter((f) => EXT.has(path.extname(f).toLowerCase())).sort();
await mkdir(COVERS, { recursive: true });

const tracks = [];
for (const file of files) {
  const base = path.parse(file).name;
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const saved = savedById.get(id) ?? {};
  let meta = {};
  try { meta = await mm.parseFile(path.join(AUDIO, file)); }
  catch (e) { console.warn(`No tags for ${file}: ${e.message}`); }
  const common = meta.common ?? {};
  let cover;
  const pic = mm.selectCover?.(common.picture);
  if (pic) {
    cover = `${COVERS}/${id}.${pic.format.includes("png") ? "png" : "jpg"}`;
    await writeFile(cover, pic.data);
  }
  tracks.push({
    id,
    title: common.title || saved.title || base.replace(/[-_]+/g, " "),
    artist: common.artist || saved.artist || "Unknown artist",
    src: `${AUDIO}/${file}`,
    cover,
    duration: Math.round(meta.format?.duration || 0) || undefined,
    source: "repo",
  });
}
await writeFile(OUT, JSON.stringify(tracks, null, 2) + "\n");
console.log(`Wrote ${tracks.length} tracks to ${OUT}`);
