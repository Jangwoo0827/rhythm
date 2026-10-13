import './style.css';
import { analyzeSong, type AnalysisJob } from './analysis/client';
import { DIFFICULTIES, DIFFICULTY_PARAMS } from './analysis/difficulty';
import { AudioEngine } from './audio/engine';
import { formatDuration, loadSongFile } from './audio/loader';
import { computeSongHash } from './audio/songHash';
import { createBackingTrack } from './audio/testSound';
import { Effects } from './game/effects';
import { Game } from './game/game';
import { Input } from './game/input';
import {
  SAMPLE_HASH, getLibrary, loadAnalysis, recordPlay, removeSong, saveAnalysis,
  type CachedAnalysis, type PlayMeta,
} from './game/library';
import { Renderer } from './game/renderer';
import { SAMPLE_MAP } from './game/sampleMap';
import { approachFor, getSettings, updateSettings } from './game/settings';
import type { Difficulty, GameMap } from './game/types';
import { Calibration } from './ui/calibration';
import { blockGestures } from './ui/gestures';
import { Overlay } from './ui/overlay';
import { buildSettingsScreen } from './ui/settingsScreen';

blockGestures();

interface Track { map: GameMap; buffer: AudioBuffer; meta: PlayMeta }
/** 분석이 끝난 업로드 곡: 난이도별 맵을 모두 갖고 있어 재분석 없이 난이도를 바꿀 수 있다 */
interface Analyzed { buffer: AudioBuffer; title: string; hash: string; analysis: CachedAnalysis }

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = new Overlay(document.getElementById('ui')!, () => void pause());
const engine = new AudioEngine();
const renderer = new Renderer(canvas);
const effects = new Effects();

let game: Game | null = null;
let track: Track | null = null;
let testTrack: Track | null = null;
let analyzed: Analyzed | null = null;
let job: AnalysisJob | null = null;
let calibration: Calibration | null = null;
let loadToken = 0; // 로딩/분석 중 취소(뒤로 가기) 대응
let resumeToken = 0; // 재개 카운트다운 취소 대응

const input = new Input(canvas, () => game, () => renderer.layout);

/** 화면을 바꾸기 전에 진행 중인 분석/보정을 정리한다 */
function leaveScreen(): void {
  loadToken++;
  job?.cancel();
  job = null;
  calibration?.dispose();
  calibration = null;
  overlay.setPauseVisible(false);
}

// ─── 메뉴 / 설정 / 곡 목록 ───────────────────────────────────────────────────
function showMenu(): void {
  leaveScreen();
  game = null;
  track = null;
  overlay.showMenu({
    onBeforePick: () => void engine.unlock(),
    onFile: (f) => void onFile(f),
    onRecent: openRecent,
    onTest: () => void onTest(),
    onSettings: openSettings,
  });
}

function openSettings(): void {
  leaveScreen();
  overlay.mount(buildSettingsScreen({ onCalibrate: openCalibration, onBack: showMenu, rerender: openSettings }));
}

function openCalibration(): void {
  leaveScreen();
  const c = new Calibration(engine, {
    onApply: (ms) => { updateSettings({ offsetMs: ms }); openSettings(); },
    onCancel: openSettings,
  });
  calibration = c;
  overlay.mount(c.el);
}

function openRecent(): void {
  leaveScreen();
  overlay.showRecent(getLibrary(), {
    onBeforePick: () => void engine.unlock(),
    onFile: (f) => void onFile(f),
    onSample: () => void onTest(),
    onDelete: (e) => { removeSong(e.songHash); openRecent(); },
    onBack: showMenu,
  });
}

// ─── 곡 불러오기 ────────────────────────────────────────────────────────────
async function onTest(): Promise<void> {
  await engine.unlock();
  if (!testTrack) {
    const buffer = createBackingTrack(engine.ctx);
    testTrack = {
      map: SAMPLE_MAP,
      buffer,
      meta: { songHash: SAMPLE_HASH, title: SAMPLE_MAP.title, bpm: SAMPLE_MAP.bpm, duration: buffer.duration },
    };
  }
  track = testTrack;
  await begin();
}

async function onFile(file: File): Promise<void> {
  leaveScreen();
  const token = loadToken;
  overlay.showLoading('곡을 불러오는 중…');
  try {
    if (!engine.ready) await engine.unlock();
    const song = await loadSongFile(engine.ctx, file);
    if (token !== loadToken) return;
    const hash = computeSongHash(song.buffer);

    // 같은 곡을 이전에 분석했다면 캐시된 맵을 바로 쓴다
    let analysis = loadAnalysis(hash);
    if (!analysis) {
      const setProgress = overlay.showAnalyzing(song.title, showMenu);
      job = analyzeSong(song.buffer, { songHash: hash, title: song.title }, setProgress);
      const result = await job.promise;
      if (token !== loadToken) return;
      job = null;
      analysis = { bpm: result.bpm, offset: result.offset, maps: result.maps };
      saveAnalysis(hash, song.title, analysis);
    }
    analyzed = { buffer: song.buffer, title: song.title, hash, analysis };
    showReady();
  } catch (e) {
    if (token !== loadToken) return;
    job = null;
    overlay.showMessage(e instanceof Error ? e.message : '곡을 불러오지 못했어요.', showMenu);
  }
}

function selectTrack(a: Analyzed, difficulty: Difficulty): void {
  track = {
    map: a.analysis.maps[difficulty],
    buffer: a.buffer,
    meta: { songHash: a.hash, title: a.title, bpm: a.analysis.bpm, duration: a.buffer.duration },
  };
}

function showReady(): void {
  const a = analyzed;
  if (!a) return;
  const dur = a.buffer.duration;
  const bpm = a.analysis.bpm;
  overlay.showReady({
    title: a.title,
    info: `${formatDuration(dur)} · ${bpm > 0 ? `BPM ${bpm.toFixed(1)}` : 'BPM 감지 실패'}`,
    options: DIFFICULTIES.map((d) => {
      const n = a.analysis.maps[d].notes.length;
      return { id: d, label: DIFFICULTY_PARAMS[d].label, detail: `${n}노트 · ${(n / dur).toFixed(1)}/s`, playable: n >= 5 };
    }),
    selected: getSettings().difficulty,
    onSelect: (id) => { updateSettings({ difficulty: id as Difficulty }); selectTrack(a, id as Difficulty); },
    onStart: () => void begin(),
    onBack: showMenu,
  });
}

// ─── 플레이 ────────────────────────────────────────────────────────────────
async function begin(): Promise<void> {
  if (!track) return;
  // START 클릭 제스처 안에서 곧바로 오디오 활성화 (모바일 자동재생 제한 대응)
  await engine.unlock();

  const s = getSettings();
  engine.setVolumes(s.musicVolume, s.sfxVolume);

  game?.stop();
  input.reset();
  renderer.reset();
  resumeToken++;

  const t = track;
  const g = new Game(engine, t.map, t.buffer);
  g.offset = s.offsetMs / 1000;
  g.approach = approachFor(s.speed);
  g.events = {
    onJudge: (lane, j, _note, diff) => effects.hit(renderer.layout, lane, j, diff),
    onHoldComplete: (lane) => effects.holdComplete(renderer.layout, lane),
    onFinish: (result) => {
      overlay.setPauseVisible(false);
      const { isNewBest, best } = recordPlay(t.meta, t.map.difficulty, result);
      overlay.showResult({
        result,
        title: t.meta.title,
        difficulty: t.map.difficulty,
        isNewBest,
        best,
        offsetMs: getSettings().offsetMs,
        onApplyOffset: (ms) => updateSettings({ offsetMs: ms }),
        onRetry: () => void begin(),
        onQuit: showMenu,
      });
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
  showPauseMenu(g);
}

function showPauseMenu(g: Game): void {
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
  if (game?.state === 'paused') showPauseMenu(game); // 재개 카운트다운 중이었다면 일시정지 메뉴로 되돌린다
  else void pause();
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
