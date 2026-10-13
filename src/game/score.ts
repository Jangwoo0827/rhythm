import type { Judgement, Rank, Result } from './types';

/** 정확도 가중치 */
const ACCURACY_WEIGHT: Record<Judgement, number> = { perfect: 1, great: 0.75, good: 0.4, miss: 0 };

/** 점수 = 정확도 90만 + 최대 콤보 비율 10만 (전부 퍼펙트·풀콤보면 1,000,000) */
export class ScoreKeeper {
  readonly counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  combo = 0;
  maxCombo = 0;
  private weightSum = 0;

  constructor(readonly total: number) {}

  add(j: Judgement): void {
    this.counts[j]++;
    this.weightSum += ACCURACY_WEIGHT[j];
    if (j === 'miss') this.combo = 0;
    else this.maxCombo = Math.max(this.maxCombo, ++this.combo);
  }

  /** 이미 센 판정을 Miss 로 바꾼다 (롱노트를 중간에 놓쳤을 때). */
  demoteToMiss(from: Judgement): void {
    this.counts[from]--;
    this.counts.miss++;
    this.weightSum -= ACCURACY_WEIGHT[from];
    this.combo = 0;
  }

  get score(): number {
    if (this.total === 0) return 0;
    return Math.round((900000 * this.weightSum + 100000 * this.maxCombo) / this.total);
  }

  /** 지금까지 처리한 노트 기준 정확도(%). 진행 중 HUD 용. */
  get accuracy(): number {
    const judged = this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss;
    return judged === 0 ? 100 : (this.weightSum / judged) * 100;
  }

  result(): Result {
    const acc = this.total === 0 ? 0 : (this.weightSum / this.total) * 100;
    return {
      score: this.score,
      accuracy: acc,
      rank: rankOf(acc),
      maxCombo: this.maxCombo,
      total: this.total,
      counts: { ...this.counts },
    };
  }
}

export function rankOf(accuracy: number): Rank {
  if (accuracy >= 95) return 'S';
  if (accuracy >= 85) return 'A';
  if (accuracy >= 70) return 'B';
  return 'C';
}
