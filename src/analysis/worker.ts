import { analyze } from './pipeline';
import type { WorkerIn, WorkerOut } from './protocol';

/** 분석 Web Worker: UI 스레드를 막지 않고 진행률을 보고한다. */
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  postMessage(msg: WorkerOut): void;
};

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'analyze') return;
  try {
    let last = -1;
    const result = analyze(msg.pcm, msg.sampleRate, msg.meta, (p) => {
      const pct = Math.floor(p * 100);
      if (pct !== last) { last = pct; scope.postMessage({ type: 'progress', value: p }); }
    });
    scope.postMessage({ type: 'done', result });
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
