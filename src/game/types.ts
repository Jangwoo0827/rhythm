export type Judgement = 'perfect' | 'great' | 'good' | 'miss';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Rank = 'S' | 'A' | 'B' | 'C';

export const LANES = 4;

/** t: 초 단위 노트 시각(곡 시작 기준), dur: 롱노트 길이(초). 탭 노트는 0 */
export interface MapNote {
  t: number;
  lane: number;
  dur: number;
}

/** 맵 JSON 구조 (STEP 3/5 에서 그대로 생성·저장되는 포맷) */
export interface GameMap {
  songHash: string;
  title: string;
  bpm: number;
  /** 첫 박(beat) 시각(초). 박자선 표시용 (선택) */
  offset?: number;
  difficulty: Difficulty;
  notes: MapNote[];
}

export interface Result {
  score: number;
  accuracy: number; // 0..100
  rank: Rank;
  maxCombo: number;
  total: number;
  counts: Record<Judgement, number>;
  /** 평균 타이밍(ms, +면 늦게 침)과 그 계산에 쓰인 타격 수 */
  avgTimingMs: number;
  timedHits: number;
}
