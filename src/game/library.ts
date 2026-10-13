import { readJSON, removeKey, writeJSON } from '../storage';
import type { Difficulty, GameMap, Rank, Result } from './types';

/** 곡 목록(최근 플레이)과 분석한 맵 캐시. 오디오 원본은 저장하지 않는다. */

export interface BestScore { score: number; accuracy: number; rank: Rank; maxCombo: number }

export interface SongEntry {
  songHash: string;
  title: string;
  bpm: number;
  duration: number;
  lastPlayed: number;
  plays: number;
  best: Partial<Record<Difficulty, BestScore>>;
}

export interface CachedAnalysis {
  bpm: number;
  offset: number;
  maps: Record<Difficulty, GameMap>;
}

export const SAMPLE_HASH = 'sample-builtin';
export const MAX_SONGS = 12;

const LIB_KEY = 'rhythm.library.v1';
const MAP_INDEX_KEY = 'rhythm.maps.index.v1';
const MAP_PREFIX = 'rhythm.maps.v1.';

// ─── 곡 목록 ───────────────────────────────────────────────────────────────
export function getLibrary(): SongEntry[] {
  const list = readJSON<SongEntry[]>(LIB_KEY);
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.songHash === 'string' && typeof e.title === 'string')
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export interface PlayMeta { songHash: string; title: string; bpm: number; duration: number }

/** 플레이 결과를 기록하고 최고 기록 갱신 여부를 알려 준다. */
export function recordPlay(
  meta: PlayMeta,
  difficulty: Difficulty,
  result: Result,
  now = Date.now(),
): { isNewBest: boolean; best: BestScore } {
  const list = getLibrary();
  let entry = list.find((e) => e.songHash === meta.songHash);
  if (!entry) {
    entry = { ...meta, lastPlayed: now, plays: 0, best: {} };
    list.push(entry);
  }
  entry.title = meta.title;
  entry.bpm = meta.bpm;
  entry.duration = meta.duration;
  entry.lastPlayed = now;
  entry.plays++;

  const prev = entry.best[difficulty];
  const isNewBest = !prev || result.score > prev.score;
  if (isNewBest) {
    entry.best[difficulty] = {
      score: result.score,
      accuracy: result.accuracy,
      rank: result.rank,
      maxCombo: result.maxCombo,
    };
  }

  list.sort((a, b) => b.lastPlayed - a.lastPlayed);
  for (const dropped of list.splice(MAX_SONGS)) removeAnalysis(dropped.songHash);
  writeJSON(LIB_KEY, list);
  return { isNewBest, best: entry.best[difficulty]! };
}

export function removeSong(songHash: string): void {
  writeJSON(LIB_KEY, getLibrary().filter((e) => e.songHash !== songHash));
  removeAnalysis(songHash);
}

// ─── 분석 결과(맵) 캐시: 같은 파일을 다시 고르면 분석을 건너뛴다 ────────────────────
type CompactNotes = Array<[number, number, number]>; // [t(ms), lane, dur(ms)]
interface CompactAnalysis {
  title: string;
  bpm: number;
  offset: number;
  notes: Record<Difficulty, CompactNotes>;
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export function saveAnalysis(songHash: string, title: string, a: CachedAnalysis): boolean {
  const notes = {} as Record<Difficulty, CompactNotes>;
  for (const d of DIFFS) notes[d] = a.maps[d].notes.map((n) => [Math.round(n.t * 1000), n.lane, Math.round(n.dur * 1000)]);
  const data: CompactAnalysis = { title, bpm: a.bpm, offset: a.offset, notes };

  let index = (readJSON<string[]>(MAP_INDEX_KEY) ?? []).filter((h) => h !== songHash);
  // 용량이 모자라면 가장 오래된 캐시부터 지우며 재시도
  for (let attempt = 0; attempt < 6; attempt++) {
    if (writeJSON(MAP_PREFIX + songHash, data)) {
      index.unshift(songHash);
      for (const old of index.splice(MAX_SONGS)) removeKey(MAP_PREFIX + old);
      writeJSON(MAP_INDEX_KEY, index);
      return true;
    }
    const oldest = index.pop();
    if (!oldest) break;
    removeKey(MAP_PREFIX + oldest);
  }
  writeJSON(MAP_INDEX_KEY, index);
  return false;
}

export function loadAnalysis(songHash: string): CachedAnalysis | null {
  const data = readJSON<CompactAnalysis>(MAP_PREFIX + songHash);
  if (!data || !data.notes) return null;
  const maps = {} as Record<Difficulty, GameMap>;
  for (const d of DIFFS) {
    const list = data.notes[d];
    if (!Array.isArray(list)) return null;
    maps[d] = {
      songHash,
      title: data.title,
      bpm: data.bpm,
      ...(data.offset ? { offset: data.offset } : {}),
      difficulty: d,
      notes: list.map(([t, lane, dur]) => ({ t: t / 1000, lane, dur: dur / 1000 })),
    };
  }
  // 최근 사용으로 갱신
  const index = (readJSON<string[]>(MAP_INDEX_KEY) ?? []).filter((h) => h !== songHash);
  index.unshift(songHash);
  writeJSON(MAP_INDEX_KEY, index);
  return { bpm: data.bpm, offset: data.offset, maps };
}

function removeAnalysis(songHash: string): void {
  removeKey(MAP_PREFIX + songHash);
  const index = readJSON<string[]>(MAP_INDEX_KEY);
  if (index) writeJSON(MAP_INDEX_KEY, index.filter((h) => h !== songHash));
}
