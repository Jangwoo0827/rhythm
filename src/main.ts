import './style.css';
import { AudioEngine } from './audio/engine';
import { createBackingTrack, createHitSound } from './audio/testSound';
import { Effects } from './game/effects';
import { Game } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/renderer';
import { SAMPLE_MAP } from './game/sampleMap';
import { blockGestures } from './ui/gestures';
import { Overlay } from './ui/overlay';

blockGestures();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = new Overlay(document.getElementById('ui')!);
const engine = new AudioEngine();
const renderer = new Renderer(canvas);
const effects = new Effects();

let game: Game | null = null;
let songBuffer: AudioBuffer | null = null;

const input = new Input(canvas, () => game, () => renderer.layout);

function showStart(): void {
  game = null;
  overlay.showStart(SAMPLE_MAP.title, () => void begin());
}

async function begin(): Promise<void> {
  // 클릭 제스처 안에서 곧바로 오디오를 활성화한다 (모바일 자동재생 제한 대응)
  await engine.unlock();
  if (!songBuffer) {
    songBuffer = createBackingTrack(engine.ctx);
    engine.setHitBuffer(createHitSound(engine.ctx));
  }

  game?.stop();
  input.reset();
  renderer.reset();

  const g = new Game(engine, SAMPLE_MAP, songBuffer);
  g.events = {
    onJudge: (lane, j, _note, diff) => effects.hit(renderer.layout, lane, j, diff),
    onHoldComplete: (lane) => effects.holdComplete(renderer.layout, lane),
    onFinish: (result) =>
      overlay.showResult(result, SAMPLE_MAP.title, () => void begin(), () => showStart()),
  };
  game = g;
  overlay.hide();
  g.start();
}

async function pause(): Promise<void> {
  if (!game || game.state !== 'running') return;
  input.reset();
  await game.pause();
  overlay.showPaused(
    () => { overlay.hide(); void game?.resume(); },
    () => { game?.stop(); showStart(); },
  );
}

// 앱 전환/화면 잠금 시 오디오 시계가 멈추므로 자동 일시정지
document.addEventListener('visibilitychange', () => { if (document.hidden) void pause(); });

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (engine.ready) engine.clock.sync();
  game?.update();
  effects.update(dt);
  renderer.draw(game, effects, engine.getEnergy());
  requestAnimationFrame(frame);
}

showStart();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // 개발 중 콘솔/자동 테스트용
  Object.assign(window, { __rhythm: { engine, getGame: () => game, renderer } });
}
