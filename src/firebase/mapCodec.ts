import type { Difficulty, GameMap, MapNote } from '../game/types';

/** Firestore maps/{mapId} 문서 ⇄ GameMap 변환과 검증. 다른 사람이 올린 맵은 신뢰할 수 없으므로 엄격히 검증한다. */
export const MAP_VERSION = 1;
export const MAX_NOTES = 2500;
export const DIFFICULTY_IDS: Difficulty[] = ['easy', 'normal', 'hard'];

const HASH_RE = /^[0-9a-f]{16}$/;

export const isSongHash = (s: unknown): s is string => typeof s === 'string' && HASH_RE.test(s);
export const isDifficulty = (s: unknown): s is Difficulty => s === 'easy' || s === 'normal' || s === 'hard';

/** maps/{mapId}, scores.mapId 에 쓰는 ID: 곡 지문 + 난이도 (곡당 난이도별 하나) */
export const mapId = (songHash: string, difficulty: Difficulty): string => `${songHash}_${difficulty}`;

export interface MapDocData {
  songHash: string;
  title: string;
  bpm: number;
  offset?: number;
  difficulty: Difficulty;
  notes: MapNote[];
  uid: string;
  v: number;
}

/** 업로드용 문서 데이터 (createdAt 은 서버 시각으로 어댑터에서 추가) */
export function mapToDoc(map: GameMap, uid: string): MapDocData {
  return {
    songHash: map.songHash,
    title: map.title.slice(0, 100) || 'untitled',
    bpm: map.bpm,
    ...(map.offset !== undefined ? { offset: map.offset } : {}),
    difficulty: map.difficulty,
    notes: map.notes.map((n) => ({ t: n.t, lane: n.lane, dur: n.dur })),
    uid,
    v: MAP_VERSION,
  };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** 문서 → GameMap. 형식이 조금이라도 어긋나면 null (부분 수정하지 않는다). */
export function sanitizeMapDoc(data: unknown, expected?: { songHash: string; difficulty: Difficulty }): GameMap | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!isSongHash(d.songHash) || !isDifficulty(d.difficulty)) return null;
  if (expected && (d.songHash !== expected.songHash || d.difficulty !== expected.difficulty)) return null;
  if (typeof d.title !== 'string' || d.title.length === 0 || d.title.length > 100) return null;
  if (!finite(d.bpm) || d.bpm < 0 || d.bpm > 400) return null;
  if (d.offset !== undefined && (!finite(d.offset) || d.offset < 0 || d.offset > 60)) return null;
  if (!Array.isArray(d.notes) || d.notes.length === 0 || d.notes.length > MAX_NOTES) return null;

  const notes: MapNote[] = [];
  for (const raw of d.notes) {
    if (typeof raw !== 'object' || raw === null) return null;
    const n = raw as Record<string, unknown>;
    if (!finite(n.t) || n.t < 0 || n.t > 3600) return null;
    if (typeof n.lane !== 'number' || !Number.isInteger(n.lane) || n.lane < 0 || n.lane > 3) return null;
    if (!finite(n.dur) || n.dur < 0 || n.dur > 30) return null;
    notes.push({ t: n.t, lane: n.lane, dur: n.dur });
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return {
    songHash: d.songHash,
    title: d.title,
    bpm: d.bpm,
    ...(d.offset !== undefined ? { offset: d.offset as number } : {}),
    difficulty: d.difficulty,
    notes,
  };
}
