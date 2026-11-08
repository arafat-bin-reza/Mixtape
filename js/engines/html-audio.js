// Engine for anything the browser can play natively: repo tracks, local files, direct URLs, Cloudinary renditions.
// Engine interface (shared by every file in this folder):
//   provider, load(track, { autoplay }) -> Promise|void, play(), pause(), seek(seconds),
//   setVolume(0..1), setMuted(bool), currentTime(), duration(), destroy()
// Engines report back through `handlers`: onTime, onDuration, onPlay, onPause, onEnded, onError, onBlocked.

export function createHtmlAudio({ handlers }) {
  const audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => handlers.onTime(audio.currentTime));
  audio.addEventListener("loadedmetadata", () => handlers.onDuration(audio.duration || 0));
  audio.addEventListener("durationchange", () => handlers.onDuration(audio.duration || 0));
  audio.addEventListener("play", () => handlers.onPlay());
  audio.addEventListener("pause", () => { if (!audio.ended) handlers.onPause(); });
  audio.addEventListener("ended", () => handlers.onEnded());
  audio.addEventListener("error", () => handlers.onError(audio.error || new Error("media error")));

  const engine = {
    provider: "direct",
    load(track, { autoplay }) {
      audio.src = track.src;
      if (autoplay) engine.play();
    },
    play() {
      audio.play().catch((e) => { if (e.name === "NotAllowedError") handlers.onBlocked(); });
    },
    pause() { audio.pause(); },
    seek(t) {
      audio.currentTime = Math.max(0, Math.min(t, audio.duration || t));
      return audio.currentTime;
    },
    setVolume(v) { audio.volume = v; },
    setMuted(m) { audio.muted = m; },
    currentTime: () => audio.currentTime,
    duration: () => audio.duration || 0,
    unload() { audio.pause(); audio.removeAttribute("src"); audio.load(); },
    destroy() { engine.unload(); },
  };
  return engine;
}
