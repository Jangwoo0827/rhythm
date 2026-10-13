/**
 * 곡 지문(songHash): 디코드된 오디오 데이터에서 계산한다 (파일 이름/메타데이터와 무관).
 * 곡을 64개 구간으로 나눠 구간별 RMS 를 3dB 단위로 양자화한 "에너지 윤곽"을 해시한다.
 * crypto.subtle 은 HTTPS 에서만 쓸 수 있어(LAN http 테스트 불가) 순수 JS 해시(cyrb53 변형)를 쓴다.
 */
const SEGMENTS = 64;

export function computeSongHash(buffer: AudioBuffer): string {
  const data = buffer.getChannelData(0);
  const seg = Math.max(1, Math.floor(data.length / SEGMENTS));
  const features: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const a = s * seg;
    const b = Math.min(data.length, a + seg);
    let sum = 0;
    for (let i = a; i < b; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    // dB → 3dB 단위 정수 (무음은 하한 고정)
    features.push(Math.round(Math.max(-90, 20 * Math.log10(rms + 1e-9)) / 3));
  }
  return hash64(features);
}

function hash64(values: number[]): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const v of values) {
    h1 = Math.imul(h1 ^ (v + 128), 2654435761);
    h2 = Math.imul(h2 ^ (v + 128), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
