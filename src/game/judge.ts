import type { Judgement } from './types';

/** 판정 윈도우(±초). */
export const WINDOW = {
  perfect: 0.05,
  great: 0.1,
  good: 0.15,
} as const;

/** 롱노트 끝에서 이 시간 이내에 손을 떼면 성공으로 인정 */
export const HOLD_RELEASE_TOLERANCE = 0.15;

export function judgeDiff(absDiff: number): Judgement {
  if (absDiff <= WINDOW.perfect) return 'perfect';
  if (absDiff <= WINDOW.great) return 'great';
  if (absDiff <= WINDOW.good) return 'good';
  return 'miss';
}
