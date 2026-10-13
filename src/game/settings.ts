import { readJSON, writeJSON } from '../storage';
import type { Difficulty } from './types';

export interface Settings {
  /** 판정/표시 오프셋(ms). 양수 = 소리가 늦게 들림(블루투스 등) → 노트를 그만큼 늦게 처리 */
  offsetMs: number;
  /** 노트 속도 1(느림)~10(빠름) */
  speed: number;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMs: 0,
  speed: 5,
  musicVolume: 1,
  sfxVolume: 0.7,
  difficulty: 'normal',
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
  };
}

let current: Settings = sanitizeSettings(readJSON(KEY));

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Readonly<Settings> {
  current = sanitizeSettings({ ...current, ...patch });
  writeJSON(KEY, current);
  return current;
}

export function resetSettings(): Readonly<Settings> {
  current = { ...DEFAULT_SETTINGS };
  writeJSON(KEY, current);
  return current;
}
