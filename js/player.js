import { getState, setState, subscribe } from "./state.js";

const audio = new Audio();
audio.preload = "metadata";
let loadedId = null;

export function init({ onEnded, onError }) {
  audio.addEventListener("timeupdate", () => setState({ currentTime: audio.currentTime }));
  audio.addEventListener("loadedmetadata", () => setState({ duration: audio.duration || 0 }));
  audio.addEventListener("play", () => setState({ playing: true }));
  audio.addEventListener("pause", () => { if (!audio.ended) setState({ playing: false }); });
  audio.addEventListener("ended", () => onEnded?.());
  audio.addEventListener("error", () => onError?.());
  subscribe(sync);
  sync(getState());
}

function sync(s) {
  audio.volume = s.volume;
  audio.muted = s.muted;
  const t = s.tracks[s.order[s.position]];
  if (!t) {
    if (loadedId) { loadedId = null; audio.pause(); audio.removeAttribute("src"); audio.load(); }
    return;
  }
  if (t.id !== loadedId) {
    loadedId = t.id;
    audio.src = t.src;
    setState({ currentTime: 0, duration: t.duration || 0 });
    if (s.playing) play();
  }
}

export function play() {
  audio.play().catch((e) => {
    if (e.name === "NotAllowedError") setState({ playing: false });
  });
}
export const pause = () => audio.pause();
export function toggle() {
  if (!loadedId) return;
  audio.paused ? play() : pause();
}
export function seek(t) { audio.currentTime = Math.max(0, Math.min(t, audio.duration || t)); setState({ currentTime: audio.currentTime }); }
export const seekBy = (d) => seek(audio.currentTime + d);
export function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  setState({ volume: v, muted: v === 0 });
}
export const toggleMute = () => setState({ muted: !getState().muted });
