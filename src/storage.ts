/** localStorage 래퍼. 시크릿 모드/용량 초과/접근 차단에서도 앱이 죽지 않도록 모든 접근을 try/catch 로 감싼다. */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJSON<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 저장 성공 여부를 반환 (용량 초과 등이면 false) */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    store()?.removeItem(key);
  } catch { /* 무시 */ }
}
