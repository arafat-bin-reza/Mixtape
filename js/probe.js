/** Loads metadata for a media URL with a throwaway <audio>. Resolves with the rounded duration in seconds. */
export function probe(src, ms = 8000) {
  return new Promise((res, rej) => {
    const a = new Audio();
    let timer;
    const done = (fn, v) => {
      clearTimeout(timer);
      a.onloadedmetadata = a.onerror = null;
      a.removeAttribute("src");
      fn(v);
    };
    timer = setTimeout(() => done(rej, new Error("timeout")), ms);
    a.preload = "metadata";
    a.onloadedmetadata = () => done(res, Math.round(a.duration) || 0);
    a.onerror = () => done(rej, new Error("unsupported"));
    a.src = src;
  });
}
