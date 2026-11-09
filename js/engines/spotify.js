// Spotify Embed iFrame API engine. Spotify's embed terms require the player to stay visible, so it is
// rendered inside the cover slot like YouTube; ui.js shows that slot whenever a Spotify track is current.
//
// The API exposes no volume control and no "ended" event. Play, pause and end are derived from the
// `playback_update` stream (position/duration in ms, isPaused). Visitors who are not logged in to Spotify
// in this browser hear a 30 s preview; that is reported through handlers.onPreview so the UI can say so.
//
// Collections (album, playlist, show, artist) load whole; the embed plays through the items itself and
// reports each one's URI in `playingURI`. Item changes are reported through handlers.onItem, and the
// collection counts as ended when the embed stops after its last item.
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
  let uri = null, collection = false, item = null, endTimer = null;
  let dur = 0, pos = 0, maxPos = 0, playing = false, started = false, ended = false, preview = false;
  const wrap = document.createElement("div");
  wrap.className = "sp";
  container.append(wrap);

  const resetItem = () => { pos = 0; maxPos = 0; ended = false; clearTimeout(endTimer); };
  const resetTrack = (track) => {
    uri = track.externalId; collection = /^spotify:(album|playlist|show|artist):/.test(uri);
    item = null; dur = track.duration || 0;
    resetItem(); playing = false; started = false; preview = false;
  };

  // Observed live: at the end of an item the embed reports position === duration with isPaused still false and
  // then goes quiet; in a collection the next item's update follows within ~100 ms, after the last item nothing
  // follows at all. So "ended" = reached the end and no further progress for this item within a short grace period.
  function armEnd() {
    ended = true;
    const which = collection ? item : uri;
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (destroyed || !ended || (collection ? item : uri) !== which) return;
      if (pos > 0 && pos < dur - 1.5) return; // user seeked back
      playing = false;
      handlers.onEnded();
    }, 1200);
  }

  function onUpdate(e) {
    if (destroyed) return;
    const d = e?.data || {};
    if (d.playingURI && !collection && uri && d.playingURI !== uri) return; // stale event from the previous entity
    if (collection && d.playingURI && d.playingURI !== uri && d.playingURI !== item) {
      // The embed moved to another item in the collection.
      item = d.playingURI;
      resetItem(); dur = 0;
      handlers.onItem?.(item);
    }
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
      if (!playing) { playing = true; started = true; ended = false; clearTimeout(endTimer); handlers.onPlay(); }
      if (!ended && dur > 0 && position >= dur - 0.25) armEnd();
      return;
    }
    if (!playing || ended) return;
    playing = false;
    const nearEnd = dur > 0 && position >= dur - 1.5;
    const rewound = position === 0 && maxPos > 0;
    if (dur > 0 && maxPos >= dur * 0.5 && (nearEnd || rewound)) armEnd(); // some players pause or rewind at the end instead
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
      clearTimeout(endTimer);
      try { controller?.destroy(); } catch { /* ignore */ }
      controller = null;
      wrap.remove();
    },
  };
}
