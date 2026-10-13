import type { Result } from '../game/types';

type Action = { label: string; onClick: () => void; secondary?: boolean };

/** 시작 / 일시정지 / 결과 화면 (DOM 오버레이). 게임 캔버스 위에 덮어씌운다. */
export class Overlay {
  constructor(private readonly root: HTMLElement) {}

  hide(): void {
    this.root.replaceChildren();
  }

  showStart(title: string, onStart: () => void): void {
    this.show([
      h('div', 'logo', 'RHYTHM'),
      h('div', 'sub', title),
      h('div', 'hint', '4개 레인 · 화면 아래를 탭 / 길게 눌러 롱노트\nPC 테스트: D F J K 키'),
    ], [{ label: 'START', onClick: onStart }]);
  }

  showPaused(onResume: () => void, onQuit: () => void): void {
    this.show([h('div', 'title', 'PAUSED')], [
      { label: '계속하기', onClick: onResume },
      { label: '나가기', onClick: onQuit, secondary: true },
    ]);
  }

  showResult(r: Result, title: string, onRetry: () => void, onQuit: () => void): void {
    const rank = h('div', `rank rank-${r.rank}`, r.rank);
    const grid = h('div', 'grid');
    const rows: Array<[string, string]> = [
      ['PERFECT', String(r.counts.perfect)],
      ['GREAT', String(r.counts.great)],
      ['GOOD', String(r.counts.good)],
      ['MISS', String(r.counts.miss)],
      ['MAX COMBO', String(r.maxCombo)],
      ['ACCURACY', `${r.accuracy.toFixed(2)}%`],
    ];
    for (const [k, v] of rows) {
      grid.append(h('span', 'k', k), h('span', 'v', v));
    }
    this.show([
      h('div', 'sub', title),
      rank,
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
    const bar = h('div', 'actions');
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = a.secondary ? 'neon secondary' : 'neon';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      bar.append(b);
    }
    screen.append(bar);
    this.root.replaceChildren(screen);
  }
}

function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
