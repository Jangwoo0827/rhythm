import { isSongHash } from './mapCodec';

/** songs/{songHash}: 공유 맵 목록용 가벼운 메타 문서 (맵 본문은 maps 에 있다) */
export interface SongInfo {
  songHash: string;
  title: string;
  mapper: string;
  bpm: number;
  duration: number;
  counts: { easy: number; normal: number; hard: number };
  /** 올린 시각(ms) */
  createdAt: number;
}

export type SongDocData = Omit<SongInfo, 'createdAt'> & { uid: string };

export function songToDoc(info: Omit<SongInfo, 'createdAt'>, uid: string): SongDocData {
  return {
    songHash: info.songHash,
    title: info.title.slice(0, 100) || 'untitled',
    mapper: info.mapper.slice(0, 16) || 'Player',
    bpm: info.bpm,
    duration: info.duration,
    counts: { easy: info.counts.easy, normal: info.counts.normal, hard: info.counts.hard },
    uid,
  };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const count = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 2500;

/** createdAt 은 Firestore Timestamp({toMillis}) 또는 숫자 */
function toMillis(v: unknown): number | null {
  if (finite(v)) return v;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    const n = (v as { toMillis: () => number }).toMillis();
    return finite(n) ? n : null;
  }
  return null;
}

/** 목록 항목 검증. 다른 사람이 올린 값이므로 형식이 어긋나면 null (목록에서 제외) */
export function sanitizeSongDoc(id: string, data: unknown): SongInfo | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!isSongHash(d.songHash) || d.songHash !== id) return null;
  if (typeof d.title !== 'string' || d.title.length < 1 || d.title.length > 100) return null;
  if (typeof d.mapper !== 'string' || d.mapper.length < 1 || d.mapper.length > 16) return null;
  if (!finite(d.bpm) || d.bpm < 0 || d.bpm > 400) return null;
  if (!finite(d.duration) || d.duration < 1 || d.duration > 3600) return null;
  const c = d.counts as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object' || !count(c.easy) || !count(c.normal) || !count(c.hard)) return null;
  const createdAt = toMillis(d.createdAt);
  if (createdAt === null) return null;
  return {
    songHash: d.songHash, title: d.title, mapper: d.mapper, bpm: d.bpm, duration: d.duration,
    counts: { easy: c.easy, normal: c.normal, hard: c.hard }, createdAt,
  };
}
