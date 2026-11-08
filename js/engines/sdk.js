// Lazy, de-duplicated loading of third-party player SDKs. Nothing loads until an engine needs it.
const pending = new Map();

export function loadScript(src) {
  if (pending.has(src)) return pending.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { pending.delete(src); rej(new Error(`Failed to load ${src}`)); };
    document.head.append(s);
  });
  pending.set(src, p);
  return p;
}
