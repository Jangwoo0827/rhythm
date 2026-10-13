/** 작은 DOM 헬퍼 */
export function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** 숨겨진 파일 입력. 선택한 파일을 onFile 로 넘긴다 (같은 파일을 다시 골라도 동작). */
export function fileInput(onFile: (f: File) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac';
  input.hidden = true;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) onFile(f);
  });
  return input;
}
