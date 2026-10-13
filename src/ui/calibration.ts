import type { AudioEngine } from '../audio/engine';
import { estimateOffset, type BeatPlan, type OffsetEstimate } from '../game/offsetEstimate';
import { button, h } from './dom';

const PERIOD = 0.6; // 100 BPM
const COUNT_IN = 4;
const MEASURED = 16;

/**
 * 오프셋 보정 화면: 메트로놈 소리에 맞춰 큰 원을 탭하면 평균 지연을 측정한다.
 * 타이밍은 게임과 똑같이 AudioContext 시계 + event.timeStamp 로 측정하므로
 * 블루투스 출력 지연과 탭 습관이 그대로 반영된다.
 */
export class Calibration {
  readonly el = h('div', 'screen');
  private taps: number[] = [];
  private plan: BeatPlan | null = null;
  private ticks: AudioBufferSourceNode[] = [];
  private raf = 0;
  private running = false;
  private lastBeat = -1;
  private pad: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private disposed = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly opts: { onApply: (offsetMs: number) => void; onCancel: () => void },
  ) {
    this.showIntro();
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.ticks) { try { t.stop(); } catch { /* 이미 끝남 */ } }
    this.ticks = [];
  }

  private render(...children: HTMLElement[]): void {
    this.el.replaceChildren(...children);
  }

  private showIntro(): void {
    this.running = false;
    this.render(
      h('div', 'title', '오프셋 보정'),
      h('div', 'sub', '게임에서 쓸 기기·이어폰 그대로 진행하세요.\n메트로놈 소리를 듣고, 소리에 맞춰 큰 원을 탭하세요.\n준비 4박 뒤 16번 탭하면 끝나요.'),
      this.actions(
        button('시작', 'neon', () => void this.start()),
        button('취소', 'neon secondary', this.opts.onCancel),
      ),
    );
  }

  private async start(): Promise<void> {
    await this.engine.unlock(); // 버튼 클릭 제스처 안에서
    if (this.disposed) return;
    const ctx = this.engine.ctx;
    const start = ctx.currentTime + 1.2;
    this.plan = { start, period: PERIOD, first: COUNT_IN, last: COUNT_IN + MEASURED - 1 };
    this.taps = [];
    this.lastBeat = -1;
    for (let k = 0; k < COUNT_IN + MEASURED; k++) {
      const t = this.engine.scheduleTick(start + k * PERIOD, k < COUNT_IN ? 1.4 : 1.0);
      if (t) this.ticks.push(t);
    }

    this.pad = h('button', 'calib-pad', 'TAP');
    this.pad.addEventListener('pointerdown', (e) => { e.preventDefault(); this.tap(e.timeStamp); });
    this.status = h('div', 'sub', '소리를 잘 들어 주세요…');
    this.render(
      h('div', 'title', '오프셋 보정'),
      this.status,
      this.pad,
      this.actions(button('취소', 'neon secondary', this.opts.onCancel)),
    );
    this.running = true;
    this.loop();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Space' && this.running && !e.repeat) { e.preventDefault(); this.tap(e.timeStamp); }
  }

  private tap(timeStamp: number): void {
    if (!this.running || !this.plan) return;
    this.taps.push(this.engine.clock.fromEventTime(timeStamp));
    this.pad?.classList.remove('hit');
    void this.pad?.offsetWidth;
    this.pad?.classList.add('hit');
    this.updateStatus();
  }

  private measuredTaps(): number {
    const p = this.plan;
    if (!p) return 0;
    const beats = new Set<number>();
    for (const t of this.taps) {
      const k = Math.round((t - p.start) / p.period);
      if (k >= p.first && k <= p.last) beats.add(k);
    }
    return beats.size;
  }

  private updateStatus(): void {
    if (!this.status || !this.plan) return;
    const k = this.lastBeat;
    this.status.textContent = k < COUNT_IN
      ? `준비… ${Math.max(1, COUNT_IN - Math.max(0, k))}`
      : `탭 ${this.measuredTaps()} / ${MEASURED}`;
  }

  private loop = (): void => {
    if (!this.running || !this.plan) return;
    const now = this.engine.clock.audioNow();
    const p = this.plan;
    const k = Math.floor((now - p.start) / p.period);
    if (k !== this.lastBeat && k >= 0) {
      this.lastBeat = k;
      this.pad?.classList.remove('pulse');
      void this.pad?.offsetWidth;
      this.pad?.classList.add('pulse');
      this.updateStatus();
    }
    if (now > p.start + (p.last + 0.5) * p.period) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private finish(): void {
    this.running = false;
    const est = this.plan ? estimateOffset(this.taps, this.plan) : null;
    this.showResult(est);
  }

  private showResult(est: OffsetEstimate | null): void {
    if (!est) {
      this.render(
        h('div', 'title', '측정 실패'),
        h('div', 'sub error', '유효한 탭이 너무 적어요.\n메트로놈 소리에 맞춰 박마다 한 번씩 탭해 주세요.'),
        this.actions(
          button('다시 측정', 'neon', () => void this.start()),
          button('취소', 'neon secondary', this.opts.onCancel),
        ),
      );
      return;
    }
    const sign = est.offsetMs > 0 ? '+' : '';
    const shaky = est.sdMs > 40;
    this.render(
      h('div', 'title', '측정 결과'),
      h('div', 'calib-value', `${sign}${est.offsetMs} ms`),
      h('div', 'sub', `유효 탭 ${est.used}/${MEASURED} · 편차 ±${est.sdMs}ms`),
      h('div', shaky ? 'sub error' : 'hint', shaky
        ? '탭 간격이 고르지 않아요. 다시 측정하면 더 정확해요.'
        : '+ 값이면 소리가 늦게 들리거나 늦게 치는 경향이에요.\n적용하면 노트가 그만큼 늦게 처리돼요.'),
      this.actions(
        button('적용', 'neon', () => this.opts.onApply(est.offsetMs)),
        button('다시 측정', 'neon secondary', () => void this.start()),
        button('취소', 'neon secondary', this.opts.onCancel),
      ),
    );
  }

  private actions(...buttons: HTMLElement[]): HTMLElement {
    const bar = h('div', 'actions');
    bar.append(...buttons);
    return bar;
  }
}
