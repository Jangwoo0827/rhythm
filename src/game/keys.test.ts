import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, assignKey, isAssignable, keyLabel, sanitizeKeys } from './keys';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

describe('키 바인딩', () => {
  it('기본값은 D F J K', () => expect(DEFAULT_KEYS.map(keyLabel)).toEqual(['D', 'F', 'J', 'K']));

  it('빈 레인에 새 키를 배정', () => {
    expect(assignKey(DEFAULT_KEYS, 0, 'KeyA')).toEqual(['KeyA', 'KeyF', 'KeyJ', 'KeyK']);
  });
  it('다른 레인이 쓰던 키를 고르면 서로 교체 (중복 키가 생기지 않는다)', () => {
    const next = assignKey(DEFAULT_KEYS, 0, 'KeyK')!;
    expect(next).toEqual(['KeyK', 'KeyF', 'KeyJ', 'KeyD']);
    expect(new Set(next).size).toBe(4);
  });
  it('같은 레인에 같은 키를 다시 배정해도 그대로', () => {
    expect(assignKey(DEFAULT_KEYS, 1, 'KeyF')).toEqual([...DEFAULT_KEYS]);
  });
  it('Esc 같은 예약 키/이상한 값은 거부', () => {
    expect(assignKey(DEFAULT_KEYS, 0, 'Escape')).toBeNull();
    expect(assignKey(DEFAULT_KEYS, 0, '')).toBeNull();
    expect(assignKey(DEFAULT_KEYS, 0, 'Key D!')).toBeNull();
    expect(assignKey(DEFAULT_KEYS, 4, 'KeyA')).toBeNull();
    expect(isAssignable('Space')).toBe(true);
    expect(isAssignable('Semicolon')).toBe(true);
  });
  it('원본 배열을 바꾸지 않는다', () => {
    const keys = [...DEFAULT_KEYS];
    assignKey(keys, 0, 'KeyK');
    expect(keys).toEqual([...DEFAULT_KEYS]);
  });
  it('저장값 검증: 개수/중복/타입이 틀리면 기본값', () => {
    expect(sanitizeKeys(['KeyA', 'KeyS', 'KeyK', 'KeyL'])).toEqual(['KeyA', 'KeyS', 'KeyK', 'KeyL']);
    expect(sanitizeKeys(['KeyA', 'KeyA', 'KeyK', 'KeyL'])).toEqual([...DEFAULT_KEYS]);
    expect(sanitizeKeys(['KeyA', 'KeyS'])).toEqual([...DEFAULT_KEYS]);
    expect(sanitizeKeys([1, 2, 3, 4])).toEqual([...DEFAULT_KEYS]);
    expect(sanitizeKeys(['Escape', 'KeyS', 'KeyK', 'KeyL'])).toEqual([...DEFAULT_KEYS]);
    expect(sanitizeKeys(null)).toEqual([...DEFAULT_KEYS]);
  });
  it('표시 이름', () => {
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Numpad4')).toBe('Num4');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('IntlRo')).toBe('IntlRo');
  });
  it('설정에 포함되어 정리/기본값이 적용된다', () => {
    expect(DEFAULT_SETTINGS.keys).toEqual([...DEFAULT_KEYS]);
    expect(DEFAULT_SETTINGS.publicShare).toBe(true);
    expect(sanitizeSettings({ keys: ['KeyA', 'KeyS', 'KeyK', 'KeyL'], publicShare: false })).toMatchObject({ keys: ['KeyA', 'KeyS', 'KeyK', 'KeyL'], publicShare: false });
    expect(sanitizeSettings({ keys: 'x', publicShare: 'no' })).toMatchObject({ keys: [...DEFAULT_KEYS], publicShare: true });
  });
});
