/**
 * 오프셋 보정: 메트로놈 박(beat)에 맞춰 사용자가 탭한 시각들로부터 평균 지연을 추정한다.
 * 결과 = (탭 시각 - 박 시각) 의 절사평균. 양수면 소리가 늦게 들리거나 늦게 치는 경향 → 판정 오프셋을 +로.
 * (블루투스 출력 지연과 사람의 탭 습관이 합쳐진 값이라 실제 플레이 감각에 그대로 쓸 수 있다.)
 */
export interface OffsetEstimate {
  offsetMs: number;
  sdMs: number;
  used: number;
}

export interface BeatPlan {
  /** 첫 박(카운트인 포함)의 오디오 시각, 박 간격(초) */
  start: number;
  period: number;
  /** 측정에 쓰는 박 번호 범위 [first, last] (앞쪽은 카운트인) */
  first: number;
  last: number;
}

export const MIN_VALID_TAPS = 8;

export function estimateOffset(taps: number[], plan: BeatPlan): OffsetEstimate | null {
  // 박마다 가장 가까운 탭 하나만 사용
  const byBeat = new Map<number, number>();
  for (const t of taps) {
    const k = Math.round((t - plan.start) / plan.period);
    if (k < plan.first || k > plan.last) continue;
    const diff = t - (plan.start + k * plan.period);
    if (Math.abs(diff) > plan.period * 0.5) continue;
    const prev = byBeat.get(k);
    if (prev === undefined || Math.abs(diff) < Math.abs(prev)) byBeat.set(k, diff);
  }
  const diffs = [...byBeat.values()].sort((a, b) => a - b);
  if (diffs.length < MIN_VALID_TAPS) return null;

  // 양끝 20% 절사
  const cut = Math.floor(diffs.length * 0.2);
  const mid = diffs.slice(cut, diffs.length - cut);
  const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
  const sd = Math.sqrt(mid.reduce((a, b) => a + (b - mean) ** 2, 0) / mid.length);
  return { offsetMs: Math.round(mean * 1000), sdMs: Math.round(sd * 1000), used: diffs.length };
}
