import { readJSON, writeJSON } from '../storage';

/** 닉네임은 로컬에도 저장해 두고(오프라인·로그인 전에도 점수에 사용), 로그인하면 users/{uid} 와 동기화한다. */
const KEY = 'rhythm.profile.v1';
export const NICKNAME_MAX = 16;

interface Stored { nickname?: string; syncedUid?: string }

export function sanitizeNickname(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
}

export function getNickname(): string {
  const stored = readJSON<Stored>(KEY);
  const n = stored?.nickname ? sanitizeNickname(stored.nickname) : '';
  if (n) return n;
  const generated = `Player${Math.floor(1000 + Math.random() * 9000)}`;
  writeJSON(KEY, { ...stored, nickname: generated });
  return generated;
}

/** 저장된 닉네임을 반환 (빈 값이면 변경하지 않고 기존 닉네임 유지) */
export function setNickname(raw: string): string {
  const n = sanitizeNickname(raw);
  if (!n) return getNickname();
  writeJSON(KEY, { ...readJSON<Stored>(KEY), nickname: n });
  return n;
}

/** 이 기기가 마지막으로 프로필(설정)을 동기화한 계정. 계정이 바뀌면(다른 계정으로 로그인) 그 계정의 클라우드 설정을 받아온다. */
export function lastSyncedUid(): string | null {
  return readJSON<Stored>(KEY)?.syncedUid ?? null;
}
export function setLastSyncedUid(uid: string): void {
  writeJSON(KEY, { ...readJSON<Stored>(KEY), syncedUid: uid });
}
