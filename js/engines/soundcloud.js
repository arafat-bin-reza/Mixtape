// SoundCloud Widget API engine. The widget iframe is kept off-screen; SoundCloud's embed terms allow this.
import { loadScript } from "./sdk.js";

const API = "https://w.soundcloud.com/player/api.js";

export function createSoundCloud({ container, handlers }) {
  let widget = null, init = null, destroyed = false, volume = 1, muted = false, dur = 0, pos = 0;
  const iframe = document.createElement("iframe");
  iframe.allow = "autoplay";
  iframe.title = "SoundCloud player";

  const applyVolume = () => widget?.setVolume(muted ? 0 : Math.round(volume * 100));
  const readDuration = () => widget?.getDuration((ms) => { dur = ms / 1000; if (dur) handlers.onDuration(dur); });
  const params = (url, autoplay) =>
    `url=${encodeURIComponent(url)}&auto_play=${autoplay}&show_artwork=false&visual=false&hide_related=true&show_comments=false&show_teaser=false`;

  function setup(track, autoplay) {
    iframe.src = `https://w.soundcloud.com/player/?${params(track.src, autoplay)}`;
    container.append(iframe);
    return loadScript(API).then(() => new Promise((res, rej) => {
      if (destroyed) return res();
      widget = SC.Widget(iframe);
      const E = SC.Widget.Events;
      const failTimer = setTimeout(() => rej(new Error("SoundCloud player did not load")), 15000);
      widget.bind(E.READY, () => { clearTimeout(failTimer); applyVolume(); readDuration(); res(); });
      widget.bind(E.PLAY, () => handlers.onPlay());
      widget.bind(E.PAUSE, () => handlers.onPause());
      widget.bind(E.FINISH, () => handlers.onEnded());
      widget.bind(E.PLAY_PROGRESS, (e) => { pos = (e.currentPosition || 0) / 1000; handlers.onTime(pos); });
      widget.bind(E.ERROR, () => { clearTimeout(failTimer); const err = new Error("SoundCloud can't play this track"); handlers.onError(err); rej(err); });
    }));
  }

  return {
    provider: "soundcloud",
    async load(track, { autoplay }) {
      pos = 0; dur = track.duration || 0;
      if (!init) { init = setup(track, autoplay); await init; return; }
      await init;
      if (destroyed) return;
      await new Promise((res) => widget.load(track.src, { auto_play: autoplay, show_artwork: false, callback: () => { applyVolume(); readDuration(); res(); } }));
    },
    play() { init?.then(() => widget?.play()).catch(() => {}); },
    pause() { widget?.pause(); },
    seek(t) { widget?.seekTo(t * 1000); pos = t; return t; },
    setVolume(v) { volume = v; applyVolume(); },
    setMuted(m) { muted = m; applyVolume(); },
    currentTime: () => pos,
    duration: () => dur,
    destroy() {
      destroyed = true;
      try { widget?.pause(); } catch { /* ignore */ }
      widget = null;
      iframe.remove();
    },
  };
}
