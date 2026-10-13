import type { Game } from './game';
import { LANES } from './types';
import { isField } from '../ui/gestures';
import { laneFromX, type Layout } from './layout';

const KEYS: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };

/**
 * pointerdown/up 기반 멀티터치 입력 + (PC 테스트용) 키보드 D F J K.
 * 각 pointerId 는 눌린 순간의 레인에 묶이므로 손가락을 옆으로 밀어도 롱노트가 유지된다.
 */
export class Input {
  private readonly pointers = new Map<number, number>();
  private readonly counts: number[] = Array(LANES).fill(0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getGame: () => Game | null,
    private readonly getLayout: () => Layout,
  ) {
    const opt = { passive: false } as const;
    canvas.addEventListener('pointerdown', this.onDown, opt);
    canvas.addEventListener('pointerup', this.onUp, opt);
    canvas.addEventListener('pointercancel', this.onUp, opt);
    canvas.addEventListener('lostpointercapture', this.onUp, opt);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
  }

  /** 새 게임을 시작할 때 눌림 상태 초기화 */
  reset = (): void => {
    this.pointers.clear();
    this.counts.fill(0);
    this.getGame()?.releaseAll();
  };

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    const L = this.getLayout();
    if (e.clientY < L.touchTop) return;
    const lane = laneFromX(L, e.clientX);
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
    this.pointers.set(e.pointerId, lane);
    this.counts[lane]++;
    this.press(lane, e.timeStamp);
  };

  private onUp = (e: PointerEvent): void => {
    e.preventDefault();
    const lane = this.pointers.get(e.pointerId);
    if (lane === undefined) return;
    this.pointers.delete(e.pointerId);
    if (--this.counts[lane] <= 0) {
      this.counts[lane] = 0;
      this.releaseLane(lane, e.timeStamp);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const lane = KEYS[e.code];
    if (lane === undefined || e.repeat || isField(e.target)) return;
    e.preventDefault();
    this.counts[lane]++;
    this.press(lane, e.timeStamp);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const lane = KEYS[e.code];
    if (lane === undefined || isField(e.target)) return;
    e.preventDefault();
    if (--this.counts[lane] <= 0) {
      this.counts[lane] = 0;
      this.releaseLane(lane, e.timeStamp);
    }
  };

  private press(lane: number, timeStamp: number): void {
    const game = this.getGame();
    if (!game) return;
    game.press(lane, game.eventSongTime(timeStamp));
  }

  private releaseLane(lane: number, timeStamp: number): void {
    const game = this.getGame();
    if (!game) return;
    game.release(lane, game.eventSongTime(timeStamp));
  }
}
