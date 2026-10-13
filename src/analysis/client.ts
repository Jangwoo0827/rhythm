import type { MapMeta } from './mapGen';
import type { AnalysisResult } from './pipeline';
import type { WorkerIn, WorkerOut } from './protocol';

export type { AnalysisResult };

export interface AnalysisJob {
  promise: Promise<AnalysisResult>;
  cancel(): void;
}

/**
 * AudioBuffer 를 Web Worker 에서 분석한다. 메모리/속도를 위해 모노로 섞고 2배 디시메이션(평균)한다.
 * (분석에 쓰는 대역은 10kHz 이하이므로 22~24kHz 로 충분하다.)
 */
export function analyzeSong(
  buffer: AudioBuffer,
  meta: MapMeta,
  onProgress: (p: number) => void,
): AnalysisJob {
  const { pcm, sampleRate } = toMono(buffer);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let cancelled = false;

  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.value);
      else if (msg.type === 'done') { worker.terminate(); resolve(msg.result); }
      else { worker.terminate(); reject(new Error(msg.message)); }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(cancelled ? 'cancelled' : `분석 중 오류가 발생했어요 (${e.message || 'worker'})`));
    };
    const msg: WorkerIn = { type: 'analyze', pcm, sampleRate, meta };
    worker.postMessage(msg, [pcm.buffer]);
  });

  return {
    promise,
    cancel: () => { cancelled = true; worker.terminate(); },
  };
}

export function toMono(buffer: AudioBuffer): { pcm: Float32Array; sampleRate: number } {
  const factor = buffer.sampleRate >= 32000 ? 2 : 1;
  const len = Math.floor(buffer.length / factor);
  const out = new Float32Array(len);
  const channels = buffer.numberOfChannels;
  const scale = 1 / (channels * factor);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    if (factor === 1) for (let i = 0; i < len; i++) out[i] += data[i] * scale;
    else for (let i = 0; i < len; i++) out[i] += (data[2 * i] + data[2 * i + 1]) * scale;
  }
  return { pcm: out, sampleRate: buffer.sampleRate / factor };
}
