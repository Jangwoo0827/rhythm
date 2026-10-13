import { Clock } from './clock';
import type { Judgement } from '../game/types';
import { createHitSound } from './testSound';

type AudioContextCtor = typeof AudioContext;

/** Web Audio 그래프 소유자. 곡 재생, 효과음, 스펙트럼 분석기를 제공한다. */
export class AudioEngine {
  ctx!: AudioContext;
  clock!: Clock;
  private music!: GainNode;
  private sfx!: GainNode;
  private analyser!: AnalyserNode;
  private freq = new Uint8Array(0);
  private source: AudioBufferSourceNode | null = null;
  private hitBuffer: AudioBuffer | null = null;
  private musicVolume = 1;

  get ready(): boolean {
    return !!this.ctx;
  }

  /**
   * 반드시 사용자 제스처(클릭/탭) 핸들러 안에서 호출할 것.
   * 모바일 브라우저의 자동재생 제한을 풀어 AudioContext 를 running 으로 만든다.
   */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.clock = new Clock(this.ctx);

      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.7;
      this.hitBuffer = createHitSound(this.ctx);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.music.connect(this.analyser);
      this.music.connect(master);
      this.sfx.connect(master);
    }
    // resume() 는 제스처 안에서 동기적으로 시작되어야 iOS 에서 통과한다 (await 앞에서 호출).
    const resumed = this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
    // iOS 사일런트 모드/잠금 해제용 무음 1프레임
    const silent = this.ctx.createBufferSource();
    silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    silent.connect(this.ctx.destination);
    silent.start(0);
    // 사용자 제스처 밖에서 호출되면(예: 저장된 곡 자동 로드) 일부 브라우저에서 resume 이 끝나지 않을 수 있어
    // 시간 제한을 둔다. 이 경우 곡 시작(START) 버튼의 unlock 이 제스처 안에서 다시 깨운다.
    await Promise.race([resumed, new Promise<void>((r) => setTimeout(r, 2500))]);
    this.clock.snap();
  }

  /** 음악/효과음 볼륨(0..1). 음악 볼륨은 다음 곡 재생부터 적용된다. */
  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    if (this.ready) this.sfx.gain.value = sfx;
  }

  /** `when`(AudioContext 시각)에 메트로놈 틱을 예약한다 (오프셋 보정용). 취소하려면 반환된 노드를 stop(). */
  scheduleTick(when: number, rate = 1): AudioBufferSourceNode | null {
    if (!this.hitBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.hitBuffer;
    src.playbackRate.value = rate;
    src.connect(this.sfx);
    src.start(when);
    return src;
  }

  /** `when`(AudioContext 시각)에 정확히 맞춰 곡을 시작한다. */
  playMusic(buffer: AudioBuffer, when: number): void {
    this.stopMusic();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.music);
    src.start(when);
    this.music.gain.cancelScheduledValues(0);
    this.music.gain.value = this.musicVolume;
    this.source = src;
  }

  stopMusic(fade = 0): void {
    const src = this.source;
    if (!src) return;
    this.source = null;
    const now = this.ctx.currentTime;
    if (fade > 0) {
      this.music.gain.cancelScheduledValues(now);
      this.music.gain.setValueAtTime(this.music.gain.value, now);
      this.music.gain.linearRampToValueAtTime(0, now + fade);
      try { src.stop(now + fade); } catch { /* 이미 종료됨 */ }
    } else {
      try { src.stop(); } catch { /* 아직 시작 전이거나 종료됨 */ }
      src.disconnect();
    }
  }

  /** 노트를 쳤을 때 나는 짧은 효과음. */
  playHit(j: Judgement): void {
    if (!this.hitBuffer || j === 'miss') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.hitBuffer;
    src.playbackRate.value = j === 'perfect' ? 1.15 : j === 'great' ? 1.0 : 0.85;
    src.connect(this.sfx);
    src.start();
  }

  suspend(): Promise<void> {
    return this.ctx.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx.resume();
    this.clock.snap();
  }

  /** 0..1 로 정규화한 저/전체 에너지 (배경 시각화용). */
  getEnergy(): { bass: number; mid: number; high: number; bins: Uint8Array } {
    if (!this.ready || this.ctx.state !== 'running') return { bass: 0, mid: 0, high: 0, bins: this.freq };
    this.analyser.getByteFrequencyData(this.freq);
    const avg = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this.freq[i];
      return s / ((b - a) * 255);
    };
    return { bass: avg(1, 6), mid: avg(6, 30), high: avg(30, 100), bins: this.freq };
  }
}
