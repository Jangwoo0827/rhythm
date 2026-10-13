import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_STORED_SONGS, clearSongs, deleteSong, loadSong, saveSong, storedHashes, usage } from './songStore';

const blob = (n: number, fill = 1) => new Blob([new Uint8Array(n).fill(fill)], { type: 'audio/mpeg' });
const hash = (i: number) => i.toString(16).padStart(16, '0');

beforeEach(async () => { await clearSongs(); });

describe('곡 저장소 (이 기기 전용)', () => {
  it('저장 → 불러오기가 이름과 내용을 그대로 돌려준다', async () => {
    expect(await saveSong(hash(1), blob(1000, 7), 'My Song.mp3')).toBe(true);
    const f = (await loadSong(hash(1)))!;
    expect(f.name).toBe('My Song.mp3');
    expect(f.size).toBe(1000);
    expect(f.type).toBe('audio/mpeg');
    expect(new Uint8Array(await f.arrayBuffer())[0]).toBe(7);
  });
  it('없는 곡은 null, 삭제하면 사라진다', async () => {
    expect(await loadSong(hash(9))).toBeNull();
    await saveSong(hash(1), blob(10), 'a.mp3');
    await deleteSong(hash(1));
    expect(await loadSong(hash(1))).toBeNull();
  });
  it('저장된 곡 지문 목록과 사용량', async () => {
    await saveSong(hash(1), blob(100), 'a.mp3');
    await saveSong(hash(2), blob(250), 'b.mp3');
    expect([...(await storedHashes())].sort()).toEqual([hash(1), hash(2)]);
    expect(await usage()).toEqual({ count: 2, bytes: 350 });
  });
  it('같은 곡을 다시 저장해도 중복되지 않는다', async () => {
    await saveSong(hash(1), blob(100), 'a.mp3');
    await saveSong(hash(1), blob(100), 'a.mp3');
    expect((await usage()).count).toBe(1);
  });
  it(`${MAX_STORED_SONGS}곡을 넘으면 가장 오래 안 쓴 곡부터 지운다`, async () => {
    for (let i = 0; i < MAX_STORED_SONGS; i++) { await saveSong(hash(i), blob(10), `s${i}.mp3`); await new Promise((r) => setTimeout(r, 2)); }
    await loadSong(hash(0)); // 0번을 최근에 사용 → 1번이 가장 오래된 곡이 된다
    await new Promise((r) => setTimeout(r, 5));
    await saveSong(hash(100), blob(10), 'new.mp3');
    const h = await storedHashes();
    expect(h.size).toBe(MAX_STORED_SONGS);
    expect(h.has(hash(1))).toBe(false);
    expect(h.has(hash(0))).toBe(true);
    expect(h.has(hash(100))).toBe(true);
  });
  it('저장소를 못 쓰는 환경이면 조용히 false/빈 값', async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error 테스트용으로 제거
    delete globalThis.indexedDB;
    try {
      expect(await saveSong(hash(1), blob(10), 'a.mp3')).toBe(false);
      expect(await loadSong(hash(1))).toBeNull();
      expect((await storedHashes()).size).toBe(0);
      expect(await usage()).toEqual({ count: 0, bytes: 0 });
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});
