import { getState, setState } from "./state.js";

function shuffled(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeOrder(n, shuffle, first) {
  const idx = [...Array(n).keys()];
  if (!shuffle) return idx;
  if (first == null) return shuffled(idx);
  idx.splice(first, 1);
  return [first, ...shuffled(idx)];
}

export const current = () => { const s = getState(); return s.tracks[s.order[s.position]]; };

export function setTracks(tracks, preferId) {
  const s = getState();
  const id = preferId ?? current()?.id;
  let ci = tracks.findIndex((t) => t.id === id);
  if (ci < 0) ci = tracks.length ? 0 : null;
  const order = makeOrder(tracks.length, s.shuffle, ci);
  setState({ tracks, order, position: ci == null ? 0 : order.indexOf(ci) });
}

export function setShuffle(on) {
  const s = getState();
  const ci = s.order[s.position];
  const order = makeOrder(s.tracks.length, on, ci ?? null);
  setState({ shuffle: on, order, position: Math.max(0, order.indexOf(ci)) });
}

export function cycleRepeat() {
  const s = getState();
  setState({ repeat: { off: "all", all: "one", one: "off" }[s.repeat] });
}

export function select(trackIndex) {
  const s = getState();
  setState({ position: s.order.indexOf(trackIndex), playing: true, currentTime: 0 });
}

/** Moves to the next playable track. Returns false when there is none. */
export function next() {
  const s = getState();
  const n = s.order.length;
  let order = s.order, pos = s.position;
  for (let step = 0; step < n; step++) {
    pos++;
    if (pos >= n) {
      if (s.repeat !== "all") return false;
      pos = 0;
      if (s.shuffle) order = makeOrder(n, true);
    }
    if (!s.failed.includes(s.tracks[order[pos]].id)) {
      setState({ order, position: pos, currentTime: 0 });
      return true;
    }
  }
  return false;
}

export function prev() {
  const s = getState();
  let pos = s.position - 1;
  if (pos < 0) pos = s.repeat === "all" ? s.order.length - 1 : 0;
  setState({ position: pos, currentTime: 0 });
}
