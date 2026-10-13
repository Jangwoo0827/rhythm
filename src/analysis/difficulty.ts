import type { Difficulty } from '../game/types';

export interface DifficultyParams {
  label: string;
  /** onset 후보 임계값 = 지역 평균 * alpha + delta (낮을수록 후보가 많다) */
  alpha: number;
  delta: number;
  /** 이벤트(동시 노트 묶음) 사이 최소 간격(초) */
  minGap: number;
  /** 임의의 1초 구간에 허용되는 최대 이벤트 수 */
  windowCap: number;
  /** 한 시각에 동시에 놓을 수 있는 노트 수 / 롱노트를 누른 채 포함해 동시에 눌러야 하는 최대 손가락 수 */
  maxChord: number;
  maxFingers: number;
  /** 박자 격자 분할 (한 박을 몇 칸으로 나눠 스냅할지: 2=8분, 4=16분) */
  subdiv: number;
  /** 같은 레인에 연속으로 노트가 올 수 있는 최소 간격(초) */
  sameLaneGap: number;
  /** 롱노트 최소 길이(초) / 전체 노트 중 롱노트 최대 비율 */
  holdMin: number;
  holdFraction: number;
  /** 보조 대역이 동시 노트가 되려면 필요한 onset 기여 비율 */
  chordShare: number;
}

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  easy: {
    label: '쉬움', alpha: 1.7, delta: 0.25, minGap: 0.32, windowCap: 3, maxChord: 1, maxFingers: 2,
    subdiv: 2, sameLaneGap: 0.4, holdMin: 0.6, holdFraction: 0.15, chordShare: 0.5,
  },
  normal: {
    label: '보통', alpha: 1.4, delta: 0.15, minGap: 0.2, windowCap: 5, maxChord: 2, maxFingers: 3,
    subdiv: 4, sameLaneGap: 0.25, holdMin: 0.45, holdFraction: 0.2, chordShare: 0.4,
  },
  hard: {
    label: '어려움', alpha: 1.15, delta: 0.05, minGap: 0.12, windowCap: 8, maxChord: 3, maxFingers: 4,
    subdiv: 4, sameLaneGap: 0.14, holdMin: 0.35, holdFraction: 0.25, chordShare: 0.4,
  },
};
