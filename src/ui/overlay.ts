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

  /** 곡 준비 완료. START 클릭이 AudioContext 활성화 제스처가 된다. */
  showReady(title: string, info: string, onStart: () => void, onBack: () => void): void {
    this.show([
      h('div', 'title song', title),
      h('div', 'sub', info),
    ], [
      { label: 'START', onClick: onStart },
      { label: '다른 곡 선택', onClick: onBack, secondary: true },
    ]);
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
