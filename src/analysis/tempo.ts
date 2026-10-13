import { frameTime, type Features } from './spectral';

export interface Tempo {
  bpm: number;
  /** 첫 박(beat) 시각 (0 ≤ offset < 박 길이) */
  offset: number;
  /** 박자 격자가 onset 과 얼마나 잘 맞는지 (참고용 진단값. 스냅 여부는 mapGen 의 격자 잔차로 결정) */
  confidence: number;
}

const BPM_MIN = 70;
const BPM_MAX = 180;
const PRIOR_CENTER = 120;
const PRIOR_SIGMA_OCT = 0.7;

/** onset 함수에서 BPM 과 박자 위상을 추정한다: 자기상관으로 후보 → 콤(comb) 필터로 정밀화 */
export function estimateTempo(f: Features): Tempo | null {
  const n = f.frames;
  const hop = f.hopSec;
  if (n * hop < 8) return null;

  const s = peakEnvelope(f.onset, Math.round(0.5 / hop));

  // 자기상관
  const lagMin = Math.floor(60 / BPM_MAX / hop);
  const lagMax = Math.ceil(60 / BPM_MIN / hop);
  const maxNeeded = lagMax * 2 + 2;
  const r = new Float64Array(maxNeeded + 1);
  for (let l = Math.max(1, Math.floor(lagMin / 2)); l <= maxNeeded; l++) {
    let sum = 0;
    for (let i = 0; i + l < n; i++) sum += s[i] * s[i + l];
    r[l] = sum / (n - l);
  }

  let best = -1;
  let bestScore = 0;
  const scoreAt = (l: number) => {
    const bpm = 60 / (l * hop);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_CENTER) / PRIOR_SIGMA_OCT) ** 2);
    return (r[l] + 0.5 * r[2 * l] + 0.5 * r[Math.round(l / 2)]) * prior;
  };
  for (let l = lagMin; l <= lagMax; l++) {
    const sc = scoreAt(l);
    if (sc > bestScore) { bestScore = sc; best = l; }
  }
  if (best < 0) return null;

  // 포물선 보간으로 서브프레임 지연 추정
  let lag = best;
  if (best > lagMin && best < lagMax) {
    const a = scoreAt(best - 1), b = scoreAt(best), c = scoreAt(best + 1);
    const den = a - 2 * b + c;
    if (den < 0) lag = best + 0.5 * (a - c) / den;
  }
  const bpm0 = 60 / (lag * hop);

  // 콤 필터로 BPM·위상 정밀화
  const t0 = frameTime(f, 0);
  const duration = frameTime(f, n - 1);
  const at = (t: number) => {
    const x = (t - t0) / hop;
    if (x < 0 || x >= n - 1) return 0;
    const i = Math.floor(x);
    const fr = x - i;
    return s[i] * (1 - fr) + s[i + 1] * fr;
  };
  const PHASES = 32;
  let bestBpm = bpm0;
  let bestPhase = 0;
  let bestComb = -1;
  let bestPhaseScores: number[] = [];
  for (let bpm = bpm0 * 0.96; bpm <= bpm0 * 1.04; bpm += 0.05) {
    const period = 60 / bpm;
    const scores: number[] = [];
    for (let ph = 0; ph < PHASES; ph++) {
      let sum = 0;
      let cnt = 0;
      for (let t = (ph * period) / PHASES; t < duration; t += period) { sum += at(t); cnt++; }
      scores.push(sum / Math.max(1, cnt));
    }
    const m = Math.max(...scores);
    if (m > bestComb) {
      bestComb = m;
      bestBpm = bpm;
      bestPhase = scores.indexOf(m);
      bestPhaseScores = scores;
    }
  }

  // 위상 미세 조정 (최적 위상 주변 ±1 칸을 16등분)
  const period = 60 / bestBpm;
  let phase = (bestPhase * period) / PHASES;
  let phaseBest = -1;
  for (let i = -16; i <= 16; i++) {
    const ph = ((bestPhase * period) / PHASES) + (i * period) / (PHASES * 16);
    let sum = 0;
    let cnt = 0;
    for (let t = ph; t < duration; t += period) { if (t >= 0) { sum += at(t); cnt++; } }
    const sc = sum / Math.max(1, cnt);
    if (sc > phaseBest) { phaseBest = sc; phase = ph; }
  }
  phase = ((phase % period) + period) % period;

  const meanPhase = bestPhaseScores.reduce((a, b) => a + b, 0) / bestPhaseScores.length;
  return {
    bpm: Math.round(bestBpm * 100) / 100,
    offset: phase,
    confidence: meanPhase > 1e-9 ? bestComb / meanPhase : 0,
  };
}

/** 지역 평균을 빼고 음수를 버린 뒤 3탭 평활화 → 박자 추정용 피크 강조 */
function peakEnvelope(o: Float32Array, halfWin: number): Float32Array {
  const n = o.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - halfWin);
    const b = Math.min(n, i + halfWin + 1);
    d[i] = Math.max(0, o[i] - (prefix[b] - prefix[a]) / (b - a));
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.25 * (d[Math.max(0, i - 1)] + d[Math.min(n - 1, i + 1)]) + 0.5 * d[i];
  }
  return out;
}
