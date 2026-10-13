import { formatAgo } from './overlay';
import type { SongInfo } from '../firebase/songCodec';
import { button, h } from './dom';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 곡 지문에서 정한 색으로 만든 썸네일 (앨범 이미지는 저장하지 않으므로 곡마다 고유한 색 + 레인 무늬) */
function thumb(hash: string): HTMLElement {
  const hue = parseInt(hash.slice(0, 4), 16) % 360;
  const el = h('div', 'song-thumb');
  el.style.background = `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 70) % 360} 75% 35%))`;
  for (let i = 0; i < 4; i++) {
    const bar = h('span', 'thumb-bar');
    bar.style.height = `${25 + (parseInt(hash.slice(4 + i * 2, 6 + i * 2), 16) % 60)}%`;
    el.append(bar);
  }
  return el;
}

/**
 * 공유 맵 둘러보기 (Rhythm Plus 의 Latest 목록처럼): 다른 사람이 올린 곡을 최신순으로 보여 주고,
 * 항목을 누르면 맵을 받아 같은 곡 파일을 고르게 한다. ID/링크 없이도 쓸 수 있다.
 */
export function buildBrowseScreen(opts: {
  load: (after?: number) => Promise<{ rows: SongInfo[]; next: number | null }>;
  onPick: (song: SongInfo) => void;
  onManual: () => void;
  onBack: () => void;
}): HTMLElement {
  const screen = h('div', 'screen top');
  const list = h('div', 'scroll list');
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'text-input search';
  search.placeholder = '제목·만든 사람 검색';
  search.setAttribute('autocomplete', 'off');
  const status = h('div', 'sub', '');

  let rows: SongInfo[] = [];
  let next: number | null = null;
  let loading = false;
  let failed = '';

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.mapper.toLowerCase().includes(q)) : rows;
    list.replaceChildren();
    for (const r of shown) {
      const row = h('div', 'row song-row');
      row.setAttribute('role', 'button');
      row.addEventListener('click', () => opts.onPick(r));
      const main = h('div', 'row-main');
      main.append(
        h('div', 'row-title', r.title),
        h('div', 'row-meta', `Mapped by ${r.mapper} · ${formatAgo(r.createdAt)}`),
        h('div', 'row-meta', `${mmss(r.duration)} · BPM ${r.bpm > 0 ? Math.round(r.bpm) : '-'} · 쉬움 ${r.counts.easy} / 보통 ${r.counts.normal} / 어려움 ${r.counts.hard}`),
      );
      row.append(thumb(r.songHash), main);
      list.append(row);
    }
    if (failed) list.append(h('div', 'sub error', failed));
    else if (!loading && shown.length === 0) {
      list.append(h('div', 'sub', rows.length === 0 ? '아직 공유된 곡이 없어요. 곡을 분석하면 여기에 올라가요!' : '검색 결과가 없어요.'));
    }
    if (loading) list.append(h('div', 'spinner'));
    else if (next !== null) list.append(button('더 보기', 'neon secondary small', () => void load(next ?? undefined)));
    else if (failed) list.append(button('다시 시도', 'neon secondary small', () => void load(rows.length ? next ?? undefined : undefined)));
  };

  const load = async (after?: number) => {
    if (loading) return;
    loading = true;
    failed = '';
    render();
    try {
      const page = await opts.load(after);
      rows = after === undefined ? page.rows : [...rows, ...page.rows.filter((p) => !rows.some((r) => r.songHash === p.songHash))];
      next = page.next;
    } catch (e) {
      failed = e instanceof Error ? e.message : '목록을 불러오지 못했어요.';
    }
    loading = false;
    render();
  };

  search.addEventListener('input', render);
  const bar = h('div', 'actions');
  bar.append(button('링크·ID로 불러오기', 'neon secondary', opts.onManual), button('돌아가기', 'neon secondary', opts.onBack));
  screen.append(h('div', 'title', '공유 맵'), h('div', 'hint', '다른 사람이 분석해서 올린 곡이에요. 곡을 누르고 같은 음악 파일을 선택하면 분석 없이 바로 시작해요.'), search, status, list, bar);
  void load();
  return screen;
}
