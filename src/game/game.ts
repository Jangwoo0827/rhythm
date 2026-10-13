import type { AudioEngine } from '../audio/engine';
import { HOLD_RELEASE_TOLERANCE, WINDOW, judgeDiff } from './judge';
import { ScoreKeeper } from './score';
import { LANES, type GameMap, type Judgement, type MapNote, type Result } from './types';

/** 곡 시작 전 카운트다운(초) */
export const LEAD_IN = 2.4;
/** 노트가 화면 위에서 판정선까지 내려오는 시간(초) */
export const APPROACH = 1.4;

export type NoteStatus = 'pending' | 'holding' | 'hit' | 'missed' | 'broken';

export interface LiveNote extends MapNote {
  status: NoteStatus;
  /** 첫 타격(헤드) 판정 */
  head: Judgement | null;
}

export interface GameEvents {
  /** diff: 노트 시각 대비 입력 시각(초, +면 늦음). Miss(자동)면 0 */
  onJudge?(lane: number, j: Judgement, note: LiveNote, diff: number): void;
  onHoldComplete?(lane: number): void;
  onFinish?(result: Result): void;
}

export type GameState = 'idle' | 'running' | 'paused' | 'finished';

/**
 * 게임 로직 (렌더링과 무관). 모든 시간은 AudioContext 시계 기준의 "곡 시간"(초)이며
 * 곡 시간 0 = 음악 버퍼의 첫 샘플이다. LEAD_IN 동안은 음수.
 */
export class Game {
  readonly notes: LiveNote[];
  readonly score: ScoreKeeper;
  readonly laneDown: boolean[] = Array(LANES).fill(false);
  state: GameState = 'idle';
  /** 판정/표시 보정(초). 양수면 노트가 더 늦게 오는 것으로 처리 (STEP 4 오프셋 설정용) */
  offset = 0;
  events: GameEvents = {};

  private readonly laneNotes: LiveNote[][] = Array.from({ length: LANES }, () => []);
  private readonly cursor: number[] = Array(LANES).fill(0);
  private readonly holding: (LiveNote | null)[] = Array(LANES).fill(null);
  private startAt = 0;
  private readonly endTime: number;

  constructor(
    private readonly engine: AudioEngine,
    readonly map: GameMap,
    private readonly song: AudioBuffer,
  ) {
    this.notes = map.notes.map((n) => ({ ...n, status: 'pending', head: null }));
    for (const n of this.notes) this.laneNotes[n.lane].push(n);
    this.score = new ScoreKeeper(this.notes.length);
    const last = this.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    this.endTime = last + 1.2;
  }

  start(): void {
    const ctx = this.engine.ctx;
    this.startAt = ctx.currentTime + LEAD_IN;
    this.engine.playMusic(this.song, this.startAt);
    this.state = 'running';
  }

  /** 현재 곡 시간(초). */
  songTime(): number {
    return this.engine.clock.audioNow() - this.startAt - this.offset;
  }

  /** 입력 이벤트의 타임스탬프(ms, performance.now 시간축)를 곡 시간으로 변환. */
  eventSongTime(timeStampMs: number): number {
    return this.engine.clock.fromEventTime(timeStampMs) - this.startAt - this.offset;
  }

  get duration(): number {
    return this.endTime;
  }

  /** 매 프레임 호출: 놓친 노트 처리, 롱노트 자동 완료, 종료 판단. */
  update(): void {
    if (this.state !== 'running') return;
    const t = this.songTime();

    for (let lane = 0; lane < LANES; lane++) {
      const n = this.nextPending(lane);
      if (n && t > n.t + WINDOW.good) this.miss(n);

      const h = this.holding[lane];
      if (h && t >= h.t + h.dur) {
        h.status = 'hit';
        this.holding[lane] = null;
        this.events.onHoldComplete?.(lane);
      }
    }

    if (t > this.endTime) this.finish();
  }

  press(lane: number, songTime: number): void {
    if (this.state !== 'running') return;
    this.laneDown[lane] = true;
    const n = this.nextPending(lane);
    if (!n) return;
    const diff = songTime - n.t;
    if (diff < -WINDOW.good) return; // 너무 이른 탭은 무시
    if (diff > WINDOW.good) {
      this.miss(n); // update() 가 아직 못 잡은 경우
      return;
    }
    const j = judgeDiff(Math.abs(diff));
    n.head = j;
    this.score.add(j);
    if (n.dur > 0) {
      n.status = 'holding';
      this.holding[lane] = n;
    } else {
      n.status = 'hit';
    }
    this.engine.playHit(j);
    this.events.onJudge?.(lane, j, n, diff);
  }

  release(lane: number, songTime: number): void {
    this.laneDown[lane] = false;
    const h = this.holding[lane];
    if (!h || this.state !== 'running') return;
    this.holding[lane] = null;
    if (songTime >= h.t + h.dur - HOLD_RELEASE_TOLERANCE) {
      h.status = 'hit';
      this.events.onHoldComplete?.(lane);
    } else {
      h.status = 'broken';
      this.score.demoteToMiss(h.head ?? 'good');
      this.events.onJudge?.(lane, 'miss', h, 0);
    }
  }

  /** 모든 레인의 눌림 상태를 해제 (포커스 이탈 등) */
  releaseAll(): void {
    const t = this.state === 'running' ? this.songTime() : 0;
    for (let lane = 0; lane < LANES; lane++) this.release(lane, t);
  }

  async pause(): Promise<void> {
    if (this.state !== 'running') return;
    this.state = 'paused';
    // 일시정지 중 놓은 손은 release 로 처리되지 않으므로(진행 중이 아님) 눌림 표시만 해제한다.
    // 이때 잡고 있던 롱노트는 재개 후 종료 시각에 자동 완료된다.
    this.laneDown.fill(false);
    await this.engine.suspend();
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.engine.resume();
    this.state = 'running';
  }

  /** 중도 종료 (나가기 / 다시 하기) */
  stop(): void {
    this.state = 'finished';
    this.engine.stopMusic();
  }

  private nextPending(lane: number): LiveNote | null {
    const list = this.laneNotes[lane];
    let i = this.cursor[lane];
    while (i < list.length && list[i].status !== 'pending') i++;
    this.cursor[lane] = i;
    return i < list.length ? list[i] : null;
  }

  private miss(n: LiveNote): void {
    n.status = 'missed';
    n.head = 'miss';
    this.score.add('miss');
    this.events.onJudge?.(n.lane, 'miss', n, 0);
  }

  private finish(): void {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.engine.stopMusic(0.5);
    this.events.onFinish?.(this.score.result());
  }
}
