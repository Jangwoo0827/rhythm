/**
 * 곡 파일을 "이 기기의 브라우저(IndexedDB)"에만 저장한다. 서버로는 절대 올라가지 않는다.
 * 같은 기기에서는 최근 곡/공유 맵을 눌렀을 때 파일을 다시 고르지 않아도 된다.
 * 오래 쓰지 않은 곡부터 지워 개수·용량 상한을 지키고, 저장소를 못 쓰는 환경(시크릿 모드 등)에서는 조용히 포기한다.
 */
const DB_NAME = 'rhythm-songs';
const STORE = 'songs';
export const MAX_STORED_SONGS = 12;
export const MAX_STORED_BYTES = 300 * 1024 * 1024;

interface StoredSong {
  hash: string;
  name: string;
  type: string;
  blob: Blob;
  size: number;
  savedAt: number;
  lastUsed: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'hash' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('aborted')); };
  }));
}

const all = () => run<StoredSong[]>('readonly', (s) => s.getAll());

export interface StoreUsage { count: number; bytes: number }

export async function usage(): Promise<StoreUsage> {
  try {
    const list = await all();
    return { count: list.length, bytes: list.reduce((a, s) => a + s.size, 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** 저장된 곡의 곡 지문 목록 (목록 화면의 "저장됨" 표시용) */
export async function storedHashes(): Promise<Set<string>> {
  try {
    return new Set((await all()).map((s) => s.hash));
  } catch {
    return new Set();
  }
}

/** 저장. 성공하면 true. 상한을 넘으면 오래 쓰지 않은 곡부터 지운다. 이 곡 하나가 상한보다 크면 저장하지 않는다. */
export async function saveSong(hash: string, blob: Blob, name: string): Promise<boolean> {
  if (blob.size > MAX_STORED_BYTES) return false;
  try {
    const now = Date.now();
    const existing = await run<StoredSong | undefined>('readonly', (s) => s.get(hash));
    if (existing) {
      await run('readwrite', (s) => s.put({ ...existing, lastUsed: now }));
      return true;
    }
    await run('readwrite', (s) => s.put({ hash, name, type: blob.type, blob, size: blob.size, savedAt: now, lastUsed: now } satisfies StoredSong));
    await evict(hash);
    navigator.storage?.persist?.().catch(() => {}); // 브라우저가 임의로 지우지 않도록 요청 (실패해도 무방)
    return true;
  } catch {
    return false; // 용량 초과/저장소 차단 등
  }
}

async function evict(keep: string): Promise<void> {
  const list = (await all()).sort((a, b) => b.lastUsed - a.lastUsed); // 최근 사용 순
  let bytes = 0;
  for (let i = 0; i < list.length; i++) {
    bytes += list[i].size;
    if ((i >= MAX_STORED_SONGS || bytes > MAX_STORED_BYTES) && list[i].hash !== keep) {
      await run('readwrite', (s) => s.delete(list[i].hash));
      bytes -= list[i].size;
    }
  }
}

/** 곡 파일을 꺼내 최근 사용 시각을 갱신한다. 없으면 null. */
export async function loadSong(hash: string): Promise<File | null> {
  try {
    const s = await run<StoredSong | undefined>('readonly', (st) => st.get(hash));
    if (!s) return null;
    void run('readwrite', (st) => st.put({ ...s, lastUsed: Date.now() })).catch(() => {});
    return new File([s.blob], s.name, { type: s.type });
  } catch {
    return null;
  }
}

export async function deleteSong(hash: string): Promise<void> {
  try { await run('readwrite', (s) => s.delete(hash)); } catch { /* 무시 */ }
}

export async function clearSongs(): Promise<void> {
  try { await run('readwrite', (s) => s.clear()); } catch { /* 무시 */ }
}
