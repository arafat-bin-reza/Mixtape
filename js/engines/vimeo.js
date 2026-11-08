// Vimeo Player SDK engine. Vimeo permits background (hidden) playback through the SDK.
import { loadScript } from "./sdk.js";

const API = "https://player.vimeo.com/api/player.js";

export function createVimeo({ container, handlers }) {
  let player = null, init = null, destroyed = false, dur = 0, pos = 0;
  const el = document.createElement("div");
  container.append(el);

  const ref = (track) => (track.hash ? { id: Number(track.externalId), h: track.hash } : Number(track.externalId));
  const bind = () => {
    player.on("play", () => handlers.onPlay());
    player.on("pause", () => handlers.onPause());
    player.on("ended", () => handlers.onEnded());
    player.on("timeupdate", (d) => {
      pos = d.seconds;
      if (d.duration && d.duration !== dur) { dur = d.duration; handlers.onDuration(dur); }
      handlers.onTime(pos);
    });
    player.on("loaded", () => player.getDuration().then((d) => { if (d) { dur = d; handlers.onDuration(d); } }).catch(() => {}));
    player.on("error", (e) => handlers.onError(new Error(e?.message || "Vimeo can't play this video")));
  };

  return {
    provider: "vimeo",
    async load(track, { autoplay }) {
      pos = 0; dur = track.duration || 0;
      try {
        if (!init) {
          init = loadScript(API).then(() => {
            if (destroyed) return;
            const opts = typeof ref(track) === "object" ? { ...ref(track) } : { id: ref(track) };
            player = new Vimeo.Player(el, { ...opts, controls: false, autopause: false, dnt: true, width: 320 });
            bind();
            return player.ready();
          });
          await init;
        } else {
          await init;
          if (destroyed) return;
          await player.loadVideo(ref(track));
        }
      } catch (e) {
        handlers.onError(e instanceof Error ? e : new Error(e?.message || "Vimeo can't play this video"));
        return;
      }
      if (destroyed) return;
      if (autoplay) this.play();
    },
    play() {
      init?.then(() => player?.play()).catch((e) => {
        if (e?.name === "PlayInterrupted") return;
        e?.name === "NotAllowedError" ? handlers.onBlocked() : handlers.onError(new Error(e?.message || "Vimeo playback failed"));
      });
    },
    pause() { player?.pause().catch(() => {}); },
    seek(t) { player?.setCurrentTime(t).catch(() => {}); pos = t; return t; },
    setVolume(v) { player?.setVolume(v).catch(() => {}); },
    setMuted(m) { player?.setMuted(m).catch(() => {}); },
    currentTime: () => pos,
    duration: () => dur,
    destroy() {
      destroyed = true;
      player?.destroy().catch(() => {});
      player = null;
      el.remove();
    },
  };
}
