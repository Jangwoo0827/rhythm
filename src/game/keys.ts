/** PC 키 바인딩: 레인 4개에 키(KeyboardEvent.code)를 하나씩 배정한다. code 는 자판 배열·한/영 상태와 무관하다. */
export const DEFAULT_KEYS: readonly string[] = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];

/** 일시정지 등 앱이 쓰는 키는 레인에 배정할 수 없다 */
const RESERVED = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

const CODE_RE = /^[A-Za-z0-9]{1,20}$/;

export function isAssignable(code: string): boolean {
  return CODE_RE.test(code) && !RESERVED.has(code);
}

/** 저장된(신뢰할 수 없는) 값을 유효한 4개 키로 정리. 하나라도 잘못되거나 중복이면 기본값. */
export function sanitizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 4) return [...DEFAULT_KEYS];
  const keys = raw.map((k) => (typeof k === 'string' ? k : ''));
  if (!keys.every(isAssignable) || new Set(keys).size !== 4) return [...DEFAULT_KEYS];
  return keys;
}

/** lane 에 code 를 배정한다. 이미 다른 레인이 쓰던 키면 두 레인의 키를 서로 바꾼다. 배정할 수 없는 키면 null. */
export function assignKey(keys: readonly string[], lane: number, code: string): string[] | null {
  if (!isAssignable(code) || lane < 0 || lane > 3) return null;
  const next = [...keys];
  const other = next.indexOf(code);
  if (other >= 0 && other !== lane) next[other] = next[lane];
  next[lane] = code;
  return next;
}

/** 화면에 보여 줄 키 이름 */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  const names: Record<string, string> = {
    Space: 'Space', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps',
  };
  return names[code] ?? code;
}
