/** 업로드한 음악 파일을 AudioBuffer 로 디코드한다. */

/** 모바일 메모리 보호용 길이 제한(초) */
export const MAX_DURATION = 12 * 60;

export interface LoadedSong {
  buffer: AudioBuffer;
  title: string;
}

export async function loadSongFile(ctx: AudioContext, file: File): Promise<LoadedSong> {
  const data = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await decode(ctx, data);
  } catch {
    throw new Error('이 파일은 재생할 수 없어요. mp3 / m4a / wav / ogg 파일인지 확인해 주세요.');
  }
  if (buffer.duration > MAX_DURATION) {
    throw new Error(`곡이 너무 길어요 (최대 ${MAX_DURATION / 60}분).`);
  }
  if (buffer.duration < 5) {
    throw new Error('곡이 너무 짧아요 (최소 5초).');
  }
  return { buffer, title: file.name.replace(/\.[^.]+$/, '') };
}

/** 구형 Safari(콜백 전용 decodeAudioData)까지 대응 */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p) p.then(resolve, reject);
  });
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
