import { FFT } from './fft';

/** 분석 파라미터. 입력은 모노 PCM(보통 22~24kHz 로 디시메이션된 것)이다. */
export const FFT_SIZE = 1024;
export const HOP = 256;

/** 주파수 대역: 저음(킥/베이스) → 바깥 레인, 고음(하이햇/멜로디) → 안쪽 레인, 중음(스네어/보컬) → 아무 레인 */
export const BANDS = [
  { name: 'low', lo: 30, hi: 250, weight: 0.35 },
  { name: 'mid', lo: 250, hi: 2000, weight: 0.35 },
  { name: 'high', lo: 2000, hi: 10000, weight: 0.3 },
] as const;
export const BAND_COUNT = BANDS.length;

/**
 * 프레임 중심 시각에서 onset 시각으로 가는 보정(초): onset = 프레임 중심 - ONSET_LATENCY.
 * 합성 클릭 트랙으로 측정하면 검출 피크가 실제보다 평균 8ms 빠르게 나와 (+8ms) 보정한다.
 * (analysis.test.ts 의 "onset 시각 정확도" 테스트가 이 값을 검증한다.)
 */
export const ONSET_LATENCY = -0.008;

const GAIN = 100; // 로그 압축 이득: log(1 + GAIN * 진폭)

export interface Features {
  sampleRate: number;
  hopSec: number;
  frames: number;
  /** 대역별 spectral flux (대역 평균 = 1 로 정규화) */
  flux: Float32Array[];
  /** 대역별 로그 압축 에너지 (지속음 판별용) */
  energy: Float32Array[];
  /** 대역 가중합 onset 함수 (평균 ≈ 1) */
  onset: Float32Array;
}

/** 프레임 n 의 onset 시각(초) */
export function frameTime(f: Features, n: number): number {
  return (n * HOP + FFT_SIZE / 2) / f.sampleRate - ONSET_LATENCY;
}

export function extractFeatures(
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Features {
  const frames = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / HOP) + 1);
  const binHz = sampleRate / FFT_SIZE;
  const ranges = BANDS.map((b) => ({
    lo: Math.max(1, Math.ceil(b.lo / binHz)),
    hi: Math.min(FFT_SIZE / 2 - 1, Math.floor(Math.min(b.hi, sampleRate / 2 - binHz) / binHz)),
  }));
  const maxBin = Math.max(...ranges.map((r) => r.hi));

  const flux = BANDS.map(() => new Float32Array(frames));
  const energy = BANDS.map(() => new Float32Array(frames));

  const fft = new FFT(FFT_SIZE);
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const prev = new Float32Array(maxBin + 1);
  const magA = new Float32Array(maxBin + 1);
  const magB = new Float32Array(maxBin + 1);
  const scale = 1 / (FFT_SIZE / 4); // 정현파 진폭 A → |X| = A*N/4

  const accumulate = (n: number, cur: Float32Array) => {
    for (let b = 0; b < BAND_COUNT; b++) {
      const { lo, hi } = ranges[b];
      let fl = 0;
      let en = 0;
      for (let k = lo; k <= hi; k++) {
        const d = cur[k] - prev[k];
        if (d > 0) fl += d;
        en += cur[k];
      }
      const bins = hi - lo + 1;
      flux[b][n] = fl / bins;
      energy[b][n] = en / bins;
    }
    prev.set(cur);
  };

  // 실수 신호 2프레임을 복소 FFT 1번(실수부/허수부)으로 처리한다.
  let lastReport = 0;
  for (let n = 0; n < frames; n += 2) {
    const a = n * HOP;
    const hasB = n + 1 < frames;
    const bOff = (n + 1) * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = pcm[a + i] * win[i];
      im[i] = hasB ? pcm[bOff + i] * win[i] : 0;
    }
    fft.transform(re, im);
    for (let k = 0; k <= maxBin; k++) {
      const nk = (FFT_SIZE - k) & (FFT_SIZE - 1);
      const ar = (re[k] + re[nk]) * 0.5;
      const ai = (im[k] - im[nk]) * 0.5;
      const br = (im[k] + im[nk]) * 0.5;
      const bi = (re[nk] - re[k]) * 0.5;
      magA[k] = Math.log1p(GAIN * Math.sqrt(ar * ar + ai * ai) * scale);
      magB[k] = Math.log1p(GAIN * Math.sqrt(br * br + bi * bi) * scale);
    }
    accumulate(n, magA);
    if (hasB) accumulate(n + 1, magB);

    if (onProgress && n - lastReport > frames / 50) {
      lastReport = n;
      onProgress(n / frames);
    }
  }

  // 대역별 평균으로 정규화 → 가중합.
  // 거의 비어 있는 대역(다른 대역의 스펙트럼 누설뿐인 대역)이 평균 정규화로 과대 증폭되지 않도록
  // 가장 큰 대역 평균의 30% 를 하한으로 둔다.
  const means = flux.map((fl) => {
    let sum = 0;
    for (let n = 0; n < frames; n++) sum += fl[n];
    return sum / Math.max(1, frames);
  });
  const floor = 0.3 * Math.max(...means);
  const onset = new Float32Array(frames);
  for (let b = 0; b < BAND_COUNT; b++) {
    const mean = Math.max(means[b], floor);
    const inv = mean > 1e-9 ? 1 / mean : 0;
    for (let n = 0; n < frames; n++) {
      flux[b][n] *= inv;
      onset[n] += BANDS[b].weight * flux[b][n];
    }
  }
  onProgress?.(1);
  return { sampleRate, hopSec: HOP / sampleRate, frames, flux, energy, onset };
}
