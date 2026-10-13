import type { LeaderboardRow } from '../firebase/online';
import type { Difficulty } from '../game/types';
import { button, h } from './dom';

const LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/** 곡별 리더보드(상위 20위). 난이도 탭을 바꾸면 해당 난이도 기록을 불러온다. */
export function buildLeaderboardScreen(opts: {
  title: string;
  difficulty: Difficulty;
  load: (d: Difficulty) => Promise<LeaderboardRow[]>;
  myUid: () => string | null;
  onBack: () => void;
}): HTMLElement {
  const screen = h('div', 'screen top');
  const tabs = h('div', 'seg tabs');
  const list = h('div', 'scroll list lb');
  let token = 0;

  const show = async (d: Difficulty) => {
    const mine = ++token;
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === d);
    list.replaceChildren(h('div', 'spinner'));
    try {
      const rows = await opts.load(d);
      if (mine !== token) return;
      list.replaceChildren();
      if (rows.length === 0) { list.append(h('div', 'sub', '아직 기록이 없어요. 첫 번째가 되어 보세요!')); return; }
      const me = opts.myUid();
      rows.forEach((r, i) => {
        const row = h('div', r.uid === me ? 'lb-row me' : 'lb-row');
        row.append(
          h('span', 'lb-rank', String(i + 1)),
          h('span', 'lb-name', r.nickname),
          h('span', 'lb-score', r.score.toLocaleString('en-US')),
          h('span', 'lb-sub', `${r.accuracy.toFixed(2)}% · ${r.combo} combo`),
        );
        list.append(row);
      });
    } catch (e) {
      if (mine !== token) return;
      const msg = h('div', 'sub error', e instanceof Error ? e.message : '리더보드를 불러오지 못했어요.');
      list.replaceChildren(msg, button('다시 시도', 'neon secondary small', () => void show(d)));
    }
  };

  for (const d of ['easy', 'normal', 'hard'] as const) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.dataset.id = d;
    b.append(h('span', 'seg-label', LABEL[d]));
    b.addEventListener('click', () => void show(d));
    tabs.append(b);
  }
  const bar = h('div', 'actions');
  bar.append(button('돌아가기', 'neon secondary', opts.onBack));
  screen.append(h('div', 'title', '리더보드'), h('div', 'sub', opts.title), tabs, list, bar);
  void show(opts.difficulty);
  return screen;
}
