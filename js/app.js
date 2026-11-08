import { getState, setState, subscribe } from "./state.js";
import * as storage from "./storage.js";
import * as player from "./player.js";
import * as playlist from "./playlist.js";
import * as local from "./local-files.js";
import * as urlTracks from "./url-tracks.js";
import * as cloud from "./cloud-upload.js";
import { initUI, toast } from "./ui.js";
import { initMediaSession } from "./media-session.js";

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
async function loadRepoTracks() {
  try { return await loadJson("data/tracks.json"); }
  catch { setState({ error: "Couldn't load the track list. Reload the page to try again." }); return []; }
}
const loadConfig = () => loadJson("config.json").catch(() => ({}));

const saved = storage.load("settings", {});
setState({
  volume: saved.volume ?? 0.8,
  muted: !!saved.muted,
  shuffle: !!saved.shuffle,
  repeat: ["off", "all", "one"].includes(saved.repeat) ? saved.repeat : "off",
});

const onPrev = () => (getState().currentTime > 3 ? player.seek(0) : playlist.prev());
const onNext = () => playlist.next();

const config = await loadConfig();
cloud.configure(config.cloudinary);

player.init({
  embedContainer: document.getElementById("embed"),
  onEnded() {
    if (getState().repeat === "one") { player.seek(0); player.play(); }
    else if (!playlist.next()) setState({ playing: false });
  },
  onError(e) {
    const t = playlist.current();
    if (!t) return;
    // Engine errors carry a reason (e.g. "Embedding disabled by the owner"); native MediaError objects do not.
    const why = e instanceof Error && e.message ? ` ${e.message.replace(/\.$/, "")}.` : "";
    setState({ failed: [...getState().failed, t.id], error: `"${t.title}" can't be played.${why} Skipping it.` });
    if (!playlist.next()) setState({ playing: false });
  },
});
initUI({ onPrev, onNext });
initMediaSession({ play: player.play, pause: player.pause, prev: onPrev, next: onNext, seekTo: player.seek });

const [repo, { tracks: mine, warning }, urls, shared] = await Promise.all([loadRepoTracks(), local.loadAll(), urlTracks.loadAll(), cloud.loadShared()]);
const own = new Set(urls.map((t) => t.externalId));
const personal = [...mine, ...urls].sort((a, b) => (a.added ?? 0) - (b.added ?? 0));
playlist.setTracks([...repo, ...shared.filter((t) => !own.has(t.externalId)), ...personal], saved.last);
if (warning) toast(warning);

// Persist settings whenever they change.
let snapshot = "";
subscribe((s) => {
  const next = JSON.stringify({ volume: s.volume, muted: s.muted, shuffle: s.shuffle, repeat: s.repeat, last: playlist.current()?.id });
  if (next !== snapshot) { snapshot = next; storage.save("settings", JSON.parse(next)); }
});
