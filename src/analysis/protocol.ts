import type { AnalysisResult } from './pipeline';
import type { MapMeta } from './mapGen';

export type WorkerIn = { type: 'analyze'; pcm: Float32Array; sampleRate: number; meta: MapMeta };
export type WorkerOut =
  | { type: 'progress'; value: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };
