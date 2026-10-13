/**
 * STEP 1 용 테스트 사운드: 샘플 맵(120 BPM, 16마디)에 맞춘 백킹 트랙과 히트음을 코드로 합성한다.
 * 결과는 일반 AudioBuffer 이므로 STEP 2 에서 decodeAudioData 결과로 그대로 대체된다.
 */
export const SAMPLE_BPM = 120;
export const SAMPLE_BEATS = 64;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 * 2 - 1;
  };
}

export function createBackingTrack(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const beat = 60 / SAMPLE_BPM;
  const seconds = SAMPLE_BEATS * beat + 1;
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * sr), sr);
  const out = buffer.getChannelData(0);
  const rng = makeRng(1234);

  /** startBeat 에서 length 초 동안 fn(t초) 을 더한다 */
  const add = (startBeat: number, length: number, fn: (t: number) => number) => {
    const s0 = Math.round(startBeat * beat * sr);
    const n = Math.min(Math.round(length * sr), out.length - s0);
    for (let i = 0; i < n; i++) out[s0 + i] += fn(i / sr);
  };

  // 코드 진행: Am - F - C - G
  const roots = [55, 43.65, 65.41, 49];
  const arps = [
    [440, 523.25, 659.25],
    [349.23, 440, 523.25],
    [523.25, 659.25, 783.99],
    [392, 493.88, 587.33],
  ];

  for (let b = 0; b < SAMPLE_BEATS; b++) {
    const bar = Math.floor(b / 4);
    const chord = bar % 4;

    // 킥: 매 박
    add(b, 0.28, (t) => {
      // 주파수 f(t)=45+110e^(-28t) Hz 를 적분한 위상
      const phase = 45 * t + (110 / 28) * (1 - Math.exp(-28 * t));
      return Math.sin(2 * Math.PI * phase) * Math.exp(-t * 11) * 0.9;
    });
    // 스네어/클랩: 2, 4박
    if (b % 2 === 1 && bar >= 1) {
      add(b, 0.2, (t) => (rng() * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.3) * Math.exp(-t * 20));
    }
    // 하이햇: 엇박(+0.5)
    add(b + 0.5, 0.06, (t) => rng() * 0.22 * Math.exp(-t * 90));
    // 베이스: 2마디째부터
    if (bar >= 1) {
      for (const off of [0, 0.75, 1.5, 2.5]) {
        add(b + off, 0.3, (t) => {
          const f = roots[chord];
          return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 7) * 0.35;
        });
      }
    }
    // 리드 아르페지오: 5마디째부터, 8분음표
    if (bar >= 4) {
      for (let h = 0; h < 2; h++) {
        const freq = arps[chord][(b * 2 + h) % 3];
        add(b + h * 0.5, 0.22, (t) => {
          const ph = (t * freq) % 1;
          const tri = 4 * Math.abs(ph - 0.5) - 1;
          return tri * Math.exp(-t * 9) * 0.16;
        });
      }
    }
  }

  // 소프트 클리핑 + 정규화
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.tanh(out[i] * 1.2);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const g = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return buffer;
}

/** 짧고 맑은 틱 소리 */
export function createHitSound(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(0.07 * sr), sr);
  const d = buffer.getChannelData(0);
  const rng = makeRng(99);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = (Math.sin(2 * Math.PI * 1800 * t) * 0.6 + rng() * 0.25) * Math.exp(-t * 70) * 0.8;
  }
  return buffer;
}
