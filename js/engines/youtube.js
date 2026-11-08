// YouTube IFrame Player API engine. The player must stay visible (YouTube API terms), so it is
// rendered inside the cover slot; ui.js shows that slot whenever a YouTube track is current.
import { loadScript } from "./sdk.js";

const API = "https://www.youtube.com/iframe_api";
const ERRORS = { 2: "Invalid video id", 5: "Playback error", 100: "Video not found", 101: "Embedding disabled by the owner", 150: "Embedding disabled by the owner" };
let apiReady = null;

function ready() {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiReady) {
    apiReady = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
      loadScript(API).catch(rej);
    });
  }
  return apiReady;
}

export function createYouTube({ container, handlers }) {
  let player = null, timer = null, destroyed = false, volume = 1, muted = false, dur = 0;
  const el = document.createElement("div");
  container.append(el);

  const tick = () => { if (player?.getCurrentTime) handlers.onTime(player.getCurrentTime()); };
  const stopPoll = () => { clearInterval(timer); timer = null; };
  const startPoll = () => { stopPoll(); timer = setInterval(tick, 250); };
  const applyVolume = () => {
    if (!player?.setVolume) return;
    player.setVolume(Math.round(volume * 100));
    muted ? player.mute() : player.unMute();
  };

  const init = ready().then(() => new Promise((res, rej) => {
    if (destroyed) return res();
    player = new YT.Player(el, {
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, rel: 0, controls: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { applyVolume(); res(); },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { dur = player.getDuration() || dur; if (dur) handlers.onDuration(dur); handlers.onPlay(); startPoll(); }
          else if (e.data === S.PAUSED) { stopPoll(); tick(); handlers.onPause(); }
          else if (e.data === S.ENDED) { stopPoll(); handlers.onEnded(); }
          else if (e.data === S.CUED) { dur = player.getDuration() || dur; if (dur) handlers.onDuration(dur); }
        },
        onError: (e) => { stopPoll(); const err = new Error(ERRORS[e.data] || "YouTube error"); handlers.onError(err); rej(err); },
      },
    });
  }));
  init.catch(() => { /* reported through handlers.onError */ });

  return {
    provider: "youtube",
    async load(track, { autoplay }) {
      await init;
      if (destroyed) return;
      dur = track.duration || 0;
      autoplay ? player.loadVideoById(track.externalId) : player.cueVideoById(track.externalId);
    },
    play() { init.then(() => player?.playVideo?.()).catch(() => {}); },
    pause() { player?.pauseVideo?.(); },
    seek(t) { player?.seekTo?.(t, true); return t; },
    setVolume(v) { volume = v; applyVolume(); },
    setMuted(m) { muted = m; applyVolume(); },
    currentTime: () => player?.getCurrentTime?.() ?? 0,
    duration: () => player?.getDuration?.() || dur,
    destroy() {
      destroyed = true;
      stopPoll();
      try { player?.destroy(); } catch { /* ignore */ }
      player = null;
      el.remove();
    },
  };
}
