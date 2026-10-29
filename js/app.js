import { getState, setState, subscribe } from "./state.js";
import * as storage from "./storage.js";
import * as player from "./player.js";
import * as playlist from "./playlist.js";
import * as local from "./local-files.js";
import { initUI, toast } from "./ui.js";
import { initMediaSession } from "./media-session.js";

async function loadRepoTracks() {
  try {
    const res = await fetch("data/tracks.json");
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    setState({ error: "Couldn't load the track list. Reload the page to try again." });
    return [];
  }
}

const saved = storage.load("settings", {});
setState({
  volume: saved.volume ?? 0.8,
  muted: !!saved.muted,
  shuffle: !!saved.shuffle,
  repeat: ["off", "all", "one"].includes(saved.repeat) ? saved.repeat : "off",
});

const onPrev = () => (getState().currentTime > 3 ? player.seek(0) : playlist.prev());
const onNext = () => playlist.next();

player.init({
  onEnded() {
    if (getState().repeat === "one") { player.seek(0); player.play(); }
    else if (!playlist.next()) setState({ playing: false });
  },
  onError() {
    const t = playlist.current();
    if (!t) return;
    setState({ failed: [...getState().failed, t.id], error: `"${t.title}" can't be played. Skipping it.` });
    if (!playlist.next()) setState({ playing: false });
  },
});
initUI({ onPrev, onNext });
initMediaSession({ play: player.play, pause: player.pause, prev: onPrev, next: onNext, seekTo: player.seek });

const [repo, { tracks: mine, warning }] = await Promise.all([loadRepoTracks(), local.loadAll()]);
playlist.setTracks([...repo, ...mine], saved.last);
if (warning) toast(warning);

// Persist settings whenever they change.
let snapshot = "";
subscribe((s) => {
  const next = JSON.stringify({ volume: s.volume, muted: s.muted, shuffle: s.shuffle, repeat: s.repeat, last: playlist.current()?.id });
  if (next !== snapshot) { snapshot = next; storage.save("settings", JSON.parse(next)); }
});
