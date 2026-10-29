import { getState, subscribe } from "./state.js";

export function initMediaSession({ play, pause, prev, next, seekTo }) {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* unsupported action */ } };
  set("play", play); set("pause", pause);
  set("previoustrack", prev); set("nexttrack", next);
  set("seekto", (e) => seekTo(e.seekTime));
  let lastId = null;
  subscribe((s) => {
    const t = s.tracks[s.order[s.position]];
    ms.playbackState = s.playing ? "playing" : "paused";
    if (t && t.id !== lastId) {
      lastId = t.id;
      ms.metadata = new MediaMetadata({
        title: t.title, artist: t.artist,
        artwork: t.cover ? [{ src: new URL(t.cover, location.href).href }] : [],
      });
    }
    if (s.duration && isFinite(s.duration)) {
      try { ms.setPositionState({ duration: s.duration, position: Math.min(s.currentTime, s.duration), playbackRate: 1 }); } catch { /* ignore */ }
    }
  });
}
