// Shared IndexedDB access. Version 2 adds the url-tracks store.
const DB = "music-player", VERSION = 2;
export const STORES = { local: "local-tracks", url: "url-tracks" };

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, VERSION);
  r.onupgradeneeded = () => {
    const db = r.result;
    for (const name of Object.values(STORES)) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    }
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.onblocked = () => rej(new Error("Database upgrade blocked by another tab"));
});

/** Runs fn(objectStore) inside a transaction and resolves with the request result. */
export async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}
