/** 분석 테스트용 합성 신호 (정답 시각을 알고 있다). */
export const SR = 22050;

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/** 킥: 60Hz 급감쇠 사인 (저음 대역) */
export function addKick(pcm: Float32Array, t: number, amp = 0.8): void {
  const s0 = Math.round(t * SR);
  for (let i = 0; i < 0.25 * SR && s0 + i < pcm.length; i++) {
    const x = i / SR;
    pcm[s0 + i] += Math.sin(2 * Math.PI * (45 * x + (80 / 25) * (1 - Math.exp(-25 * x)))) * Math.exp(-x * 14) * amp;
  }
}

/** 하이햇: 짧은 고음 노이즈 (고음 대역) */
export function addHat(pcm: Float32Array, t: number, amp = 0.5, seed = 7): void {
  const r = rng(seed + Math.round(t * 1000));
  const s0 = Math.round(t * SR);
  let prev = 0;
  for (let i = 0; i < 0.05 * SR && s0 + i < pcm.length; i++) {
    const n = r();
    const hp = n - prev; // 간단한 하이패스
    prev = n;
    pcm[s0 + i] += hp * 0.5 * Math.exp((-i / SR) * 90) * amp;
  }
}

/** 지속음: 어택 후 길이 동안 유지되는 사인 (중음 대역) */
export function addTone(pcm: Float32Array, t: number, dur: number, freq = 600, amp = 0.4): void {
  const s0 = Math.round(t * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s0 + i < pcm.length; i++) {
    const x = i / SR;
    const env = Math.min(1, x / 0.01) * Math.min(1, (dur - x) / 0.02);
    pcm[s0 + i] += Math.sin(2 * Math.PI * freq * x) * env * amp;
  }
}

/** 킥(매 박) + 하이햇(엇박) 드럼 루프. 정답 박 시각 = offset + k*60/bpm */
export function drumLoop(bpm: number, offset: number, seconds: number): Float32Array {
  const pcm = silence(seconds);
  const beat = 60 / bpm;
  for (let t = offset, k = 0; t < seconds - 0.3; t += beat, k++) {
    addKick(pcm, t);
    addHat(pcm, t + beat / 2);
  }
  return pcm;
}
