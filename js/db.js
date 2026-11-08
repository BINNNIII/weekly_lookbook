// 폰 안 저장소(IndexedDB). 서버 없이 이 기기에만 저장된다.
const DB_NAME = 'weekly-lookbook';
const DB_VERSION = 1;
export const STORES = {
  items: 'id',          // 옷장
  outfits: 'date',      // 날짜별 코디 (다음 주 포함)
  illustrations: 'date',// 날짜별 일러스트
  feedback: 'id',       // 좋아요/별로예요/기본 규칙
  meta: 'key',          // 설정, 마지막 캘린더 스냅샷 등
};

let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

export const getAll = store => tx(store, 'readonly', s => s.getAll());
export const get = (store, key) => tx(store, 'readonly', s => s.get(key));
export const put = (store, value) => tx(store, 'readwrite', s => s.put(value));
export const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

// 전체 교체 (백업 불러오기용) — 한 번에 처리해서 중간에 실패하면 아무것도 안 바뀜
export function replaceAll(data) {
  return open().then(db => new Promise((res, rej) => {
    const names = Object.keys(STORES);
    const t = db.transaction(names, 'readwrite');
    for (const n of names) {
      const s = t.objectStore(n);
      s.clear();
      for (const v of data[n] || []) s.put(v);
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('불러오기 취소됨'));
  }));
}

export async function dumpAll() {
  const out = {};
  for (const n of Object.keys(STORES)) out[n] = await getAll(n);
  return out;
}
