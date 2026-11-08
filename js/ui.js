import { getState, setState, subscribe } from "./state.js";
import * as player from "./player.js";
import * as playlist from "./playlist.js";
import * as local from "./local-files.js";
import * as urlTracks from "./url-tracks.js";
import * as cloud from "./cloud-upload.js";
import * as storage from "./storage.js";

const $ = (id) => document.getElementById(id);
export const formatTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const setPct = (el, v, max) => el.style.setProperty("--pct", max ? `${(v / max) * 100}%` : "0%");
const dialogOpen = () => !!document.querySelector("dialog[open]");
const setStatus = (el, msg, err = false) => { el.textContent = msg; el.classList.toggle("err", err); };

let dragging = false, toastTimer, last = {};

export function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 6000);
}

function badgeFor(t) {
  if (t.source === "shared") return "Shared";
  if (t.source === "url") return urlTracks.PROVIDER_NAMES[t.provider] || "Link";
  return null;
}

function renderTrack(t) {
  $("title").textContent = t ? t.title : "Nothing playing";
  $("artist").textContent = t ? t.artist : "Add files or paste a link to start";
  $("cover").style.setProperty("--h", t ? hue(t.id) : 220);
  $("cover").dataset.embed = t?.provider === "youtube" ? "youtube" : "";
  $("cover-letter").textContent = t ? [...(t.title || "?")][0].toUpperCase() : "♪";
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
    ul.innerHTML = '<li class="empty">No tracks yet. Add audio files from your device or paste a link.</li>';
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
    const badge = badgeFor(t);
    if (badge) {
      const b = document.createElement("i");
      b.className = "badge";
      b.textContent = badge;
      row.querySelector("b").append(b);
    }
    row.querySelector("small").textContent = s.failed.includes(t.id) ? "Can't be played" : t.artist;
    row.querySelector("time").textContent = t.duration ? formatTime(t.duration) : "";
    row.onclick = () => (i === cur ? player.toggle() : playlist.select(i));
    li.append(row);
    if (t.source === "local" || t.source === "url") {
      const rm = document.createElement("button");
      rm.className = "btn rm";
      rm.setAttribute("aria-label", `Remove ${t.title}`);
      rm.innerHTML = '<svg class="i"><use href="#i-x"/></svg>';
      rm.onclick = () => removeTrack(t);
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

/** Appends tracks not already in the playlist. Returns the ones added. */
function addTracks(list) {
  const have = new Set(getState().tracks.map((t) => t.id));
  const fresh = list.filter((t) => !have.has(t.id));
  if (fresh.length) playlist.setTracks([...getState().tracks, ...fresh]);
  return fresh;
}

async function removeTrack(t) {
  const s = getState();
  if (playlist.current()?.id === t.id) setState({ playing: false });
  if (t.source === "local") await local.remove(t.id);
  else if (t.source === "url") await urlTracks.remove(t.id);
  playlist.setTracks(s.tracks.filter((x) => x.id !== t.id));
}

// ---------- Adding files (cloud upload by default, device-only fallback) ----------

async function addFiles(files) {
  files = [...files];
  if (!files.length) return;
  if (cloud.isEnabled()) openUploadDialog(files);
  else await addLocal(files);
}

async function addLocal(files, meta) {
  const { added, rejected, unsaved } = await local.add(files, meta);
  if (added.length) addTracks(added);
  const notes = [];
  if (rejected.length) notes.push(`Skipped ${rejected.length} unsupported file${rejected.length > 1 ? "s" : ""}: ${rejected.slice(0, 2).join(", ")}${rejected.length > 2 ? "…" : ""}`);
  if (unsaved) notes.push(`${unsaved} couldn't be saved (storage is full or unavailable), so ${unsaved > 1 ? "they'll" : "it'll"} disappear on reload.`);
  if (notes.length) toast(notes.join(" "));
  return added;
}

let uploadQueue = [], uploadAbort = null, uploading = false, uploadFinished = false;

function uploadRow(item) {
  const li = document.createElement("li");
  li.innerHTML =
    '<div class="file"><b></b><small></small></div>' +
    '<div class="fields"><label>Title<input class="u-title" required></label><label>Artist<input class="u-artist"></label></div>' +
    '<progress max="1" value="0" hidden></progress><p class="status" aria-live="polite"></p>' +
    '<button type="button" class="btn text ghost keep" hidden>Keep on this device only</button>';
  li.querySelector("b").textContent = item.file.name;
  li.querySelector("small").textContent = formatBytes(item.file.size);
  li.querySelector(".u-title").value = item.title;
  li.querySelector(".u-artist").value = item.artist;
  if (item.error) { setStatus(li.querySelector(".status"), item.error, true); li.querySelector(".keep").hidden = false; }
  li.querySelector(".keep").onclick = () => keepLocal(item);
  return li;
}

function uploadValues(item) {
  return {
    title: item.el.querySelector(".u-title").value.trim() || item.title,
    artist: item.el.querySelector(".u-artist").value.trim() || item.artist,
  };
}

async function keepLocal(item) {
  const status = item.el.querySelector(".status");
  item.el.querySelector(".keep").hidden = true;
  const added = await addLocal([item.file], uploadValues(item));
  if (added.length) { item.done = true; setStatus(status, "Kept on this device only. It won't be available on other devices."); }
  else setStatus(status, "This file can't be played in this browser.", true);
}

function openUploadDialog(files) {
  uploadQueue = files.map((file) => ({ file, ...local.describe(file.name), error: cloud.validate(file), done: false }));
  const ul = $("upload-list");
  ul.replaceChildren(...uploadQueue.map((item) => (item.el = uploadRow(item))));
  const c = cloud.config();
  $("upload-shared-wrap").hidden = !(c.allowUploaderShare && c.sharedTag);
  $("upload-shared").checked = false;
  uploadFinished = false;
  const start = $("upload-start");
  start.disabled = uploadQueue.every((i) => i.error);
  start.textContent = "Upload";
  $("upload-dialog").showModal();
}

async function runUploads() {
  uploading = true;
  const start = $("upload-start");
  start.disabled = true;
  start.textContent = "Uploading…";
  const shared = $("upload-shared").checked;
  let ok = 0;
  for (const item of uploadQueue) {
    if (item.done || item.error) continue;
    const li = item.el, status = li.querySelector(".status"), prog = li.querySelector("progress");
    const meta = uploadValues(item);
    li.querySelectorAll("input").forEach((i) => (i.disabled = true));
    prog.hidden = false;
    setStatus(status, "Uploading…");
    uploadAbort = new AbortController();
    try {
      const track = await cloud.uploadTrack(item.file, { ...meta, shared, signal: uploadAbort.signal, onProgress: (p) => (prog.value = p) });
      item.done = true; ok++;
      prog.value = 1;
      setStatus(status, "Uploaded.");
      addTracks([track]);
    } catch (err) {
      prog.hidden = true;
      li.querySelectorAll("input").forEach((i) => (i.disabled = false));
      li.querySelector(".keep").hidden = false;
      if (err.cancelled) { setStatus(status, "Cancelled."); break; }
      setStatus(status, `${err.message} You can keep the file on this device instead.`, true);
    }
  }
  uploadAbort = null;
  uploading = false;
  uploadFinished = true;
  start.textContent = "Close";
  start.disabled = false;
  if (ok) toast(`Uploaded ${ok} file${ok > 1 ? "s" : ""} to the cloud.`);
}

// ---------- Adding links ----------

let linkSeq = 0, linkPending = null;

function resetLink() {
  linkPending = null;
  $("link-add").disabled = true;
  $("link-preview").hidden = true;
  setStatus($("link-status"), "");
}

function openLinkDialog(prefill = "") {
  $("link-url").value = prefill;
  resetLink();
  $("link-dialog").showModal();
  if (prefill) checkLink(); else $("link-url").focus();
}

async function checkLink() {
  const seq = ++linkSeq;
  resetLink();
  const p = urlTracks.parse($("link-url").value);
  const status = $("link-status");
  if (p.error) { setStatus(status, urlTracks.errorMessage(p), p.error !== "empty"); return; }
  if (getState().tracks.some((t) => t.id === p.id)) { setStatus(status, "This link is already in the playlist."); return; }
  setStatus(status, "Looking up details…");
  let meta;
  try { meta = await urlTracks.describe(p); }
  catch { if (seq === linkSeq) setStatus(status, "That link doesn't point to playable audio or video.", true); return; }
  if (seq !== linkSeq) return;
  linkPending = { ...p, ...meta };
  $("link-title-input").value = meta.title;
  $("link-artist").value = meta.artist;
  const img = $("link-cover");
  img.hidden = !meta.cover;
  img.onerror = () => (img.hidden = true);
  if (meta.cover) img.src = meta.cover;
  $("link-provider").textContent = `${urlTracks.PROVIDER_NAMES[p.provider]}${meta.duration ? ` · ${formatTime(meta.duration)}` : ""}`;
  $("link-preview").hidden = false;
  setStatus(status, "");
  $("link-add").disabled = false;
}

async function submitLink() {
  if (!linkPending) return;
  const track = await urlTracks.save({
    ...linkPending,
    title: $("link-title-input").value.trim() || linkPending.title,
    artist: $("link-artist").value.trim() || linkPending.artist,
  });
  const [added] = addTracks([track]);
  $("link-dialog").close();
  toast(added ? `Added "${track.title}".` : "That link is already in the playlist.");
}

// ---------- Init ----------

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

  // Link dialog
  let linkTimer;
  $("add-link").onclick = () => openLinkDialog();
  $("link-url").addEventListener("input", () => { clearTimeout(linkTimer); linkTimer = setTimeout(checkLink, 400); });
  $("link-form").onsubmit = (e) => { e.preventDefault(); submitLink(); };
  $("link-cancel").onclick = () => $("link-dialog").close();
  $("link-dialog").addEventListener("close", () => { linkSeq++; resetLink(); });

  // Upload dialog
  $("upload-form").onsubmit = (e) => {
    e.preventDefault();
    if (uploading) return;
    if (uploadFinished) { $("upload-dialog").close(); return; }
    runUploads();
  };
  $("upload-cancel").onclick = () => { uploadAbort?.abort(); $("upload-dialog").close(); };
  $("upload-dialog").addEventListener("close", () => { uploadAbort?.abort(); uploadQueue = []; });

  // Paste a link anywhere on the page
  addEventListener("paste", (e) => {
    if (dialogOpen()) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    const text = e.clipboardData?.getData("text")?.trim();
    if (!text || /\s/.test(text)) return;
    const p = urlTracks.parse(text);
    if (p.error === "invalid" || p.error === "empty") return;
    e.preventDefault();
    openLinkDialog(text);
  });

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types.includes("Files");
  addEventListener("dragenter", (e) => { if (hasFiles(e) && !dialogOpen()) { depth++; $("drop").hidden = false; } });
  addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; $("drop").hidden = true; } });
  addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $("drop").hidden = true; if (!dialogOpen()) addFiles(e.dataTransfer.files); });

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || dialogOpen()) return;
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
