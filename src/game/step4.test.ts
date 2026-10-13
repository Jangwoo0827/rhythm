import { beforeEach, describe, expect, it } from 'vitest';
import { estimateOffset, type BeatPlan } from './offsetEstimate';
import { MAX_SONGS, getLibrary, loadAnalysis, recordPlay, removeSong, saveAnalysis, type CachedAnalysis } from './library';
import { DEFAULT_SETTINGS, approachFor, sanitizeSettings } from './settings';
import type { Difficulty, GameMap, Result } from './types';

class FakeStorage implements Storage {
  data = new Map<string, string>();
  /** 총 글자 수 제한 (용량 초과 시뮬레이션) */
  quota = Infinity;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) {
    let total = v.length;
    for (const [kk, vv] of this.data) if (kk !== k) total += vv.length;
    if (total > this.quota) throw new DOMException('quota', 'QuotaExceededError');
    this.data.set(k, v);
  }
}
let fake: FakeStorage;
beforeEach(() => {
  fake = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
});

const result = (score: number, rank: Result['rank'] = 'A'): Result => ({
  score, accuracy: 90, rank, maxCombo: 50, total: 100,
  counts: { perfect: 80, great: 10, good: 5, miss: 5 }, avgTimingMs: 0, timedHits: 95,
});
const meta = (hash: string) => ({ songHash: hash, title: `song ${hash}`, bpm: 120, duration: 100 });

function fakeAnalysis(hash: string, n = 300): CachedAnalysis {
  const maps = {} as Record<Difficulty, GameMap>;
  for (const d of ['easy', 'normal', 'hard'] as const) {
    maps[d] = {
      songHash: hash, title: `song ${hash}`, bpm: 120.5, offset: 0.123, difficulty: d,
      notes: Array.from({ length: n }, (_, i) => ({ t: 1 + i * 0.25, lane: i % 4, dur: i % 10 === 0 ? 0.5 : 0 })),
    };
  }
  return { bpm: 120.5, offset: 0.123, maps };
}

describe('오프셋 추정', () => {
  const plan: BeatPlan = { start: 10, period: 0.6, first: 4, last: 19 };
  const taps = (delay: number, jitter = 0) =>
    Array.from({ length: 20 }, (_, k) => 10 + k * 0.6 + delay + Math.sin(k * 12.9898) * jitter);

  it('일정한 지연(+80ms)을 정확히 찾는다', () => {
    const e = estimateOffset(taps(0.08), plan)!;
    expect(e.offsetMs).toBe(80);
    expect(e.used).toBe(16);
  });
  it('음수(일찍 침, -35ms)도 찾는다', () => {
    expect(estimateOffset(taps(-0.035), plan)!.offsetMs).toBe(-35);
  });
  it('지터가 있어도 평균 근처로 수렴하고, 극단값(실수 탭)에 흔들리지 않는다', () => {
    const t = taps(0.12, 0.02);
    t[8] += 0.25; // 한 박 놓친 큰 오차
    t[12] -= 0.22;
    const e = estimateOffset(t, plan)!;
    expect(Math.abs(e.offsetMs - 120)).toBeLessThan(12);
  });
  it('카운트인 구간의 탭은 무시한다', () => {
    const t = taps(0.05).map((x, k) => (k < 4 ? x + 0.2 : x));
    expect(estimateOffset(t, plan)!.offsetMs).toBe(50);
  });
  it('유효 탭이 부족하면 null', () => {
    expect(estimateOffset(taps(0.05).slice(0, 10), plan)).toBeNull();
    expect(estimateOffset([], plan)).toBeNull();
  });
  it('한 박에 여러 번 탭해도 가장 가까운 탭 하나만 센다', () => {
    const t = [...taps(0.05), ...taps(0.05).map((x) => x + 0.2)];
    const e = estimateOffset(t, plan)!;
    expect(e.used).toBe(16);
    expect(e.offsetMs).toBe(50);
  });
});

describe('설정', () => {
  it('깨진/범위 밖 값을 안전한 값으로 정리한다', () => {
    const s = sanitizeSettings({ offsetMs: 9999, speed: 'x', musicVolume: -3, sfxVolume: 7, difficulty: 'insane' });
    expect(s.offsetMs).toBe(300);
    expect(s.speed).toBe(DEFAULT_SETTINGS.speed);
    expect(s.musicVolume).toBe(0);
    expect(s.sfxVolume).toBe(1);
    expect(s.difficulty).toBe('normal');
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });
  it('노트 속도 5 = 1.4초이고 빠를수록 짧다', () => {
    expect(approachFor(5)).toBeCloseTo(1.4);
    expect(approachFor(10)).toBeLessThan(approachFor(5));
    expect(approachFor(1)).toBeGreaterThan(approachFor(5));
  });
});

describe('곡 목록', () => {
  it('플레이를 기록하고 최고 기록은 점수가 높을 때만 갱신한다', () => {
    expect(recordPlay(meta('a'), 'normal', result(500000), 1000).isNewBest).toBe(true);
    expect(recordPlay(meta('a'), 'normal', result(400000), 2000).isNewBest).toBe(false);
    expect(recordPlay(meta('a'), 'hard', result(100000), 3000).isNewBest).toBe(true);
    const e = getLibrary()[0];
    expect(e.plays).toBe(3);
    expect(e.best.normal!.score).toBe(500000);
    expect(e.best.hard!.score).toBe(100000);
    expect(e.best.easy).toBeUndefined();
  });
  it('최근 플레이한 순으로 정렬하고 MAX_SONGS 를 넘으면 오래된 곡과 캐시를 지운다', () => {
    for (let i = 0; i < MAX_SONGS + 3; i++) {
      saveAnalysis(`h${i}`, `t${i}`, fakeAnalysis(`h${i}`, 5));
      recordPlay(meta(`h${i}`), 'easy', result(1000 + i), 1000 + i);
    }
    const lib = getLibrary();
    expect(lib).toHaveLength(MAX_SONGS);
    expect(lib[0].songHash).toBe(`h${MAX_SONGS + 2}`);
    expect(lib.some((e) => e.songHash === 'h0')).toBe(false);
    expect(loadAnalysis('h0')).toBeNull();
  });
  it('곡 삭제는 기록과 캐시를 함께 지운다', () => {
    saveAnalysis('x', 't', fakeAnalysis('x', 5));
    recordPlay(meta('x'), 'easy', result(1));
    removeSong('x');
    expect(getLibrary()).toHaveLength(0);
    expect(loadAnalysis('x')).toBeNull();
  });
  it('저장소가 깨져 있어도 빈 목록을 돌려준다', () => {
    fake.setItem('rhythm.library.v1', '{not json');
    expect(getLibrary()).toEqual([]);
    fake.setItem('rhythm.library.v1', '{"a":1}');
    expect(getLibrary()).toEqual([]);
  });
});

describe('맵 캐시', () => {
  it('저장 → 불러오기가 맵을 그대로 복원한다', () => {
    const a = fakeAnalysis('abc', 400);
    expect(saveAnalysis('abc', 'song abc', a)).toBe(true);
    const back = loadAnalysis('abc')!;
    expect(back.bpm).toBe(120.5);
    expect(back.offset).toBe(0.123);
    for (const d of ['easy', 'normal', 'hard'] as const) {
      expect(back.maps[d].notes).toEqual(a.maps[d].notes);
      expect(back.maps[d].difficulty).toBe(d);
      expect(back.maps[d].songHash).toBe('abc');
    }
  });
  it('용량이 부족하면 오래된 캐시를 지워 자리를 만든다', () => {
    saveAnalysis('probe', 't', fakeAnalysis('probe', 400));
    const one = fake.getItem('rhythm.maps.v1.probe')!.length;
    fake.clear();
    fake.quota = one * 3; // 2곡 남짓만 들어감
    for (let i = 0; i < 6; i++) saveAnalysis(`s${i}`, `t${i}`, fakeAnalysis(`s${i}`, 400));
    expect(loadAnalysis('s5')).not.toBeNull(); // 최신은 항상 저장
    expect(loadAnalysis('s0')).toBeNull(); // 오래된 것은 밀려남
  });
  it('한 곡도 못 담을 만큼 작은 용량이면 false 를 반환하고 죽지 않는다', () => {
    fake.quota = 10;
    expect(saveAnalysis('z', 't', fakeAnalysis('z', 50))).toBe(false);
  });
  it('localStorage 가 아예 없어도 동작한다', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    expect(getLibrary()).toEqual([]);
    expect(loadAnalysis('x')).toBeNull();
    expect(() => recordPlay(meta('x'), 'easy', result(1))).not.toThrow();
  });
});
