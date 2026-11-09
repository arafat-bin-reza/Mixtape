// Spotify Embed iFrame API engine. Spotify's embed terms require the player to stay visible, so it is
// rendered inside the cover slot like YouTube; ui.js shows that slot whenever a Spotify track is current.
//
// The API exposes no volume control and no "ended" event. Play, pause and end are derived from the
// `playback_update` stream (position/duration in ms, isPaused). Visitors who are not logged in to Spotify
// in this browser hear a 30 s preview; that is reported through handlers.onPreview so the UI can say so.
import { loadScript } from "./sdk.js";

const API = "https://open.spotify.com/embed/iframe-api/v1";
const LOAD_TIMEOUT = 10000;
const PREVIEW_SECONDS = [29, 31];
let apiReady = null;

function ready() {
  if (!apiReady) {
    apiReady = new Promise((res, rej) => {
      const prev = window.onSpotifyIframeApiReady;
      window.onSpotifyIframeApiReady = (api) => { prev?.(api); res(api); };
      loadScript(API).catch((e) => { apiReady = null; rej(e); });
    });
  }
  return apiReady;
}

export function createSpotify({ container, handlers }) {
  let controller = null, init = null, embedReady = null, destroyed = false;
  let uri = null, dur = 0, pos = 0, maxPos = 0, playing = false, started = false, ended = false, preview = false;
  const wrap = document.createElement("div");
  wrap.className = "sp";
  container.append(wrap);

  const resetTrack = (track) => {
    uri = track.externalId; dur = track.duration || 0; pos = 0; maxPos = 0;
    playing = false; started = false; ended = false; preview = false;
  };

  function onUpdate(e) {
    if (destroyed) return;
    const d = e?.data || {};
    if (d.playingURI && uri && d.playingURI !== uri) return; // stale event from the previous entity
    const duration = (d.duration || 0) / 1000, position = (d.position || 0) / 1000;
    if (duration > 0) {
      if (duration !== dur) { dur = duration; handlers.onDuration(duration); }
      const isPreview = duration >= PREVIEW_SECONDS[0] && duration <= PREVIEW_SECONDS[1];
      if (isPreview !== preview) { preview = isPreview; handlers.onPreview?.(isPreview); }
    }
    pos = position;
    handlers.onTime(position);
    if (!d.isPaused) {
      maxPos = Math.max(maxPos, position);
      if (!playing) { playing = true; started = true; ended = false; handlers.onPlay(); }
      return;
    }
    if (!playing) return;
    playing = false;
    const nearEnd = dur > 0 && position >= dur - 1.5;
    const rewound = position === 0 && maxPos > 0;
    if (!ended && dur > 0 && maxPos >= dur * 0.5 && (nearEnd || rewound)) { ended = true; handlers.onEnded(); }
    else handlers.onPause();
  }

  function setup(track) {
    return ready().then((api) => new Promise((res, rej) => {
      if (destroyed) return res();
      const timer = setTimeout(() => rej(new Error("Spotify player did not load")), LOAD_TIMEOUT);
      const el = document.createElement("div");
      wrap.append(el);
      api.createController(el, { width: "100%", height: 352, uri: track.externalId }, (ctrl) => {
        if (destroyed) { try { ctrl.destroy(); } catch { /* ignore */ } return res(); }
        clearTimeout(timer);
        controller = ctrl;
        // `ready` may already have fired; wait for it briefly before the first play() rather than depending on it.
        embedReady = new Promise((r) => { ctrl.addListener("ready", r); setTimeout(r, 3000); });
        ctrl.addListener("playback_update", onUpdate);
        res();
      });
    }));
  }

  return {
    provider: "spotify",
    async load(track, { autoplay }) {
      resetTrack(track);
      if (!init) { init = setup(track); await init; }
      else { await init; if (destroyed) return; controller?.loadEntity(track.externalId); }
      if (destroyed || !autoplay) return;
      await embedReady;
      if (!destroyed && uri === track.externalId) controller?.play();
    },
    play() { init?.then(() => { if (!destroyed) started ? controller?.resume() : controller?.play(); }).catch(() => {}); },
    pause() { controller?.pause(); },
    seek(t) { controller?.seek(Math.round(t)); pos = t; return t; },
    setVolume() { /* the Spotify embed has no volume API */ },
    setMuted() { /* the Spotify embed has no mute API */ },
    currentTime: () => pos,
    duration: () => dur,
    destroy() {
      destroyed = true;
      try { controller?.destroy(); } catch { /* ignore */ }
      controller = null;
      wrap.remove();
    },
  };
}
