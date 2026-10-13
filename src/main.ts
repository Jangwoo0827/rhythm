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
import { online } from './firebase/online';
import { buildShareLink, parseShareHash, parseShareInput } from './firebase/share';
import { buildBrowseScreen } from './ui/browseScreen';
import { buildLeaderboardScreen } from './ui/leaderboardScreen';
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
    ...(online.configured
      ? { online: { onShared: () => openBrowse(), status: () => online.status(), subscribe: (fn: () => void) => online.subscribe(fn) } }
      : {}),
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

/** 공유 맵으로 시작한 경우: 받아 둔 맵과 곡 지문 */
interface SharedCtx { hash: string; analysis: CachedAnalysis }

async function onFile(file: File, shared?: SharedCtx): Promise<void> {
  leaveScreen();
  const token = loadToken;
  overlay.showLoading('곡을 불러오는 중…');
  try {
    if (!engine.ready) await engine.unlock();
    const song = await loadSongFile(engine.ctx, file);
    if (token !== loadToken) return;
    const fileHash = computeSongHash(song.buffer);

    // 공유 맵: 곡 지문이 다르면(다른 인코딩일 수 있음) 사용자에게 확인
    if (shared && fileHash !== shared.hash) {
      const ok = await new Promise<boolean>((resolve) => overlay.showConfirm(
        '곡 지문이 달라요. 같은 곡의 다른 인코딩(mp3/wav 등)이라면 타이밍이 약간 어긋날 수 있어요.\n다른 곡이라면 노트가 전혀 맞지 않아요.\n\n그래도 이 맵으로 플레이할까요?',
        '그래도 사용', '취소', () => resolve(true), () => resolve(false),
      ));
      if (token !== loadToken || !ok) { if (token === loadToken) showMenu(); return; }
    }
    const hash = shared?.hash ?? fileHash;

    // 1) 로컬 캐시 → 2) 온라인에 저장된 맵 → 3) 새로 분석 (분석하면 온라인에 저장)
    let analysis: CachedAnalysis | null = shared?.analysis ?? loadAnalysis(hash);
    if (analysis) {
      online.publishMaps(hash, { title: song.title, duration: song.buffer.duration }); // 아직 온라인에 없으면 올린다 (이미 있으면 건너뜀)
    } else {
      if (online.configured) {
        overlay.showLoading('온라인에서 맵을 확인하는 중…');
        analysis = await online.fetchMaps(hash);
        if (token !== loadToken) return;
        if (analysis) saveAnalysis(hash, song.title, analysis);
      }
      if (!analysis) {
        const setProgress = overlay.showAnalyzing(song.title, showMenu);
        job = analyzeSong(song.buffer, { songHash: hash, title: song.title }, setProgress);
        const result = await job.promise;
        if (token !== loadToken) return;
        job = null;
        analysis = { bpm: result.bpm, offset: result.offset, maps: result.maps };
        saveAnalysis(hash, song.title, analysis);
        online.publishMaps(hash, { title: song.title, duration: song.buffer.duration });
      }
    }
    analyzed = { buffer: song.buffer, title: song.title, hash, analysis };
    showReady();
  } catch (e) {
    if (token !== loadToken) return;
    job = null;
    overlay.showMessage(e instanceof Error ? e.message : '곡을 불러오지 못했어요.', showMenu);
  }
}

// ─── 온라인: 공유 맵 / 리더보드 ──────────────────────────────────────────────
/** 공유 맵 둘러보기: 다른 사람이 올린 곡을 최신순으로 보고 눌러서 불러온다 (ID/링크 불필요) */
function openBrowse(): void {
  leaveScreen();
  overlay.mount(buildBrowseScreen({
    load: (after) => online.listSongs(after),
    onPick: (song) => void loadShared(song.songHash, openBrowse),
    onManual: () => openSharedInput(),
    onBack: showMenu,
  }));
}

function openSharedInput(error = ''): void {
  leaveScreen();
  const screen = overlay.showSharedImport({
    onSubmit: (text) => {
      const target = parseShareInput(text);
      if (!target) return screen.setError('링크나 맵 ID 형식이 올바르지 않아요.');
      void loadShared(target.songHash, () => openSharedInput());
    },
    onBack: openBrowse,
  });
  if (error) screen.setError(error);
}

/** back: 맵을 못 찾았거나 뒤로 갈 때 돌아갈 화면 */
async function loadShared(hash: string, back: () => void = showMenu): Promise<void> {
  leaveScreen();
  const token = loadToken;
  overlay.showLoading('공유된 맵을 불러오는 중…');
  const found = loadAnalysis(hash) ?? (await online.fetchMaps(hash));
  if (token !== loadToken) return;
  if (!found) return overlay.showMessage('맵을 찾을 수 없어요. 오프라인이거나 삭제된 곡일 수 있어요.', back);
  const ctx: SharedCtx = { hash, analysis: found };
  const n = found.maps.normal;
  overlay.showSharedPick(
    { title: n.title, detail: `BPM ${found.bpm > 0 ? found.bpm.toFixed(1) : '-'} · 쉬움 ${found.maps.easy.notes.length} / 보통 ${n.notes.length} / 어려움 ${found.maps.hard.notes.length}노트` },
    { onBeforePick: () => void engine.unlock(), onFile: (f) => void onFile(f, ctx), onBack: back },
  );
}

function openLeaderboard(hash: string, title: string, difficulty: Difficulty, back: () => void): void {
  leaveScreen();
  overlay.mount(buildLeaderboardScreen({
    title,
    difficulty,
    load: (d) => online.leaderboard(hash, d),
    myUid: () => online.myUid(),
    onBack: back,
  }));
}

async function shareSong(a: Analyzed): Promise<void> {
  const url = buildShareLink(location.href, a.hash);
  online.publishMaps(a.hash, { title: a.title, duration: a.buffer.duration });
  try {
    if (navigator.share) { await navigator.share({ title: a.title, text: `Rhythm 맵: ${a.title}`, url }); return; }
    await navigator.clipboard.writeText(url);
    overlay.toast('공유 링크를 복사했어요');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    window.prompt('이 링크를 복사해서 공유하세요', url); // 클립보드를 못 쓰는 환경(http 등)
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
    ...(online.configured
      ? {
          onLeaderboard: () => openLeaderboard(a.hash, a.title, getSettings().difficulty, showReady),
          onShare: () => void shareSong(a),
        }
      : {}),
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
      // 개인 최고 기록일 때만 리더보드에 올린다 (오프라인이면 대기열에 보관했다가 연결되면 자동 업로드)
      const eligible = online.configured && t.meta.songHash !== SAMPLE_HASH;
      if (eligible && isNewBest) online.submitScore(t.meta.songHash, t.map.difficulty, result);
      const back = () => overlay.showResult(resultView);
      const resultView: Parameters<Overlay['showResult']>[0] = {
        result,
        title: t.meta.title,
        difficulty: t.map.difficulty,
        isNewBest,
        best,
        offsetMs: getSettings().offsetMs,
        onApplyOffset: (ms) => updateSettings({ offsetMs: ms }),
        onRetry: () => void begin(),
        onQuit: showMenu,
        ...(eligible
          ? {
              online: {
                note: isNewBest ? '최고 기록은 리더보드에 자동으로 올라가요 (오프라인이면 연결될 때)' : '최고 기록을 넘으면 리더보드에 올라가요',
                onLeaderboard: () => openLeaderboard(t.meta.songHash, t.meta.title, t.map.difficulty, back),
              },
            }
          : {}),
      };
      back();
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

// 오프라인 플레이: 서비스 워커가 앱 파일을 캐시한다 (배포 빌드에서만)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* 등록 실패해도 앱은 동작 */ }); });
}

// 온라인(설정이 있을 때만): 익명 로그인, 대기 중인 업로드 재개, 공유 링크(#/song/<곡지문>) 열기
online.init();
const deepLink = online.configured ? parseShareHash(location.hash) : null;
if (deepLink) {
  history.replaceState(null, '', location.pathname + location.search);
  void loadShared(deepLink.songHash);
}

if (import.meta.env.DEV) {
  // 개발 중 콘솔/자동 테스트용
  Object.assign(window, { __rhythm: { engine, getGame: () => game, getTrack: () => track, renderer, online, overlay } });
}
