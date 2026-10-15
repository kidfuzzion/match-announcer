// Tiny IndexedDB wrapper. Three stores:
//   kv     – the app state (rosters, scripts, settings) as one JSON object
//   blobs  – audio files you load (anthem, home music)
//   clips  – generated voice clips, keyed by a hash of voice settings + text

const DB_NAME = 'match-announcer';
const DB_VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['kv', 'blobs', 'clips']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => reqP(s.get(key))),
  put: (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); }),
  del: (store, key) => tx(store, 'readwrite', s => { s.delete(key); }),
  keys: (store) => tx(store, 'readonly', s => reqP(s.getAllKeys())),
  clear: (store) => tx(store, 'readwrite', s => { s.clear(); }),
  async entries(store) {
    const ks = await this.keys(store);
    const out = [];
    for (const k of ks) out.push([k, await this.get(store, k)]);
    return out;
  },
};

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
