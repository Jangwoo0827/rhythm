import { readJSON, writeJSON } from '../storage';
import { DEFAULT_KEYS, sanitizeKeys } from './keys';
import type { Difficulty } from './types';

export interface Settings {
  /** 판정/표시 오프셋(ms). 양수 = 소리가 늦게 들림(블루투스 등) → 노트를 그만큼 늦게 처리 */
  offsetMs: number;
  /** 노트 속도 1(느림)~10(빠름) */
  speed: number;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  difficulty: Difficulty;
  /** PC 키 바인딩 (레인 1~4, KeyboardEvent.code). 기기마다 달라서 클라우드 동기화 대상이 아니다 */
  keys: string[];
  /** 내가 분석한 곡을 공개 목록(공유 맵 둘러보기)에 올릴지 */
  publicShare: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMs: 0,
  speed: 5,
  musicVolume: 1,
  sfxVolume: 0.7,
  difficulty: 'normal',
  keys: [...DEFAULT_KEYS],
  publicShare: true,
};

export const OFFSET_LIMIT = 300;
export const SPEED_MIN = 1;
export const SPEED_MAX = 10;

const KEY = 'rhythm.settings.v1';

/** 노트가 위에서 판정선까지 내려오는 시간(초). 속도 5 = 1.4초 */
export function approachFor(speed: number): number {
  return 1.4 + (5 - speed) * 0.15;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** 저장된(신뢰할 수 없는) 값을 유효한 설정으로 정리 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const diff = r.difficulty === 'easy' || r.difficulty === 'normal' || r.difficulty === 'hard' ? r.difficulty : d.difficulty;
  return {
    offsetMs: Math.round(clamp(num(r.offsetMs, d.offsetMs), -OFFSET_LIMIT, OFFSET_LIMIT)),
    speed: Math.round(clamp(num(r.speed, d.speed), SPEED_MIN, SPEED_MAX)),
    musicVolume: clamp(num(r.musicVolume, d.musicVolume), 0, 1),
    sfxVolume: clamp(num(r.sfxVolume, d.sfxVolume), 0, 1),
    difficulty: diff,
    keys: sanitizeKeys(r.keys),
    publicShare: typeof r.publicShare === 'boolean' ? r.publicShare : d.publicShare,
  };
}

let current: Settings = sanitizeSettings(readJSON(KEY));
const listeners = new Set<(s: Readonly<Settings>) => void>();

/** 설정이 바뀔 때마다 호출 (클라우드 동기화용). 해제 함수를 반환. */
export function onSettingsChange(fn: (s: Readonly<Settings>) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => { for (const fn of listeners) fn(current); };

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Readonly<Settings> {
  current = sanitizeSettings({ ...current, ...patch });
  writeJSON(KEY, current);
  emit();
  return current;
}

export function resetSettings(): Readonly<Settings> {
  current = { ...DEFAULT_SETTINGS };
  writeJSON(KEY, current);
  emit();
  return current;
}
