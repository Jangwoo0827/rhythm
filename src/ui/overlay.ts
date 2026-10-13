import type { Result } from '../game/types';

type Action = { label: string; onClick: () => void; secondary?: boolean };

/** 메뉴 / 준비 / 일시정지 / 결과 화면과 일시정지 버튼 (DOM 오버레이). 게임 캔버스 위에 덮어씌운다. */
export class Overlay {
  private readonly pauseBtn: HTMLButtonElement;

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
    this.root.replaceChildren();
  }

  /**
   * 시작 메뉴. 파일 선택 버튼을 누르는 순간(사용자 제스처)에 onBeforePick 으로 AudioContext 를 먼저 깨운다.
   */
  showMenu(opts: { onBeforePick: () => void; onFile: (f: File) => void; onTest: () => void }): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac';
    input.hidden = true;
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = ''; // 같은 파일을 다시 골라도 change 가 뜨도록
      if (f) opts.onFile(f);
    });

    const pick = document.createElement('button');
    pick.className = 'neon';
    pick.textContent = '음악 파일 선택';
    pick.addEventListener('click', () => {
      opts.onBeforePick();
      input.click();
    });
    const test = document.createElement('button');
    test.className = 'neon secondary';
    test.textContent = '테스트 곡으로 플레이';
    test.addEventListener('click', opts.onTest);

    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    bar.append(pick, test);
    screen.append(
      h('div', 'logo', 'RHYTHM'),
      h('div', 'sub', '내 음악으로 플레이하세요'),
      h('div', 'hint', '화면 아래 4개 레인을 탭 / 길게 눌러 롱노트\nPC 테스트: D F J K 키'),
      bar,
      input,
    );
    this.root.replaceChildren(screen);
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
  }): void {
    const seg = h('div', 'seg');
    const start = document.createElement('button');
    start.className = 'neon';
    start.textContent = 'START';
    start.addEventListener('click', opts.onStart);

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
    const note = h('div', 'sub error', '');

    const screen = h('div', 'screen');
    const bar = h('div', 'actions');
    const back = document.createElement('button');
    back.className = 'neon secondary';
    back.textContent = '다른 곡 선택';
    back.addEventListener('click', opts.onBack);
    bar.append(start, back);
    screen.append(h('div', 'title song', opts.title), h('div', 'sub', opts.info), seg, note, bar);
    this.root.replaceChildren(screen);
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
    this.root.replaceChildren(screen);
  }

  showResult(r: Result, title: string, onRetry: () => void, onQuit: () => void): void {
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
    this.show([
      h('div', 'sub', title),
      h('div', `rank rank-${r.rank}`, r.rank),
      h('div', 'score', String(r.score).padStart(7, '0')),
      grid,
    ], [
      { label: '다시 하기', onClick: onRetry },
      { label: '처음으로', onClick: onQuit, secondary: true },
    ]);
  }

  private show(content: HTMLElement[], actions: Action[]): void {
    const screen = h('div', 'screen');
    screen.append(...content);
    if (actions.length) {
      const bar = h('div', 'actions');
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = a.secondary ? 'neon secondary' : 'neon';
        b.textContent = a.label;
        b.addEventListener('click', a.onClick);
        bar.append(b);
      }
      screen.append(bar);
    }
    this.root.replaceChildren(screen);
  }
}

function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
