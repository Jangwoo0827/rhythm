import type { Difficulty, GameMap } from '../game/types';
import { generateMaps, type MapMeta } from './mapGen';
import { extractFeatures } from './spectral';
import { estimateTempo } from './tempo';

export interface AnalysisResult {
  bpm: number;
  offset: number;
  confidence: number;
  maps: Record<Difficulty, GameMap>;
}

/** 모노 PCM → 박자 추정 + 난이도별 맵. 워커와 테스트에서 공통으로 사용한다. */
export function analyze(
  pcm: Float32Array,
  sampleRate: number,
  meta: MapMeta,
  onProgress?: (p: number) => void,
): AnalysisResult {
  // 특징 추출이 대부분의 시간을 차지한다 (0~90%)
  const f = extractFeatures(pcm, sampleRate, (p) => onProgress?.(p * 0.9));
  const tempo = estimateTempo(f);
  onProgress?.(0.95);
  const maps = generateMaps(f, tempo, meta);
  onProgress?.(1);
  return {
    bpm: tempo?.bpm ?? 0,
    offset: tempo?.offset ?? 0,
    confidence: tempo?.confidence ?? 0,
    maps,
  };
}
