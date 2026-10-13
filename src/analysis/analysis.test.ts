import { describe, expect, it } from 'vitest';
import { FFT } from './fft';
import { analyze } from './pipeline';
import { DIFFICULTY_PARAMS } from './difficulty';
import { extractFeatures, frameTime } from './spectral';
import { SR, addHat, addKick, addTone, drumLoop, silence } from './testSignals';
import type { GameMap } from '../game/types';

const META = { songHash: 'test', title: 'test' };

describe('FFT', () => {
  it('매칭: 정현파는 해당 bin 에 피크를 만든다', () => {
    const n = 256;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 10 * i) / n);
    fft.transform(re, im);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    expect(mag(10)).toBeCloseTo(n / 2, 3);
    expect(mag(11)).toBeLessThan(1e-6);
    expect(mag(50)).toBeLessThan(1e-6);
  });
});

describe('onset 시각 정확도', () => {
  it('클릭의 검출 시각이 정답과 15ms 이내(평균)로 일치한다', () => {
    const times = [1, 1.7, 2.45, 3.1, 4.0, 4.65, 5.5, 6.2, 7.0, 7.8];
    const pcm = silence(9);
    for (const t of times) addKick(pcm, t);
    const f = extractFeatures(pcm, SR);
    // 임계값 없이 순수 피크 위치만 본다: 정답 주변 ±80ms 에서 onset 함수 최대 프레임
    const errs = times.map((t) => {
      let best = 0, bestV = -1;
      for (let n = 0; n < f.frames; n++) {
        const ft = frameTime(f, n);
        if (Math.abs(ft - t) < 0.08 && f.onset[n] > bestV) { bestV = f.onset[n]; best = n; }
      }
      return frameTime(f, best) - t;
    });
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log('onset 오차(ms):', errs.map((e) => Math.round(e * 1000)).join(' '), '평균', Math.round(mean * 1000));
    expect(Math.abs(mean)).toBeLessThan(0.015);
  });
});

describe('BPM / 박자 추정', () => {
  for (const [bpm, offset] of [[100, 0.31], [128, 0.12], [140, 0.4], [87, 0.2]] as const) {
    it(`${bpm} BPM, offset ${offset}s`, () => {
      const res = analyze(drumLoop(bpm, offset, 40), SR, META);
      console.log(`  → 추정 ${res.bpm} BPM, offset ${res.offset.toFixed(3)}, 신뢰도 ${res.confidence.toFixed(2)}`);
      expect(Math.abs(res.bpm - bpm)).toBeLessThan(0.6);
      const period = 60 / bpm;
      const d = (((res.offset - offset) % period) + period) % period;
      expect(Math.min(d, period - d)).toBeLessThan(0.03);
      expect(res.confidence).toBeGreaterThan(1.25);
    });
  }

  it('박자 없는 무작위 클릭은 격자에 스냅하지 않고 원래 시각을 유지한다', () => {
    const pcm = silence(40);
    let s = 12345;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let t = 1; t < 38; t += 0.25 + r() * 0.9) addKick(pcm, t);
    const res = analyze(pcm, SR, META);
    const step = 60 / res.bpm / 4;
    const notes = res.maps.normal.notes;
    const onGrid = notes.filter((n) => {
      const k = (n.t - res.offset) / step;
      return Math.abs(k - Math.round(k)) * step < 0.002;
    }).length;
    console.log(`  → 무작위: ${res.bpm} BPM, 신뢰도 ${res.confidence.toFixed(2)}, 격자 위 노트 ${onGrid}/${notes.length}`);
    expect(notes.length).toBeGreaterThan(10);
    expect(onGrid / notes.length).toBeLessThan(0.3);
  });
});

function checkConstraints(map: GameMap, difficulty: 'easy' | 'normal' | 'hard') {
  const p = DIFFICULTY_PARAMS[difficulty];
  const notes = map.notes;
  for (let i = 1; i < notes.length; i++) expect(notes[i].t).toBeGreaterThanOrEqual(notes[i - 1].t);
  for (const n of notes) {
    expect(n.lane).toBeGreaterThanOrEqual(0);
    expect(n.lane).toBeLessThanOrEqual(3);
    expect(n.dur === 0 || n.dur >= p.holdMin - 0.01).toBe(true);
  }
  // 같은 레인: 이전 노트(롱노트면 끝)와 겹치지 않는다
  const lastEnd = [-1, -1, -1, -1];
  for (const n of notes) {
    expect(n.t).toBeGreaterThanOrEqual(lastEnd[n.lane] - 1e-6);
    lastEnd[n.lane] = n.t + n.dur;
  }
  // 동시에 눌러야 하는 손가락 수
  for (const n of notes) {
    let fingers = 0;
    for (const m of notes) if (m.t <= n.t + 1e-6 && m.t + m.dur > n.t + 1e-6) fingers++;
    expect(fingers).toBeLessThanOrEqual(p.maxFingers);
  }
  // 1초 구간 최대 이벤트(시각 묶음) 수
  const evTimes = [...new Set(notes.map((n) => n.t))];
  for (const t of evTimes) {
    const c = evTimes.filter((x) => x >= t && x < t + 1).length;
    expect(c).toBeLessThanOrEqual(p.windowCap + 1);
  }
}

describe('맵 생성', () => {
  const pcm = drumLoop(120, 0.2, 40);
  const res = analyze(pcm, SR, META);

  it('난이도가 올라갈수록 노트가 늘어난다', () => {
    const c = (['easy', 'normal', 'hard'] as const).map((d) => res.maps[d].notes.length);
    console.log('  노트 수 easy/normal/hard:', c.join(' / '), '(40초, 킥 4/s... 정답 후보 약 160)');
    expect(c[0]).toBeGreaterThan(10);
    expect(c[0]).toBeLessThan(c[1]);
    expect(c[1]).toBeLessThanOrEqual(c[2]);
  });

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: 레인/간격/동시 입력/밀도 제약을 지킨다`, () => checkConstraints(res.maps[d], d));
  }

  it('박자 격자에 스냅된다 (normal)', () => {
    const beat = 60 / res.bpm;
    const step = beat / 4;
    for (const n of res.maps.normal.notes) {
      const k = (n.t - res.offset) / step;
      expect(Math.abs(k - Math.round(k)) * step).toBeLessThan(0.002);
    }
  });

  it('저음(킥)은 바깥 레인, 고음(하이햇)은 안쪽 레인에 배정된다', () => {
    const p = silence(30);
    // 킥과 하이햇을 서로 다른 시각(엇박)에 → 박자 120 BPM
    for (let t = 1; t < 28; t += 0.5) { addKick(p, t); addHat(p, t + 0.25); }
    const r = analyze(p, SR, META);
    const notes = r.maps.normal.notes;
    let kickOuter = 0, kickTotal = 0, hatInner = 0, hatTotal = 0;
    for (const n of notes) {
      const phase = ((n.t - 1) % 0.5 + 0.5) % 0.5;
      const isKick = phase < 0.06 || phase > 0.44;
      if (isKick) { kickTotal++; if (n.lane === 0 || n.lane === 3) kickOuter++; }
      else { hatTotal++; if (n.lane === 1 || n.lane === 2) hatInner++; }
    }
    console.log(`  킥 ${kickOuter}/${kickTotal} 바깥, 하이햇 ${hatInner}/${hatTotal} 안쪽`);
    expect(kickTotal).toBeGreaterThan(10);
    expect(hatTotal).toBeGreaterThan(5);
    expect(kickOuter / kickTotal).toBeGreaterThan(0.85);
    expect(hatInner / hatTotal).toBeGreaterThan(0.85);
  });

  it('지속음은 롱노트가 되고, 타악기는 탭으로 남는다', () => {
    const p = silence(30);
    const held: number[] = [];
    for (let t = 2, k = 0; t < 26; t += 3, k++) { addTone(p, t, 1.5, 500 + 100 * (k % 3)); held.push(t); }
    for (let t = 3.6; t < 26; t += 3) addKick(p, t);
    const r = analyze(p, SR, META);
    const notes = r.maps.normal.notes;
    const holds = notes.filter((n) => n.dur > 0);
    console.log(`  롱노트 ${holds.length}개: 길이`, holds.map((h) => h.dur.toFixed(2)).join(' '));
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const h of holds) {
      expect(h.dur).toBeGreaterThan(0.9);
      expect(h.dur).toBeLessThan(2.1);
    }
    // 롱노트 시작은 정답 톤 시작과 일치
    for (const h of holds) expect(Math.min(...held.map((t) => Math.abs(t - h.t)))).toBeLessThan(0.08);
  });

  it('같은 입력은 항상 같은 맵을 만든다', () => {
    const again = analyze(pcm, SR, META);
    expect(again.maps.normal.notes).toEqual(res.maps.normal.notes);
  });

  it('무음/너무 짧은 입력도 오류 없이 빈 맵을 만든다', () => {
    expect(analyze(silence(3), SR, META).maps.easy.notes).toEqual([]);
    expect(analyze(silence(20), SR, META).maps.hard.notes).toEqual([]);
  });
});
