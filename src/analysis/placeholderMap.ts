import type { GameMap, MapNote } from '../game/types';

/**
 * 임시 맵 생성기 (STEP 2 한정): 분석 없이 120 BPM 박자 격자에 노트를 배치한다.
 * 실제 곡의 박자와는 맞지 않는다. STEP 3 의 자동 맵 생성(onset 검출 + BPM 추정)으로 대체된다.
 */
export function generatePlaceholderMap(songHash: string, title: string, duration: number): GameMap {
  const bpm = 120;
  const beat = 60 / bpm;
  let seed = parseInt(songHash.slice(0, 8), 16) >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const notes: MapNote[] = [];
  let prevLane = -1;
  let run = 0;
  const last = duration - 2;
  for (let t = 3; t < last; t += beat) {
    let lane = Math.floor(rand() * 4);
    if (lane === prevLane) {
      // 같은 레인이 3번 연속되지 않게
      if (++run >= 2) { lane = (lane + 1 + Math.floor(rand() * 3)) % 4; run = 0; }
    } else {
      run = 0;
    }
    prevLane = lane;
    const long = rand() < 0.12;
    notes.push({ t, lane, dur: long ? beat * 2 : 0 });
    if (long) t += beat * 2; // 롱노트 동안 다른 노트를 두지 않는다
    else if (rand() < 0.1) notes.push({ t, lane: (lane + 2) % 4, dur: 0 }); // 가끔 동시치기
  }
  return { songHash, title, bpm, difficulty: 'normal', notes };
}
