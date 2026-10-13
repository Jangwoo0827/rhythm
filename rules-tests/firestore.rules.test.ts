import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const HASH = '0123456789abcdef';
const MAP_ID = `${HASH}_normal`;
let env: RulesTestEnvironment;

const dbOf = (uid: string | null): Firestore =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

const mapData = (over: Record<string, unknown> = {}) => ({
  songHash: HASH, title: 'My Song', bpm: 120, offset: 0.1, difficulty: 'normal',
  notes: [{ t: 1, lane: 0, dur: 0 }, { t: 2, lane: 1, dur: 0.5 }, { t: 3, lane: 2, dur: 0 }],
  uid: 'alice', createdAt: serverTimestamp(), v: 1, ...over,
});
const scoreData = (over: Record<string, unknown> = {}) => ({
  uid: 'alice', mapId: MAP_ID, nickname: 'Alice', score: 900000, accuracy: 95.5, combo: 3,
  time: serverTimestamp(), playedAt: Date.now(), ...over,
});

async function seedMap() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, 'maps', MAP_ID), mapData({ createdAt: Timestamp.now() }));
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rhythm',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('인증', () => {
  it('로그인하지 않으면 아무것도 읽거나 쓸 수 없다', async () => {
    await seedMap();
    const db = dbOf(null);
    await assertFails(getDoc(doc(db, 'maps', MAP_ID)));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData()));
    await assertFails(setDoc(doc(db, 'scores', 's1'), scoreData()));
    await assertFails(setDoc(doc(db, 'users', 'alice'), { nickname: 'x', updatedAt: serverTimestamp() }));
  });
});

describe('users/{uid}', () => {
  const user = (over: Record<string, unknown> = {}) => ({ nickname: 'Alice', updatedAt: serverTimestamp(), ...over });

  it('본인 문서는 읽고 쓸 수 있다 (설정 포함)', async () => {
    const db = dbOf('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), user({ settings: { speed: 6, musicVolume: 0.8, sfxVolume: 0.5, difficulty: 'hard' } })));
    await assertSucceeds(getDoc(doc(db, 'users', 'alice')));
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { nickname: 'Alice2', updatedAt: serverTimestamp() }));
  });
  it('다른 사람의 문서는 읽거나 쓸 수 없다', async () => {
    await assertFails(getDoc(doc(dbOf('bob'), 'users', 'alice')));
    await assertFails(setDoc(doc(dbOf('bob'), 'users', 'alice'), user()));
  });
  it('잘못된 닉네임/필드/설정은 거절한다', async () => {
    const db = dbOf('alice');
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ nickname: '' })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ nickname: 'x'.repeat(17) })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ nickname: 123 })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ admin: true })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ updatedAt: new Date(0) })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ settings: { speed: 99 } })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ settings: { musicVolume: 2 } })));
    await assertFails(setDoc(doc(db, 'users', 'alice'), user({ settings: { hack: 1 } })));
  });
  it('삭제는 불가', async () => {
    const db = dbOf('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), user()));
    await assertFails(deleteDoc(doc(db, 'users', 'alice')));
  });
});

describe('maps/{mapId}', () => {
  it('로그인한 사용자는 읽을 수 있다 (익명 포함)', async () => {
    await seedMap();
    await assertSucceeds(getDoc(doc(dbOf('anon-user'), 'maps', MAP_ID)));
  });
  it('본인 uid 로 올바른 ID 의 맵을 만들 수 있다', async () => {
    await assertSucceeds(setDoc(doc(dbOf('alice'), 'maps', MAP_ID), mapData()));
  });
  it('offset 은 선택 필드', async () => {
    const d: Record<string, unknown> = mapData();
    delete d.offset;
    await assertSucceeds(setDoc(doc(dbOf('alice'), 'maps', MAP_ID), d));
  });
  it('다른 사람 uid 로 만들거나 ID 가 규칙과 다르면 거절', async () => {
    const db = dbOf('alice');
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ uid: 'bob' })));
    await assertFails(setDoc(doc(db, 'maps', `${HASH}_hard`), mapData()));
    await assertFails(setDoc(doc(db, 'maps', 'random-id'), mapData()));
  });
  it('크기/형식 제한: 노트 2500개 초과, 빈 노트, 긴 제목, BPM 범위, 불필요 필드', async () => {
    const db = dbOf('alice');
    const many = Array.from({ length: 2501 }, (_, i) => ({ t: i, lane: 0, dur: 0 }));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ notes: many })));
    await assertSucceeds(setDoc(doc(db, 'maps', MAP_ID), mapData({ notes: many.slice(0, 2500) })));
    await env.clearFirestore();
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ notes: [] })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ notes: 'x'.repeat(100) })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ title: 'x'.repeat(101) })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ title: '' })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ bpm: 1000 })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ difficulty: 'insane' })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ songHash: 'NOT-HEX' })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ extra: 1 })));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ createdAt: new Date(0) })));
  });
  it('생성 후에는 만든 사람도 수정·삭제할 수 없다 (리더보드 기준 맵 불변)', async () => {
    const db = dbOf('alice');
    await assertSucceeds(setDoc(doc(db, 'maps', MAP_ID), mapData()));
    await assertFails(setDoc(doc(db, 'maps', MAP_ID), mapData({ title: 'changed' })));
    await assertFails(updateDoc(doc(db, 'maps', MAP_ID), { title: 'changed' }));
    await assertFails(deleteDoc(doc(db, 'maps', MAP_ID)));
    await assertFails(setDoc(doc(dbOf('bob'), 'maps', MAP_ID), mapData({ uid: 'bob' })));
  });
});

describe('scores/{scoreId}', () => {
  beforeEach(seedMap);

  it('본인 uid, 존재하는 맵, 올바른 값이면 만들 수 있고 읽을 수 있다', async () => {
    await assertSucceeds(setDoc(doc(dbOf('alice'), 'scores', 's1'), scoreData()));
    await assertSucceeds(getDoc(doc(dbOf('bob'), 'scores', 's1')));
  });
  it('다른 사람 uid 로는 만들 수 없다', async () => {
    await assertFails(setDoc(doc(dbOf('bob'), 'scores', 's1'), scoreData({ uid: 'alice' })));
  });
  it('존재하지 않는 맵에는 점수를 만들 수 없다', async () => {
    await assertFails(setDoc(doc(dbOf('alice'), 'scores', 's1'), scoreData({ mapId: `${HASH}_hard` })));
    await assertFails(setDoc(doc(dbOf('alice'), 'scores', 's1'), scoreData({ mapId: 'nonsense' })));
  });
  it('값 범위 검증: 점수 100만 초과, 음수, 정확도 100 초과, 콤보가 노트 수 초과, 소수 점수', async () => {
    const db = dbOf('alice');
    await assertFails(setDoc(doc(db, 'scores', 'a'), scoreData({ score: 1000001 })));
    await assertFails(setDoc(doc(db, 'scores', 'b'), scoreData({ score: -1 })));
    await assertFails(setDoc(doc(db, 'scores', 'c'), scoreData({ score: 12345.5 })));
    await assertFails(setDoc(doc(db, 'scores', 'd'), scoreData({ accuracy: 100.1 })));
    await assertFails(setDoc(doc(db, 'scores', 'e'), scoreData({ combo: 4 }))); // 맵 노트 3개
    await assertSucceeds(setDoc(doc(db, 'scores', 'f'), scoreData({ score: 1000000, accuracy: 100, combo: 3 })));
  });
  it('닉네임/필드/시간 검증', async () => {
    const db = dbOf('alice');
    await assertFails(setDoc(doc(db, 'scores', 'a'), scoreData({ nickname: '' })));
    await assertFails(setDoc(doc(db, 'scores', 'b'), scoreData({ nickname: 'x'.repeat(17) })));
    await assertFails(setDoc(doc(db, 'scores', 'c'), scoreData({ extra: 1 })));
    await assertFails(setDoc(doc(db, 'scores', 'd'), scoreData({ time: Timestamp.fromMillis(1000) }))); // 서버 시각이 아님
    await assertFails(setDoc(doc(db, 'scores', 'e'), scoreData({ playedAt: Date.now() + 3600e3 }))); // 미래
    await assertFails(setDoc(doc(db, 'scores', 'f'), scoreData({ playedAt: Date.now() - 40 * 86400e3 }))); // 너무 과거
    await assertSucceeds(setDoc(doc(db, 'scores', 'g'), scoreData({ playedAt: Date.now() - 7 * 86400e3 }))); // 오프라인 후 동기화
  });
  it('생성만 가능하고 수정·삭제는 본인도 불가', async () => {
    const db = dbOf('alice');
    await assertSucceeds(setDoc(doc(db, 'scores', 's1'), scoreData()));
    await assertFails(updateDoc(doc(db, 'scores', 's1'), { score: 1000000 }));
    await assertFails(setDoc(doc(db, 'scores', 's1'), scoreData({ score: 1000000 })));
    await assertFails(deleteDoc(doc(db, 'scores', 's1')));
  });
});
