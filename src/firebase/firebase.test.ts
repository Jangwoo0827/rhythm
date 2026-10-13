import { beforeEach, describe, expect, it } from 'vitest';
import { readConfig } from './config';
import { friendlyAuthError } from './errors';
import { MAX_NOTES, mapId, mapToDoc, sanitizeMapDoc } from './mapCodec';
import { MAX_ATTEMPTS, Outbox, type OutboxBackend, type ScoreItem } from './outbox';
import { sanitizeNickname } from './profile';
import { buildShareLink, parseShareHash, parseShareInput } from './share';
import type { GameMap } from '../game/types';

const HASH = '0123456789abcdef';

class FakeStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeStorage(), configurable: true });
});

const map = (over: Partial<GameMap> = {}): GameMap => ({
  songHash: HASH, title: 'My Song', bpm: 128.5, offset: 0.25, difficulty: 'normal',
  notes: [{ t: 2, lane: 1, dur: 0 }, { t: 1, lane: 0, dur: 0.5 }], ...over,
});

describe('설정 읽기', () => {
  it('필수 값이 없으면 null (온라인 기능 꺼짐)', () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: 'p' })).toBeNull();
  });
  it('값이 다 있으면 설정을 만든다', () => {
    const c = readConfig({
      VITE_FIREBASE_API_KEY: ' k ', VITE_FIREBASE_AUTH_DOMAIN: 'a.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: 'app',
    })!;
    expect(c.emulator).toBe(false);
    expect(c.firebase).toMatchObject({ apiKey: 'k', projectId: 'p', appId: 'app' });
  });
  it('에뮬레이터 모드는 값 없이도 켜진다', () => {
    const c = readConfig({ VITE_FIREBASE_EMULATOR: '1' })!;
    expect(c.emulator).toBe(true);
    expect(c.firebase.projectId).toBe('demo-rhythm');
  });
});

describe('맵 코덱', () => {
  it('mapId 는 곡 지문_난이도', () => expect(mapId(HASH, 'hard')).toBe(`${HASH}_hard`));

  it('업로드 → 다운로드 왕복 후 정렬된 같은 맵이 된다', () => {
    const m = map();
    const back = sanitizeMapDoc(mapToDoc(m, 'uid1'), { songHash: HASH, difficulty: 'normal' })!;
    expect(back.notes.map((n) => n.t)).toEqual([1, 2]); // t 순 정렬
    expect(back).toMatchObject({ songHash: HASH, title: 'My Song', bpm: 128.5, offset: 0.25, difficulty: 'normal' });
  });

  it('긴 제목은 100자로 자른다', () => {
    expect(mapToDoc(map({ title: 'x'.repeat(300) }), 'u').title).toHaveLength(100);
  });

  const bad: Array<[string, (d: Record<string, unknown>) => void]> = [
    ['곡 지문 형식 오류', (d) => { d.songHash = 'xyz'; }],
    ['난이도 오류', (d) => { d.difficulty = 'insane'; }],
    ['BPM 범위 밖', (d) => { d.bpm = 9999; }],
    ['BPM 이 숫자가 아님', (d) => { d.bpm = '120'; }],
    ['빈 노트', (d) => { d.notes = []; }],
    ['노트 개수 초과', (d) => { d.notes = Array.from({ length: MAX_NOTES + 1 }, (_, i) => ({ t: i, lane: 0, dur: 0 })); }],
    ['레인 범위 밖', (d) => { d.notes = [{ t: 1, lane: 4, dur: 0 }]; }],
    ['레인이 정수가 아님', (d) => { d.notes = [{ t: 1, lane: 1.5, dur: 0 }]; }],
    ['음수 시간', (d) => { d.notes = [{ t: -1, lane: 0, dur: 0 }]; }],
    ['NaN 시간', (d) => { d.notes = [{ t: NaN, lane: 0, dur: 0 }]; }],
    ['너무 긴 롱노트', (d) => { d.notes = [{ t: 1, lane: 0, dur: 99 }]; }],
    ['노트가 객체가 아님', (d) => { d.notes = [1, 2, 3]; }],
    ['제목 없음', (d) => { d.title = ''; }],
  ];
  for (const [name, mutate] of bad) {
    it(`거부: ${name}`, () => {
      const d = mapToDoc(map(), 'u') as unknown as Record<string, unknown>;
      mutate(d);
      expect(sanitizeMapDoc(d)).toBeNull();
    });
  }
  it('기대한 곡/난이도와 다르면 거부', () => {
    const d = mapToDoc(map(), 'u');
    expect(sanitizeMapDoc(d, { songHash: HASH, difficulty: 'hard' })).toBeNull();
    expect(sanitizeMapDoc(d, { songHash: 'f'.repeat(16), difficulty: 'normal' })).toBeNull();
    expect(sanitizeMapDoc(null)).toBeNull();
    expect(sanitizeMapDoc('x')).toBeNull();
  });
});

describe('공유 링크/ID', () => {
  it('링크, 곡 지문, 맵 ID 를 모두 알아본다', () => {
    const link = buildShareLink('https://u.github.io/rhythm/?a=1#old', HASH);
    expect(link).toBe(`https://u.github.io/rhythm/?a=1#/song/${HASH}`);
    expect(parseShareInput(link)).toEqual({ songHash: HASH });
    expect(parseShareInput(`  ${HASH}  `)).toEqual({ songHash: HASH });
    expect(parseShareInput(`${HASH}_hard`)).toEqual({ songHash: HASH, difficulty: 'hard' });
    expect(parseShareInput(`https://x/#/song/${HASH.toUpperCase()}_EASY`)).toEqual({ songHash: HASH, difficulty: 'easy' });
  });
  it('엉뚱한 입력은 null', () => {
    for (const s of ['', '   ', 'hello', '123', `${HASH}0`, `${HASH}_nightmare`, '#/song/zzzz']) {
      expect(parseShareInput(s), s).toBeNull();
    }
  });
  it('location.hash 는 #/song/ 형식만 인정', () => {
    expect(parseShareHash(`#/song/${HASH}`)).toEqual({ songHash: HASH });
    expect(parseShareHash(HASH)).toBeNull();
    expect(parseShareHash('#other')).toBeNull();
  });
});

describe('닉네임', () => {
  it('제어문자 제거, 공백 정리, 16자 제한', () => {
    expect(sanitizeNickname('  a\u0000b\n  c  ')).toBe('ab c');
    expect(sanitizeNickname('x'.repeat(40))).toHaveLength(16);
    expect(sanitizeNickname('   ')).toBe('');
  });
});

// ─── Outbox ────────────────────────────────────────────────────────────────
class FakeBackend implements OutboxBackend {
  uid: string | null = 'u1';
  store = new Map<string, ScoreItem & { uid: string }>();
  createError: { code: string } | null = null;
  creates = 0;
  async ready() { return this.uid; }
  async exists(id: string) { return this.store.has(id); }
  async create(item: ScoreItem, uid: string) {
    this.creates++;
    if (this.createError) throw this.createError;
    this.store.set(item.id, { ...item, uid });
  }
}
const item = (id: string, over: Partial<ScoreItem> = {}): ScoreItem => ({
  id, mapId: `${HASH}_normal`, nickname: 'Tester', score: 900000, accuracy: 95, combo: 100, playedAt: 1000, attempts: 0, ...over,
});

describe('Outbox', () => {
  it('온라인이 아니면 보관하고, 온라인이 되면 순서대로 올린다', async () => {
    const be = new FakeBackend();
    be.uid = null;
    const box = new Outbox(be);
    box.enqueue(item('a')); box.enqueue(item('b'));
    expect(await box.flush()).toMatchObject({ sent: 0, remaining: 2 });
    expect(be.creates).toBe(0);
    be.uid = 'u9';
    expect(await box.flush()).toMatchObject({ sent: 2, remaining: 0 });
    expect([...be.store.keys()]).toEqual(['a', 'b']);
    expect(be.store.get('a')!.uid).toBe('u9'); // 보낼 때의 uid 로 찍힌다 (계정이 바뀌어도 OK)
  });

  it('앱을 다시 열어도(저장소에서 복원) 대기열이 유지된다', async () => {
    const be = new FakeBackend();
    be.uid = null;
    new Outbox(be).enqueue(item('a'));
    const reopened = new Outbox(be);
    expect(reopened.pending).toBe(1);
    be.uid = 'u1';
    await reopened.flush();
    expect(be.store.has('a')).toBe(true);
    expect(new Outbox(be).pending).toBe(0);
  });

  it('일시적 오류(오프라인)는 보관하고 중단한다', async () => {
    const be = new FakeBackend();
    be.createError = { code: 'unavailable' };
    const box = new Outbox(be);
    box.enqueue(item('a')); box.enqueue(item('b'));
    expect(await box.flush()).toMatchObject({ sent: 0, dropped: 0, remaining: 2 });
    expect(be.creates).toBe(1); // 첫 실패에서 중단
    be.createError = null;
    expect(await box.flush()).toMatchObject({ sent: 2, remaining: 0 });
  });

  it('이미 올라간 문서는 다시 만들지 않는다 (재시도 중복 방지)', async () => {
    const be = new FakeBackend();
    be.store.set('a', { ...item('a'), uid: 'u1' });
    const box = new Outbox(be);
    box.enqueue(item('a'));
    expect(await box.flush()).toMatchObject({ sent: 1, remaining: 0 });
    expect(be.creates).toBe(0);
  });

  it('권한 거절은 횟수 제한 재시도 후 버려 대기열이 막히지 않는다', async () => {
    const be = new FakeBackend();
    be.createError = { code: 'permission-denied' };
    const box = new Outbox(be);
    box.enqueue(item('bad')); box.enqueue(item('good'));
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(await box.flush()).toMatchObject({ dropped: 0, remaining: 2 });
    }
    be.createError = null; // 이후 정상화되어도
    expect(await box.flush()).toMatchObject({ remaining: 0 });
    // bad 는 MAX_ATTEMPTS 번째 시도에서 정상 처리되었으므로 그대로 올라간다
    expect(be.store.has('bad')).toBe(true);
  });

  it('권한 거절이 계속되면 버리고 뒤의 항목은 계속 처리한다', async () => {
    const be = new FakeBackend();
    const create = be.create.bind(be);
    be.create = async (it: ScoreItem, uid: string) => {
      if (it.id === 'bad') { be.creates++; throw { code: 'permission-denied' }; }
      return create(it, uid);
    };
    const box = new Outbox(be);
    box.enqueue(item('bad')); box.enqueue(item('good'));
    let last = { sent: 0, dropped: 0, remaining: 0 };
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await box.flush();
    expect(be.store.has('good')).toBe(true);
    expect(be.store.has('bad')).toBe(false);
    expect(box.pending).toBe(0);
    expect(last.remaining).toBe(0);
  });

  it('영구 오류(invalid-argument)는 즉시 버린다', async () => {
    const be = new FakeBackend();
    be.createError = { code: 'invalid-argument' };
    const box = new Outbox(be);
    box.enqueue(item('a'));
    expect(await box.flush()).toMatchObject({ dropped: 1, remaining: 0 });
  });

  it('동시에 flush 해도 한 번만 실행된다', async () => {
    const be = new FakeBackend();
    const box = new Outbox(be);
    box.enqueue(item('a'));
    await Promise.all([box.flush(), box.flush(), box.flush()]);
    expect(be.creates).toBe(1);
  });

  it('저장소가 깨져 있어도 빈 대기열로 시작한다', () => {
    localStorage.setItem('rhythm.outbox.v1', '{broken');
    expect(new Outbox(new FakeBackend()).pending).toBe(0);
    localStorage.setItem('rhythm.outbox.v1', '[1,{"id":3},{"id":"a","mapId":"m"}]');
    expect(new Outbox(new FakeBackend()).pending).toBe(1);
  });

  it('상태가 바뀌면 구독자에게 알린다', () => {
    const box = new Outbox(new FakeBackend());
    let n = 0;
    box.subscribe(() => n++);
    box.enqueue(item('a'));
    expect(n).toBe(1);
  });
});

describe('로그인 오류 안내', () => {
  it('설정 실수는 해결 방법을 알려 준다', () => {
    expect(friendlyAuthError({ code: 'auth/unauthorized-domain' })).toContain('승인된 도메인');
    expect(friendlyAuthError({ code: 'auth/operation-not-allowed' })).toContain('로그인 방법');
    expect(friendlyAuthError({ code: 'auth/popup-blocked' })).toContain('팝업');
  });
  it('알 수 없는 오류/비정상 값도 안전한 문구', () => {
    expect(friendlyAuthError({ code: 'auth/whatever' })).toContain('로그인하지 못했어요');
    expect(friendlyAuthError(null)).toContain('로그인하지 못했어요');
    expect(friendlyAuthError(new Error('x'))).toContain('로그인하지 못했어요');
  });
});
