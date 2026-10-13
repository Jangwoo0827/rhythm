import type { BestScore, SongEntry } from '../game/library';
import { SAMPLE_HASH } from '../game/library';
import type { Difficulty, Result } from '../game/types';
import type { OnlineStatus } from '../firebase/online';
import { button, fileInput, h } from './dom';

type Action = { label: string; onClick: () => void; secondary?: boolean };

const DIFF_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/** 메뉴 / 곡 목록 / 준비 / 일시정지 / 결과 화면과 일시정지 버튼 (DOM 오버레이). 게임 캔버스 위에 덮어씌운다. */
export class Overlay {
  private readonly pauseBtn: HTMLButtonElement;
  private subs: Array<() => void> = [];

  constructor(private readonly root: HTMLElement, onPause: () => void) {
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pause-btn';
    this.pauseBtn.setAttribute('aria-label', '일시정지');
    this.pauseBtn.textContent = '❚❚';
    this.pauseBtn.hidden = true;
    this.pauseBtn.addEventListener('click', onPause);
    document.body.appendChild(this.pauseBtn);
  }

  setPauseVisible(v: boolean): void {
    this.pauseBtn.hidden = !v;
  }

  hide(): void {
    this.setScreen();
  }

  /** 화면 교체. 이전 화면의 구독(온라인 상태 표시 등)을 정리한다. */
  private setScreen(...children: HTMLElement[]): void {
    for (const off of this.subs) off();
    this.subs = [];
    this.root.replaceChildren(...children);
  }

  /** 잠깐 떴다 사라지는 안내 메시지 */
  toast(text: string): void {
    const el = h('div', 'toast', text);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /** 외부에서 만든 화면(설정, 보정 등)을 표시 */
  mount(el: HTMLElement): void {
    this.setScreen(el);
  }

  /**
   * 시작 메뉴. 파일 선택 버튼을 누르는 순간(사용자 제스처)에 onBeforePick 으로 AudioContext 를 먼저 깨운다.
   */
  showMenu(opts: {
    onBeforePick: () => void;
    onFile: (f: File) => void;
    onRecent: () => void;
    onTest: () => void;
    onSettings: () => void;
    /** 온라인 기능이 설정된 경우에만 전달 */
    online?: { onShared: () => void; status: () => OnlineStatus; subscribe: (fn: () => void) => () => void };
  }): void {
    const input = fileInput(opts.onFile);
    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    bar.append(
      button('음악 파일 선택', 'neon', () => { opts.onBeforePick(); input.click(); }),
      button('최근 플레이한 곡', 'neon secondary', opts.onRecent),
    );
    if (opts.online) bar.append(button('공유 맵 불러오기', 'neon secondary', opts.online.onShared));
    bar.append(
      button('테스트 곡으로 플레이', 'neon secondary', opts.onTest),
      button('⚙ 설정', 'neon secondary', opts.onSettings),
    );
    const status = h('div', 'online-status');
    const refresh = () => { if (opts.online) status.textContent = describeStatus(opts.online.status()); };
    refresh();
    screen.append(
      h('div', 'logo', 'RHYTHM'),
      h('div', 'sub', '내 음악으로 플레이하세요'),
      status,
      h('div', 'hint', '화면 아래 4개 레인을 탭 / 길게 눌러 롱노트\nPC 테스트: D F J K 키'),
      bar,
      input,
    );
    this.setScreen(screen);
    // 구독은 화면 교체(setScreen 이 이전 구독을 정리함) 이후에 등록한다
    if (opts.online) this.subs.push(opts.online.subscribe(refresh));
  }

  /** 최근 플레이한 곡. 곡 파일은 저장하지 않으므로 항목을 누르면 같은 파일을 다시 고르게 한다. */
  showRecent(
    entries: SongEntry[],
    opts: {
      onBeforePick: () => void;
      onFile: (f: File) => void;
      onSample: () => void;
      onDelete: (e: SongEntry) => void;
      onBack: () => void;
    },
  ): void {
    const input = fileInput(opts.onFile);
    const screen = h('div', 'screen top');
    const list = h('div', 'scroll list');

    if (entries.length === 0) list.append(h('div', 'sub', '아직 플레이한 곡이 없어요.'));
    for (const e of entries) {
      const row = h('div', 'row');
      row.setAttribute('role', 'button');
      row.addEventListener('click', () => {
        if (e.songHash === SAMPLE_HASH) return opts.onSample();
        opts.onBeforePick();
        input.click();
      });
      const main = h('div', 'row-main');
      main.append(
        h('div', 'row-title', e.title),
        h('div', 'row-meta', `${e.bpm > 0 ? `BPM ${e.bpm.toFixed(0)} · ` : ''}${fmtTime(e.duration)} · ${e.plays}회 · ${formatAgo(e.lastPlayed)}`),
      );
      const chips = h('div', 'chips');
      for (const d of ['easy', 'normal', 'hard'] as const) chips.append(chip(DIFF_LABEL[d], e.best[d]));
      main.append(chips);
      const del = button('✕', 'row-del', () => opts.onDelete(e));
      del.setAttribute('aria-label', '목록에서 삭제');
      del.addEventListener('click', (ev) => ev.stopPropagation());
      row.append(main, del);
      list.append(row);
    }

    const bar = h('div', 'actions');
    bar.append(button('돌아가기', 'neon secondary', opts.onBack));
    screen.append(
      h('div', 'title', '최근 플레이한 곡'),
      h('div', 'hint', '곡 파일은 저장되지 않아요.\n항목을 누르고 같은 파일을 다시 고르면 분석 없이 바로 시작해요.'),
      list,
      bar,
      input,
    );
    this.setScreen(screen);
  }

  showLoading(text: string): void {
    this.show([h('div', 'spinner'), h('div', 'sub', text)], []);
  }

  showMessage(text: string, onBack: () => void): void {
    this.show([h('div', 'sub error', text)], [{ label: '돌아가기', onClick: onBack }]);
  }

  /** 분석 진행률 화면. 반환된 함수로 진행률(0~1)을 갱신한다. */
  showAnalyzing(title: string, onCancel: () => void): (p: number) => void {
    const fill = h('div', 'bar-fill');
    const bar = h('div', 'bar');
    bar.append(fill);
    const pct = h('div', 'sub', '0%');
    this.show([
      h('div', 'title song', title),
      h('div', 'sub', '박자와 노트를 분석하는 중…'),
      bar,
      pct,
    ], [{ label: '취소', onClick: onCancel, secondary: true }]);
    return (p) => {
      const v = Math.max(0, Math.min(1, p));
      fill.style.width = `${(v * 100).toFixed(1)}%`;
      pct.textContent = `${Math.round(v * 100)}%`;
    };
  }

  /** 곡 준비 완료 + 난이도 선택. START 클릭이 AudioContext 활성화 제스처가 된다. */
  showReady(opts: {
    title: string;
    info: string;
    options: Array<{ id: string; label: string; detail: string; playable: boolean }>;
    selected: string;
    onSelect: (id: string) => void;
    onStart: () => void;
    onBack: () => void;
    /** 온라인 기능이 켜진 경우에만 전달 */
    onLeaderboard?: () => void;
    onShare?: () => void;
  }): void {
    const seg = h('div', 'seg');
    const start = button('START', 'neon', opts.onStart);
    const note = h('div', 'sub error', '');

    const select = (id: string) => {
      for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === id);
      const o = opts.options.find((x) => x.id === id);
      start.disabled = !o?.playable;
      note.textContent = o && !o.playable ? '노트가 너무 적어요. 다른 난이도를 선택하거나 다른 곡을 골라 주세요.' : '';
      opts.onSelect(id);
    };
    for (const o of opts.options) {
      const b = document.createElement('button');
      b.dataset.id = o.id;
      b.className = 'seg-btn';
      b.append(h('span', 'seg-label', o.label), h('span', 'seg-detail', o.detail));
      b.addEventListener('click', () => select(o.id));
      seg.append(b);
    }

    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    const online = h('div', 'mini-row');
    if (opts.onLeaderboard) online.append(button('🏆 리더보드', 'neon secondary small', opts.onLeaderboard));
    if (opts.onShare) online.append(button('🔗 맵 공유', 'neon secondary small', opts.onShare));
    bar.append(start, button('다른 곡 선택', 'neon secondary', opts.onBack));
    screen.append(h('div', 'title song', opts.title), h('div', 'sub', opts.info), seg, note, online, bar);
    this.setScreen(screen);
    select(opts.selected);
  }

  showPaused(onResume: () => void, onRestart: () => void, onQuit: () => void): void {
    this.show([h('div', 'title', 'PAUSED')], [
      { label: '계속하기', onClick: onResume },
      { label: '처음부터', onClick: onRestart, secondary: true },
      { label: '나가기', onClick: onQuit, secondary: true },
    ]);
  }

  /** 재개 전 카운트다운 숫자 (입력은 막는다) */
  showCount(n: number): void {
    const screen = h('div', 'screen clear');
    screen.append(h('div', 'count', String(n)));
    this.setScreen(screen);
  }

  showResult(o: {
    result: Result;
    title: string;
    difficulty: Difficulty;
    isNewBest: boolean;
    best: BestScore | null;
    offsetMs: number;
    onApplyOffset: (newOffsetMs: number) => void;
    onRetry: () => void;
    onQuit: () => void;
    /** 온라인 저장 대상 곡일 때만 */
    online?: { note: string; onLeaderboard: () => void };
  }): void {
    const r = o.result;
    const grid = h('div', 'grid');
    const rows: Array<[string, string]> = [
      ['PERFECT', String(r.counts.perfect)],
      ['GREAT', String(r.counts.great)],
      ['GOOD', String(r.counts.good)],
      ['MISS', String(r.counts.miss)],
      ['MAX COMBO', String(r.maxCombo)],
      ['ACCURACY', `${r.accuracy.toFixed(2)}%`],
    ];
    for (const [k, v] of rows) grid.append(h('span', 'k', k), h('span', 'v', v));

    const content: HTMLElement[] = [
      h('div', 'sub', `${o.title} · ${DIFF_LABEL[o.difficulty]}`),
      h('div', `rank rank-${r.rank}`, r.rank),
    ];
    if (o.isNewBest) content.push(h('div', 'badge', 'NEW BEST'));
    content.push(h('div', 'score', String(r.score).padStart(7, '0')));
    if (!o.isNewBest && o.best) content.push(h('div', 'hint', `최고 기록 ${String(o.best.score).padStart(7, '0')}`));
    content.push(grid);

    // 평균 타이밍이 한쪽으로 치우쳐 있으면 오프셋 보정을 제안
    const avg = r.avgTimingMs;
    if (r.timedHits >= 20 && Math.abs(avg) >= 8) {
      const next = Math.max(-300, Math.min(300, o.offsetMs + avg));
      const tip = h('div', 'timing', `평균 타이밍 ${avg > 0 ? '+' : ''}${avg}ms — ${avg > 0 ? '늦게' : '빠르게'} 치는 경향이에요`);
      const apply = button(`오프셋 ${o.offsetMs} → ${next}ms 적용`, 'neon secondary small', () => {
        o.onApplyOffset(next);
        apply.disabled = true;
        apply.textContent = '적용됨 (다음 플레이부터)';
      });
      content.push(tip, apply);
    }

    if (o.online) {
      content.push(h('div', 'hint', o.online.note), button('🏆 리더보드', 'neon secondary small', o.online.onLeaderboard));
    }

    this.show(content, [
      { label: '다시 하기', onClick: o.onRetry },
      { label: '처음으로', onClick: o.onQuit, secondary: true },
    ]);
  }

  /** 공유 맵 불러오기: 링크 또는 맵 ID 입력 */
  showSharedImport(opts: { onSubmit: (text: string) => void; onBack: () => void }): { setError: (msg: string) => void } {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.placeholder = '공유 링크 또는 맵 ID';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.spellcheck = false;
    const error = h('div', 'sub error', '');
    const submit = () => opts.onSubmit(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    bar.append(button('불러오기', 'neon', submit), button('돌아가기', 'neon secondary', opts.onBack));
    screen.append(
      h('div', 'title', '공유 맵 불러오기'),
      h('div', 'hint', '친구가 보내 준 링크나 맵 ID를 붙여 넣으세요.\n곡 파일은 각자 가지고 있는 것을 선택해요.'),
      input, error, bar,
    );
    this.setScreen(screen);
    return { setError: (msg) => { error.textContent = msg; } };
  }

  /** 공유 맵을 찾았을 때: 같은 곡 파일을 고르게 한다 */
  showSharedPick(info: { title: string; detail: string }, opts: { onBeforePick: () => void; onFile: (f: File) => void; onBack: () => void }): void {
    const input = fileInput(opts.onFile);
    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    bar.append(
      button('곡 파일 선택', 'neon', () => { opts.onBeforePick(); input.click(); }),
      button('돌아가기', 'neon secondary', opts.onBack),
    );
    screen.append(
      h('div', 'title song', info.title),
      h('div', 'sub', info.detail),
      h('div', 'hint', '맵을 찾았어요! 이 곡의 음악 파일을 선택하세요.\n같은 곡이어야 노트가 박자에 맞아요.'),
      bar, input,
    );
    this.setScreen(screen);
  }

  showConfirm(text: string, yes: string, no: string, onYes: () => void, onNo: () => void): void {
    this.show([h('div', 'sub', text)], [
      { label: yes, onClick: onYes },
      { label: no, onClick: onNo, secondary: true },
    ]);
  }

  private show(content: HTMLElement[], actions: Action[]): void {
    const screen = h('div', 'screen');
    screen.append(...content);
    if (actions.length) {
      const bar = h('div', 'actions');
      for (const a of actions) bar.append(button(a.label, a.secondary ? 'neon secondary' : 'neon', a.onClick));
      screen.append(bar);
    }
    this.setScreen(screen);
  }
}

function chip(label: string, best?: BestScore): HTMLElement {
  const el = h('span', best ? 'chip' : 'chip empty');
  el.append(h('span', 'chip-label', label));
  if (best) el.append(h('span', `chip-rank rank-${best.rank}`, best.rank), h('span', 'chip-score', best.score.toLocaleString('en-US')));
  else el.append(h('span', 'chip-score', '-'));
  return el;
}

function fmtTime(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export function formatAgo(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  return d < 30 ? `${d}일 전` : new Date(ts).toLocaleDateString('ko-KR');
}

export function describeStatus(st: OnlineStatus): string {
  if (!st.configured) return '';
  const who = st.signedIn ? (st.anonymous ? '익명' : (st.email ?? 'Google')) : '오프라인';
  const pending = st.pending > 0 ? ` · 업로드 대기 ${st.pending}` : '';
  return `${st.signedIn ? '☁' : '○'} ${st.nickname} (${who})${pending}`;
}
