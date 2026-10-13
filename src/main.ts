import './style.css';
import { analyzeSong, type AnalysisJob } from './analysis/client';
import { DIFFICULTIES, DIFFICULTY_PARAMS } from './analysis/difficulty';
import { AudioEngine } from './audio/engine';
import { formatDuration, loadSongFile } from './audio/loader';
import { computeSongHash } from './audio/songHash';
import { createBackingTrack, createHitSound } from './audio/testSound';
import { Effects } from './game/effects';
import { Game } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/renderer';
import { SAMPLE_MAP } from './game/sampleMap';
import type { Difficulty, GameMap } from './game/types';
import { blockGestures } from './ui/gestures';
import { Overlay } from './ui/overlay';

blockGestures();

interface Track { map: GameMap; buffer: AudioBuffer }
/** 분석이 끝난 업로드 곡: 난이도별 맵을 모두 갖고 있어 재분석 없이 난이도를 바꿀 수 있다 */
interface Analyzed { buffer: AudioBuffer; title: string; bpm: number; maps: Record<Difficulty, GameMap> }

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = new Overlay(document.getElementById('ui')!, () => void pause());
const engine = new AudioEngine();
const renderer = new Renderer(canvas);
const effects = new Effects();

let game: Game | null = null;
let track: Track | null = null;
let testTrack: Track | null = null;
let loadToken = 0; // 로딩/분석 중 취소(뒤로 가기) 대응
let job: AnalysisJob | null = null;
let analyzed: Analyzed | null = null;
let difficulty: Difficulty = 'normal';
let resumeToken = 0; // 재개 카운트다운 취소 대응

const input = new Input(canvas, () => game, () => renderer.layout);

function showMenu(): void {
  loadToken++;
  job?.cancel();
  job = null;
  game = null;
  track = null;
  overlay.setPauseVisible(false);
  overlay.showMenu({
    onBeforePick: () => void engine.unlock(),
    onFile: (f) => void onFile(f),
    onTest: () => void onTest(),
  });
}

async function onTest(): Promise<void> {
  await engine.unlock();
  if (!testTrack) {
    engine.setHitBuffer(createHitSound(engine.ctx));
    testTrack = { map: SAMPLE_MAP, buffer: createBackingTrack(engine.ctx) };
  }
  track = testTrack;
  await begin();
}

async function onFile(file: File): Promise<void> {
  const token = ++loadToken;
  overlay.showLoading('곡을 불러오는 중…');
  try {
    // 메뉴 버튼 클릭에서 이미 unlock 했지만, 못 한 환경을 위해 한 번 더 시도 (resume 은 START 에서도 한다)
    if (!engine.ready) await engine.unlock();
    const song = await loadSongFile(engine.ctx, file);
    if (token !== loadToken) return;
    const hash = computeSongHash(song.buffer);

    const setProgress = overlay.showAnalyzing(song.title, showMenu);
    job = analyzeSong(song.buffer, { songHash: hash, title: song.title }, setProgress);
    const result = await job.promise;
    if (token !== loadToken) return;
    job = null;

    analyzed = { buffer: song.buffer, title: song.title, bpm: result.bpm, maps: result.maps };
    engine.setHitBuffer(createHitSound(engine.ctx));
    showReady();
  } catch (e) {
    if (token !== loadToken) return;
    job = null;
    overlay.showMessage(e instanceof Error ? e.message : '곡을 불러오지 못했어요.', showMenu);
  }
}

function showReady(): void {
  const a = analyzed;
  if (!a) return;
  const dur = a.buffer.duration;
  overlay.showReady({
    title: a.title,
    info: `${formatDuration(dur)} · ${a.bpm > 0 ? `BPM ${a.bpm.toFixed(1)}` : 'BPM 감지 실패'}`,
    options: DIFFICULTIES.map((d) => {
      const n = a.maps[d].notes.length;
      return {
        id: d,
        label: DIFFICULTY_PARAMS[d].label,
        detail: `${n}노트 · ${(n / dur).toFixed(1)}/s`,
        playable: n >= 5,
      };
    }),
    selected: difficulty,
    onSelect: (id) => { difficulty = id as Difficulty; track = { map: a.maps[difficulty], buffer: a.buffer }; },
    onStart: () => void begin(),
    onBack: showMenu,
  });
}

async function begin(): Promise<void> {
  if (!track) return;
  // START 클릭 제스처 안에서 곧바로 오디오 활성화 (모바일 자동재생 제한 대응)
  await engine.unlock();

  game?.stop();
  input.reset();
  renderer.reset();
  resumeToken++;

  const t = track;
  const g = new Game(engine, t.map, t.buffer);
  g.events = {
    onJudge: (lane, j, _note, diff) => effects.hit(renderer.layout, lane, j, diff),
    onHoldComplete: (lane) => effects.holdComplete(renderer.layout, lane),
    onFinish: (result) => {
      overlay.setPauseVisible(false);
      overlay.showResult(result, t.map.title, () => void begin(), showMenu);
    },
  };
  game = g;
  overlay.hide();
  overlay.setPauseVisible(true);
  g.start();
}

async function pause(): Promise<void> {
  const g = game;
  if (!g || g.state !== 'running') return;
  input.reset();
  overlay.setPauseVisible(false);
  await g.pause();
  overlay.showPaused(
    () => void resumeWithCountdown(),
    () => void begin(),
    () => { g.stop(); showMenu(); },
  );
}

/** 재개 시 3-2-1 을 세어 준비할 시간을 준다. 이 동안 오디오는 멈춰 있다. */
async function resumeWithCountdown(): Promise<void> {
  const g = game;
  if (!g) return;
  const token = ++resumeToken;
  for (let n = 3; n >= 1; n--) {
    overlay.showCount(n);
    await new Promise((r) => setTimeout(r, 700));
    if (token !== resumeToken || g.state !== 'paused') return;
  }
  overlay.hide();
  overlay.setPauseVisible(true);
  await g.resume();
}

// 앱 전환/화면 잠금 시 오디오 시계가 멈추므로 자동 일시정지
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  resumeToken++;
  if (game?.state === 'paused') {
    // 재개 카운트다운 중이었다면 일시정지 메뉴로 되돌린다
    overlay.showPaused(
      () => void resumeWithCountdown(),
      () => void begin(),
      () => { game?.stop(); showMenu(); },
    );
  } else {
    void pause();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game?.state === 'running') void pause();
});

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

showMenu();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // 개발 중 콘솔/자동 테스트용
  Object.assign(window, { __rhythm: { engine, getGame: () => game, getTrack: () => track, renderer } });
}
