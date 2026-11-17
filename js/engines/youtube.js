// YouTube IFrame Player API engine. The player is rendered inside the cover slot. By default it stays
// visible, as the YouTube API terms require. Two options from config.json `playback` change that, and
// both knowingly depart from those terms (plan.md, "play linked videos as audio only"):
//   hideVideo - ui.js covers the player with the artwork. If a play request has not started playback
//               within 4 s (blocked autoplay on a phone, or a long ad) the engine asks for the player
//               to be revealed through handlers.onReveal.
//   muteAds   - an ad cannot be skipped or blocked from outside the iframe, so it is muted instead.
//               "Quiet" means: playback was requested and the player reports UNSTARTED (-1), or it
//               reports a video id other than the track's. These signals have not been confirmed
//               against live ads. Muting while unstarted is harmless when there is no ad.
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

const AD_HINT_MS = 1500, START_MS = 4000;

export function createYouTube({ container, handlers, options = {} }) {
  const { hideVideo = false, muteAds = false } = options;
  let player = null, timer = null, destroyed = false, volume = 1, muted = false, dur = 0;
  let wantId = null, wantPlay = false, ytState = null, quietSince = 0, inAd = false, startTimer = null;
  const el = document.createElement("div");
  container.append(el);

  const otherVideo = () => {
    const id = player?.getVideoData?.()?.video_id;
    return !!id && !!wantId && id !== wantId;
  };
  // Tracks the quiet (suspected ad) state: mutes at once, reports an ad only after it has lasted a moment.
  const watch = () => {
    if (!muteAds) return;
    const quiet = wantPlay && (ytState === -1 || otherVideo());
    if (quiet !== !!quietSince) { quietSince = quiet ? Date.now() : 0; applyVolume(); }
    const ad = quiet && Date.now() - quietSince >= AD_HINT_MS;
    if (ad !== inAd) { inAd = ad; handlers.onAd?.(ad); }
  };
  // Ad time is not forwarded, so the seek bar and the logged position stay on the track.
  const tick = () => { watch(); if (!quietSince && player?.getCurrentTime) handlers.onTime(player.getCurrentTime()); };
  const expectStart = () => {
    wantPlay = true;
    startPoll();
    clearTimeout(startTimer);
    if (hideVideo) startTimer = setTimeout(() => handlers.onReveal?.(true), START_MS);
  };
  const started = () => { clearTimeout(startTimer); handlers.onReveal?.(false); };
  const stopPoll = () => { clearInterval(timer); timer = null; };
  const startPoll = () => { stopPoll(); timer = setInterval(tick, 250); };
  const applyVolume = () => {
    if (!player?.setVolume) return;
    player.setVolume(Math.round(volume * 100));
    muted || quietSince ? player.mute() : player.unMute();
  };

  const init = ready().then(() => new Promise((res, rej) => {
    if (destroyed) return res();
    player = new YT.Player(el, {
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, rel: 0, controls: hideVideo ? 0 : 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { applyVolume(); res(); },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          ytState = e.data;
          if (e.data === S.PLAYING) wantPlay = true;
          watch();
          if (e.data === S.PLAYING) {
            if (!quietSince) { started(); dur = player.getDuration() || dur; if (dur) handlers.onDuration(dur); }
            handlers.onPlay(); startPoll();
          }
          else if (e.data === S.PAUSED) { wantPlay = false; clearTimeout(startTimer); stopPoll(); tick(); handlers.onPause(); }
          else if (e.data === S.ENDED) {
            if (muteAds && otherVideo()) return; // an ad finished, not the track
            wantPlay = false; clearTimeout(startTimer); stopPoll(); watch(); handlers.onEnded();
          }
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
      wantId = track.externalId; ytState = null; wantPlay = false;
      if (autoplay) expectStart();
      autoplay ? player.loadVideoById(track.externalId) : player.cueVideoById(track.externalId);
    },
    play() { expectStart(); init.then(() => player?.playVideo?.()).catch(() => {}); },
    pause() { wantPlay = false; clearTimeout(startTimer); player?.pauseVideo?.(); },
    seek(t) { player?.seekTo?.(t, true); return t; },
    setVolume(v) { volume = v; applyVolume(); },
    setMuted(m) { muted = m; applyVolume(); },
    currentTime: () => player?.getCurrentTime?.() ?? 0,
    duration: () => player?.getDuration?.() || dur,
    destroy() {
      destroyed = true;
      stopPoll();
      clearTimeout(startTimer);
      try { player?.destroy(); } catch { /* ignore */ }
      player = null;
      el.remove();
    },
  };
}
