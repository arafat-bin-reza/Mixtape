import { getState, setState, subscribe } from "./state.js";
import * as player from "./player.js";
import * as playlist from "./playlist.js";
import * as local from "./local-files.js";
import * as storage from "./storage.js";

const $ = (id) => document.getElementById(id);
export const formatTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const setPct = (el, v, max) => el.style.setProperty("--pct", max ? `${(v / max) * 100}%` : "0%");

let dragging = false, toastTimer, last = {};

export function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 6000);
}

function renderTrack(t) {
  $("title").textContent = t ? t.title : "Nothing playing";
  $("artist").textContent = t ? t.artist : "Add some audio files to start";
  $("cover").style.setProperty("--h", t ? hue(t.id) : 220);
  $("cover-letter").textContent = t ? [...t.title][0].toUpperCase() : "♪";
  const img = $("cover-img");
  img.hidden = !t?.cover;
  img.loading = "lazy";
  img.onerror = () => (img.hidden = true);
  if (t?.cover) img.src = t.cover;
  document.title = t ? `${t.title} · Music Player` : "Music Player";
  $("live").textContent = t ? `${t.title} by ${t.artist}` : "";
}

function renderList(s) {
  const ul = $("tracks");
  ul.replaceChildren();
  if (!s.tracks.length) {
    ul.innerHTML = '<li class="empty">No tracks yet. Add audio files from your device.</li>';
    return;
  }
  const cur = s.order[s.position];
  s.tracks.forEach((t, i) => {
    const li = document.createElement("li");
    if (i === cur) li.setAttribute("aria-current", "true");
    if (s.failed.includes(t.id)) li.className = "bad";
    const row = document.createElement("button");
    row.className = "row";
    row.innerHTML = `<span class="n">${i + 1}</span><span><b></b><small></small></span><time></time>`;
    row.querySelector("b").textContent = t.title;
    row.querySelector("small").textContent = s.failed.includes(t.id) ? "Can't be played" : t.artist;
    row.querySelector("time").textContent = t.duration ? formatTime(t.duration) : "";
    row.onclick = () => (i === cur ? player.toggle() : playlist.select(i));
    li.append(row);
    if (t.source === "local") {
      const rm = document.createElement("button");
      rm.className = "btn rm";
      rm.setAttribute("aria-label", `Remove ${t.title}`);
      rm.innerHTML = '<svg class="i"><use href="#i-x"/></svg>';
      rm.onclick = () => removeTrack(t.id);
      li.append(rm);
    }
    ul.append(li);
  });
}

function render(s) {
  const t = s.tracks[s.order[s.position]];
  if (t?.id !== last.id) { last.id = t?.id; renderTrack(t); }
  const key = [s.tracks, s.position, s.order, s.failed];
  if (key.some((v, i) => v !== last.key?.[i])) { last.key = key; renderList(s); }

  const seek = $("seek");
  seek.max = s.duration || 0;
  if (!dragging) { seek.value = s.currentTime; $("cur").textContent = formatTime(s.currentTime); }
  setPct(seek, +seek.value, s.duration);
  $("dur").textContent = formatTime(s.duration);

  $("play-icon").setAttribute("href", s.playing ? "#i-pause" : "#i-play");
  $("play").setAttribute("aria-label", s.playing ? "Pause" : "Play");
  $("shuffle").setAttribute("aria-pressed", s.shuffle);
  $("repeat").dataset.mode = s.repeat;
  $("repeat").setAttribute("aria-label", `Repeat: ${s.repeat}`);
  const vol = $("volume");
  vol.value = s.muted ? 0 : s.volume;
  setPct(vol, +vol.value, 1);
  $("mute-icon").setAttribute("href", s.muted || s.volume === 0 ? "#i-mute" : "#i-vol");
  $("mute").setAttribute("aria-label", s.muted ? "Unmute" : "Mute");
  if (s.error && s.error !== last.error) toast(s.error);
  last.error = s.error;
}

async function addFiles(files) {
  files = [...files];
  if (!files.length) return;
  const { added, rejected, unsaved } = await local.add(files);
  if (added.length) playlist.setTracks([...getState().tracks, ...added]);
  const notes = [];
  if (rejected.length) notes.push(`Skipped ${rejected.length} unsupported file${rejected.length > 1 ? "s" : ""}: ${rejected.slice(0, 2).join(", ")}${rejected.length > 2 ? "…" : ""}`);
  if (unsaved) notes.push(`${unsaved} couldn't be saved (storage is full or unavailable), so ${unsaved > 1 ? "they'll" : "it'll"} disappear on reload.`);
  if (notes.length) toast(notes.join(" "));
}

async function removeTrack(id) {
  const s = getState();
  if (playlist.current()?.id === id) setState({ playing: false });
  await local.remove(id);
  playlist.setTracks(s.tracks.filter((t) => t.id !== id));
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
}

export function initUI({ onPrev, onNext }) {
  applyTheme(storage.load("theme", null));
  subscribe(render);

  $("play").onclick = player.toggle;
  $("prev").onclick = onPrev;
  $("next").onclick = onNext;
  $("shuffle").onclick = () => playlist.setShuffle(!getState().shuffle);
  $("repeat").onclick = playlist.cycleRepeat;
  $("mute").onclick = player.toggleMute;
  $("volume").oninput = (e) => player.setVolume(+e.target.value);

  const seek = $("seek");
  seek.addEventListener("input", () => { dragging = true; $("cur").textContent = formatTime(+seek.value); setPct(seek, +seek.value, +seek.max); });
  seek.addEventListener("change", () => { player.seek(+seek.value); dragging = false; });

  $("add").onclick = () => $("file").click();
  $("file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  $("theme").onclick = () => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const now = document.documentElement.dataset.theme || (dark ? "dark" : "light");
    const next = now === "dark" ? "light" : "dark";
    applyTheme(next);
    storage.save("theme", next);
  };

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types.includes("Files");
  addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; $("drop").hidden = false; } });
  addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; $("drop").hidden = true; } });
  addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $("drop").hidden = true; addFiles(e.dataTransfer.files); });

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName, isRange = e.target.type === "range";
    if (tag === "INPUT" && !isRange) return;
    const s = getState();
    switch (e.key) {
      case " ": if (tag === "BUTTON") return; e.preventDefault(); player.toggle(); break;
      case "ArrowLeft": if (isRange) return; player.seekBy(-5); break;
      case "ArrowRight": if (isRange) return; player.seekBy(5); break;
      case "ArrowUp": if (isRange) return; e.preventDefault(); player.setVolume(s.volume + 0.05); break;
      case "ArrowDown": if (isRange) return; e.preventDefault(); player.setVolume(s.volume - 0.05); break;
      case "n": case "N": onNext(); break;
      case "p": case "P": onPrev(); break;
      case "m": case "M": player.toggleMute(); break;
    }
  });
}
