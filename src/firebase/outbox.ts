import { readJSON, writeJSON } from '../storage';

/**
 * 점수 업로드 대기열. 오프라인이거나 아직 로그인 전이어도 플레이 기록을 잃지 않도록
 * localStorage 에 쌓아 두고, 온라인 + 로그인 상태가 되면 순서대로 올린다.
 * 문서 ID 를 클라이언트가 만들어 두므로 재시도해도 중복 문서가 생기지 않는다(올리기 전에 존재 확인).
 */
export interface ScoreItem {
  id: string;
  mapId: string;
  nickname: string;
  score: number;
  accuracy: number;
  combo: number;
  /** 실제 플레이한 시각(ms) */
  playedAt: number;
  attempts: number;
}

export interface OutboxBackend {
  /** 올릴 수 있는 상태(온라인 + 로그인)면 uid, 아니면 null */
  ready(): Promise<string | null>;
  exists(id: string): Promise<boolean>;
  create(item: ScoreItem, uid: string): Promise<void>;
}

export interface FlushResult { sent: number; dropped: number; remaining: number }

/** 잠시 후 다시 시도하면 될 수 있는 오류 */
const TRANSIENT = new Set([
  'unavailable', 'deadline-exceeded', 'cancelled', 'aborted', 'resource-exhausted', 'unauthenticated',
  'internal', 'unknown', 'auth/network-request-failed',
]);
/** 규칙상 거절됐지만(예: 맵이 아직 올라가지 않음) 조건이 바뀌면 통과할 수 있는 오류 → 횟수 제한 재시도 */
const RETRYABLE_DENIED = new Set(['permission-denied']);
export const MAX_ATTEMPTS = 5;
const MAX_ITEMS = 200;

const errorCode = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : 'unknown';

export class Outbox {
  private items: ScoreItem[];
  private flushing: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly backend: OutboxBackend, private readonly key = 'rhythm.outbox.v1') {
    const saved = readJSON<ScoreItem[]>(key);
    this.items = Array.isArray(saved) ? saved.filter((i) => i && typeof i.id === 'string' && typeof i.mapId === 'string') : [];
  }

  get pending(): number {
    return this.items.length;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  enqueue(item: Omit<ScoreItem, 'attempts'>): void {
    this.items.push({ ...item, attempts: 0 });
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    this.save();
  }

  /** 동시에 여러 번 호출돼도 한 번에 하나만 실행한다. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0, remaining: this.items.length };
    const uid = await this.backend.ready().catch(() => null);
    if (!uid) return result;

    for (const item of [...this.items]) {
      try {
        if (!(await this.backend.exists(item.id))) await this.backend.create(item, uid);
        this.remove(item);
        result.sent++;
      } catch (e) {
        const code = errorCode(e);
        if (TRANSIENT.has(code)) break; // 오프라인 등: 나머지도 같은 이유로 실패하니 중단하고 나중에 재시도
        if (RETRYABLE_DENIED.has(code) && ++item.attempts < MAX_ATTEMPTS) { this.save(); continue; }
        this.remove(item); // 영구 실패(검증 거절 등)는 버려서 대기열이 막히지 않게 한다
        result.dropped++;
      }
    }
    result.remaining = this.items.length;
    return result;
  }

  private remove(item: ScoreItem): void {
    this.items = this.items.filter((i) => i !== item && i.id !== item.id);
    this.save();
  }

  private save(): void {
    writeJSON(this.key, this.items);
    for (const fn of this.listeners) fn();
  }
}
