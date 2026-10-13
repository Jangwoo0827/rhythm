/**
 * AudioContext.currentTime 에 고정(anchor)된 게임 시계.
 *
 * currentTime 은 오디오 렌더 블록 단위로 계단식으로 갱신되므로, 프레임마다 그대로 읽으면 흔들린다.
 * 그래서 (currentTime - performance.now()) 오프셋의 "상단 포락선"을 추적해 두고
 *   audioNow() = performance.now() + offset
 * 으로 부드럽게 보간한다. 기준은 항상 오디오 시계이며, 오프셋은 매 프레임 오디오 시계로 다시 보정된다.
 * 터치 이벤트도 event.timeStamp(하드웨어 입력 시각)를 같은 오프셋으로 오디오 시간으로 변환해
 * rAF 프레임 간격(16ms)에 판정이 휘둘리지 않게 한다.
 */
export class Clock {
  private offset = 0;
  private ready = false;

  constructor(private readonly ctx: AudioContext) {}

  /** 오프셋을 즉시 재설정 (시작/재개 직후). */
  snap(): void {
    this.offset = this.ctx.currentTime - performance.now() / 1000;
    this.ready = true;
  }

  /** 매 프레임 호출. */
  sync(): void {
    if (!this.ready) return this.snap();
    const raw = this.ctx.currentTime - performance.now() / 1000;
    const d = raw - this.offset;
    // currentTime 은 실제보다 뒤처질 수는 있어도 앞서지 않는다 → 올라가는 방향은 즉시 반영,
    // 내려가는 방향(계단 구간)은 천천히 흘려보내고, 큰 점프(일시정지 후 재개 등)는 스냅.
    if (d > 0 || d < -0.05) this.offset = raw;
    else this.offset += d * 0.02;
  }

  /** 현재 오디오 시각(초). AudioContext.currentTime 과 같은 시간축. */
  audioNow(): number {
    if (this.ctx.state !== 'running') return this.ctx.currentTime;
    return performance.now() / 1000 + this.offset;
  }

  /** 입력 이벤트(event.timeStamp, ms)를 오디오 시각으로 변환. */
  fromEventTime(timeStampMs: number): number {
    const now = this.audioNow();
    if (this.ctx.state !== 'running') return now;
    const t = timeStampMs / 1000 + this.offset;
    // timeStamp 가 다른 시간축이거나 비정상이면 현재 시각으로 대체
    return Math.abs(t - now) > 0.25 ? now : Math.min(t, now);
  }
}
