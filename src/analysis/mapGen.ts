import type { Difficulty, GameMap, MapNote } from '../game/types';
import { DIFFICULTY_PARAMS, DIFFICULTIES, type DifficultyParams } from './difficulty';
import { BAND_COUNT, BANDS, frameTime, type Features } from './spectral';
import type { Tempo } from './tempo';

/** 박자 격자 스냅 허용 이동량(초). 이보다 멀리 떨어진 onset 은 원래 시각을 유지한다. */
const SNAP_MAX = 0.045;
/**
 * onset 들이 격자에 실제로 붙어 있는지 판단하는 기준: 격자까지 평균 거리가
 * 무작위일 때의 기대값(step/4)의 이 비율 이하일 때만 스냅한다.
 */
const SNAP_FIT = 0.6;
const HOLD_MAX = 3.0;
const HOLD_RELEASE_GAP = 0.12;

interface Candidate {
  n: number;
  /** 스냅 전/후 시각 */
  tRaw: number;
  t: number;
  strength: number;
  /** 밴드별 onset 기여 비율(합 1) */
  share: number[];
}

interface Event extends Candidate {
  /** 기여 비율이 큰 순서의 대역 인덱스 */
  bands: number[];
  holdDur: number;
}

export interface MapMeta { songHash: string; title: string }

export function generateMaps(
  f: Features,
  tempo: Tempo | null,
  meta: MapMeta,
): Record<Difficulty, GameMap> {
  const maps = {} as Record<Difficulty, GameMap>;
  for (const d of DIFFICULTIES) maps[d] = buildMap(f, tempo, meta, d, DIFFICULTY_PARAMS[d]);
  return maps;
}

export function buildMap(
  f: Features,
  tempo: Tempo | null,
  meta: MapMeta,
  difficulty: Difficulty,
  p: DifficultyParams,
): GameMap {
  const cands = pickCandidates(f, p);
  const step = tempo ? 60 / tempo.bpm / p.subdiv : 0;
  const snapOn = !!tempo && fitsGrid(cands, tempo.offset, step);
  const snap = (t: number): number => {
    if (!snapOn || !tempo) return t;
    const s = tempo.offset + Math.round((t - tempo.offset) / step) * step;
    return Math.abs(s - t) <= SNAP_MAX && s >= 0 ? s : t;
  };
  for (const c of cands) c.t = snap(c.tRaw);

  let events = select(cands, f, p);
  detectHolds(events, f, p, snap);
  pruneHolds(events, p);
  events = events.filter((e) => e.t >= 0.3);

  const notes = assignLanes(events, p, makeRng(`${meta.songHash}:${difficulty}`));
  return {
    songHash: meta.songHash,
    title: meta.title,
    bpm: tempo ? tempo.bpm : 0,
    ...(tempo ? { offset: round3(tempo.offset) } : {}),
    difficulty,
    notes,
  };
}

// ─── 1. onset 후보: 적응형 임계값 + 지역 최대값 ──────────────────────────────
function pickCandidates(f: Features, p: DifficultyParams): Candidate[] {
  const o = f.onset;
  const n = o.length;
  const half = Math.max(1, Math.round(0.4 / f.hopSec));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  const radius = Math.max(1, Math.round(0.035 / f.hopSec));

  const out: Candidate[] = [];
  for (let i = radius; i < n - radius; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    const thr = mean * p.alpha + p.delta;
    const v = o[i];
    if (v <= thr) continue;
    let isMax = true;
    for (let k = 1; k <= radius; k++) {
      if (o[i - k] > v || o[i + k] >= v) { isMax = false; break; }
    }
    if (!isMax) continue;

    const share: number[] = [];
    let total = 0;
    for (let bnd = 0; bnd < BAND_COUNT; bnd++) {
      const fl = f.flux[bnd];
      const x = BANDS[bnd].weight * Math.max(fl[i - 1], fl[i], fl[i + 1]);
      share.push(x);
      total += x;
    }
    for (let bnd = 0; bnd < BAND_COUNT; bnd++) share[bnd] = total > 0 ? share[bnd] / total : 1 / BAND_COUNT;
    const tRaw = frameTime(f, i);
    out.push({ n: i, tRaw, t: tRaw, strength: v - mean, share });
  }
  return out;
}

/** onset 후보가 박자 격자에 평균적으로 얼마나 가까운가 (무작위면 평균 step/4) */
function fitsGrid(cands: Candidate[], offset: number, step: number): boolean {
  if (cands.length < 8 || step <= 0) return false;
  let sum = 0;
  for (const c of cands) {
    const k = (c.tRaw - offset) / step;
    sum += Math.abs(k - Math.round(k)) * step;
  }
  return sum / cands.length <= SNAP_FIT * (step / 4);
}

// ─── 2. 선택: 강한 onset 부터, 최소 간격·초당 밀도 제한 ─────────────────────
function select(cands: Candidate[], f: Features, p: DifficultyParams): Event[] {
  const order = [...cands].sort((a, b) => b.strength - a.strength);
  const bins = new Uint16Array(Math.ceil(frameTime(f, f.frames) / 0.1) + 16);
  const accepted: Event[] = [];
  const times: number[] = []; // accepted 와 같은 순서로 정렬 유지

  for (const c of order) {
    const idx = lowerBound(times, c.t);
    if (idx > 0 && c.t - times[idx - 1] < p.minGap) continue;
    if (idx < times.length && times[idx] - c.t < p.minGap) continue;
    const b = Math.max(0, Math.floor(c.t / 0.1));
    let sum = 0;
    for (let k = Math.max(0, b - 5); k < Math.min(bins.length, b + 5); k++) sum += bins[k];
    if (sum >= p.windowCap) continue;

    bins[b]++;
    times.splice(idx, 0, c.t);
    const bands = c.share.map((_, i) => i).sort((x, y) => c.share[y] - c.share[x]);
    accepted.splice(idx, 0, { ...c, bands, holdDur: 0 });
  }
  return accepted;
}

// ─── 3. 지속음 → 롱노트 ─────────────────────────────────────────────────
function detectHolds(events: Event[], f: Features, p: DifficultyParams, snap: (t: number) => number): void {
  const smooth = f.energy.map((e) => movingAverage(e, 2));
  for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei];
    const band = ev.bands[0];
    const e = smooth[band];
    const n0 = ev.n;
    if (n0 + 8 >= e.length) continue;

    let peak = 0;
    for (let k = n0; k <= n0 + 3; k++) peak = Math.max(peak, e[k]);
    let base = peak;
    for (let k = Math.max(0, n0 - 6); k <= n0; k++) base = Math.min(base, e[k]);
    const level = base + 0.6 * (peak - base);

    // 에너지가 level 밑으로 2프레임 연속 내려갈 때까지, 같은 대역의 다음 이벤트 직전까지
    let next = Infinity;
    for (let j = ei + 1; j < events.length; j++) {
      if (events[j].bands[0] === band) { next = events[j].t; break; }
    }
    const limit = Math.min(ev.tRaw + HOLD_MAX, next - HOLD_RELEASE_GAP);
    let m = n0 + 3;
    let below = 0;
    while (m + 1 < e.length && frameTime(f, m) < limit) {
      if (e[m] < level) { if (++below >= 2) break; } else below = 0;
      m++;
    }
    let end = frameTime(f, Math.max(n0, m - below));
    end = Math.min(end, limit);
    let dur = end - ev.tRaw;
    if (dur < p.holdMin) continue;
    dur = snap(ev.t + dur) - ev.t;
    if (dur >= p.holdMin) ev.holdDur = Math.min(dur, HOLD_MAX);
  }
}

/** 롱노트가 너무 많으면 짧은 것부터 탭으로 되돌린다 */
function pruneHolds(events: Event[], p: DifficultyParams): void {
  const holds = events.filter((e) => e.holdDur > 0).sort((a, b) => a.holdDur - b.holdDur);
  const allowed = Math.floor(events.length * p.holdFraction);
  for (let i = 0; i < holds.length - allowed; i++) holds[i].holdDur = 0;
}

// ─── 4. 레인 배정 ──────────────────────────────────────────────────────────
const BAND_LANES: number[][] = [
  [0, 3], // low → 바깥 레인
  [0, 1, 2, 3], // mid → 아무 레인
  [1, 2], // high → 안쪽 레인
];
const BAND_JITTER = [0.15, 0.6, 0.15];

function assignLanes(events: Event[], p: DifficultyParams, rng: () => number): MapNote[] {
  const lastTime = [-1e9, -1e9, -1e9, -1e9];
  const holdEnd = [-1e9, -1e9, -1e9, -1e9];
  const notes: MapNote[] = [];

  for (const ev of events) {
    const t = ev.t;
    let active = 0;
    for (let l = 0; l < 4; l++) if (holdEnd[l] > t) active++;
    let chord = 0;
    for (let i = 0; i < ev.bands.length && i < p.maxChord; i++) {
      if (i === 0 || ev.share[ev.bands[i]] >= p.chordShare) chord++;
    }
    chord = Math.min(chord, p.maxFingers - active);
    if (chord <= 0) continue;

    const used: number[] = [];
    for (let i = 0; i < chord; i++) {
      const band = ev.bands[i];
      const free = BAND_LANES[band].filter((l) => !used.includes(l) && holdEnd[l] + HOLD_RELEASE_GAP <= t);
      let pool = free.filter((l) => t - lastTime[l] >= p.sameLaneGap);
      if (pool.length === 0) pool = free;
      if (pool.length === 0) {
        pool = [0, 1, 2, 3].filter((l) => !used.includes(l) && holdEnd[l] + HOLD_RELEASE_GAP <= t);
      }
      if (pool.length === 0) continue;
      let lane = pool[0];
      let bestScore = -Infinity;
      for (const l of pool) {
        const sc = Math.min(2, t - lastTime[l]) + rng() * BAND_JITTER[band];
        if (sc > bestScore) { bestScore = sc; lane = l; }
      }
      used.push(lane);
      lastTime[lane] = t;
      const dur = i === 0 ? ev.holdDur : 0;
      if (dur > 0) holdEnd[lane] = t + dur;
      notes.push({ t: round3(t), lane, dur: round3(dur) });
    }
  }
  return notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function movingAverage(a: Float32Array, r: number): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) { s += a[k]; c++; }
    out[i] = s / c;
  }
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** 문자열 시드 → 결정적 난수 (같은 곡·난이도는 항상 같은 맵) */
function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
