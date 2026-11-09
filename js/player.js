// Playback facade. Picks an engine per track provider and mirrors engine events into state.
// Public API is unchanged from the single-<audio> version so ui.js / app.js / media-session.js need no changes.
import { getState, setState, subscribe } from "./state.js";
import { createHtmlAudio } from "./engines/html-audio.js";
import { createYouTube } from "./engines/youtube.js";
import { createSoundCloud } from "./engines/soundcloud.js";
import { createVimeo } from "./engines/vimeo.js";
import { createSpotify } from "./engines/spotify.js";

const factories = { youtube: createYouTube, soundcloud: createSoundCloud, vimeo: createVimeo, spotify: createSpotify };
let engine = null, html = null, loadedId = null, container = null, callbacks = {};
let applied = { volume: null, muted: null };

const providerOf = (track) => (track.provider in factories ? track.provider : "direct");

function make(factory) {
  const handlers = {};
  const eng = factory({ container, handlers });
  const live = () => engine === eng;
  Object.assign(handlers, {
    onTime: (t) => live() && setState({ currentTime: t }),
    onDuration: (d) => live() && isFinite(d) && d > 0 && setState({ duration: d }),
    onPlay: () => live() && setState({ playing: true }),
    onPause: () => live() && setState({ playing: false }),
    onEnded: () => live() && callbacks.onEnded?.(),
    onError: (e) => live() && callbacks.onError?.(e),
    onBlocked: () => live() && setState({ playing: false }),
    onPreview: (p) => live() && setState({ preview: !!p }),
  });
  return eng;
}

function engineFor(track) {
  const provider = providerOf(track);
  if (engine && engine.provider === provider) return engine;
  if (engine) engine === html ? html.unload() : engine.destroy();
  applied = { volume: null, muted: null };
  engine = provider === "direct" ? (html ??= make(createHtmlAudio)) : make(factories[provider]);
  return engine;
}

function applyVolume(s) {
  if (!engine) return;
  if (s.volume !== applied.volume) { applied.volume = s.volume; engine.setVolume(s.volume); }
  if (s.muted !== applied.muted) { applied.muted = s.muted; engine.setMuted(s.muted); }
}

function sync(s) {
  const t = s.tracks[s.order[s.position]];
  if (!t) {
    if (loadedId) {
      loadedId = null;
      if (engine === html) html.unload();
      else { engine?.destroy(); engine = null; }
    }
    return;
  }
  if (t.id !== loadedId) {
    loadedId = t.id;
    const eng = engineFor(t);
    setState({ currentTime: 0, duration: t.duration || 0, preview: false });
    applyVolume(getState());
    Promise.resolve()
      .then(() => eng.load(t, { autoplay: getState().playing }))
      .then(() => { if (loadedId === t.id && engine === eng) { applied = { volume: null, muted: null }; applyVolume(getState()); } })
      .catch((e) => { if (loadedId === t.id) callbacks.onError?.(e); });
  }
  applyVolume(s);
}

export function init({ onEnded, onError, embedContainer }) {
  callbacks = { onEnded, onError };
  container = embedContainer;
  subscribe(sync);
  sync(getState());
}

export function play() { engine?.play(); }
export function pause() { engine?.pause(); }
export function toggle() {
  if (!loadedId) return;
  getState().playing ? pause() : play();
}
export function seek(t) {
  if (!engine) return;
  const d = getState().duration;
  const clamped = Math.max(0, Math.min(t, d || t));
  engine.seek(clamped);
  setState({ currentTime: clamped });
}
export const seekBy = (d) => seek(getState().currentTime + d);
export function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  setState({ volume: v, muted: v === 0 });
}
export const toggleMute = () => setState({ muted: !getState().muted });
