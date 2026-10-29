const state = {
  tracks: [], order: [], position: 0,
  playing: false, currentTime: 0, duration: 0,
  volume: 0.8, muted: false, shuffle: false, repeat: "off",
  failed: [], error: null,
};
const listeners = new Set();
export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}
