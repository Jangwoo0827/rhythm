import { isDifficulty, isSongHash } from './mapCodec';
import type { Difficulty } from '../game/types';

/** 맵 공유: 링크(#/song/<곡지문>) 또는 맵 ID(<곡지문> / <곡지문>_<난이도>)로 불러온다. */
export interface ShareTarget {
  songHash: string;
  difficulty?: Difficulty;
}

export function buildShareLink(baseUrl: string, songHash: string): string {
  return `${baseUrl.split('#')[0]}#/song/${songHash}`;
}

/** 사용자가 붙여 넣은 텍스트에서 곡 지문을 찾는다. 알아볼 수 없으면 null. */
export function parseShareInput(text: string): ShareTarget | null {
  const s = text.trim();
  if (!s) return null;
  // 링크 형태: ...#/song/<hash>[_<difficulty>]
  const m = s.match(/#\/song\/([0-9a-f]{16})(?:_(easy|normal|hard))?\b/i) ?? s.match(/^([0-9a-f]{16})(?:_(easy|normal|hard))?$/i);
  if (!m) return null;
  const songHash = m[1].toLowerCase();
  if (!isSongHash(songHash)) return null;
  const diff = m[2]?.toLowerCase();
  return isDifficulty(diff) ? { songHash, difficulty: diff } : { songHash };
}

/** location.hash 에서 공유 대상을 읽는다 (#/song/<hash>) */
export function parseShareHash(hash: string): ShareTarget | null {
  return /^#\/song\//.test(hash) ? parseShareInput(hash) : null;
}
