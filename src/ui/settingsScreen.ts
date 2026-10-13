import {
  OFFSET_LIMIT, SPEED_MAX, SPEED_MIN, approachFor, getSettings, resetSettings, updateSettings,
} from '../game/settings';
import { button, h } from './dom';
import { stepper } from './stepper';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${v} ms`;

export function buildSettingsScreen(opts: { onCalibrate: () => void; onBack: () => void; rerender: () => void }): HTMLElement {
  const screen = h('div', 'screen top');
  const list = h('div', 'scroll settings');

  list.append(
    stepper({
      label: '노트 속도',
      hint: '높을수록 노트가 빠르게 떨어져요',
      get: () => getSettings().speed,
      set: (v) => updateSettings({ speed: Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) }).speed,
      format: (v) => `${v}  (${approachFor(v).toFixed(2)}초)`,
      steps: [{ label: '−', delta: -1 }, { label: '+', delta: 1 }],
    }),
    stepper({
      label: '판정 오프셋',
      hint: '소리보다 노트가 먼저 도착하는 느낌이면 +, 늦게 느껴지면 −\n블루투스 이어폰은 지연이 커서 +값이 필요한 경우가 많아요 (기기마다 달라요)',
      get: () => getSettings().offsetMs,
      set: (v) => updateSettings({ offsetMs: Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, v)) }).offsetMs,
      format: signed,
      steps: [
        { label: '−10', delta: -10 }, { label: '−1', delta: -1 },
        { label: '+1', delta: 1 }, { label: '+10', delta: 10 },
      ],
    }),
    button('메트로놈으로 오프셋 자동 보정', 'neon', opts.onCalibrate),
    stepper({
      label: '음악 볼륨',
      get: () => getSettings().musicVolume,
      set: (v) => updateSettings({ musicVolume: Math.round(v * 10) / 10 }).musicVolume,
      format: pct,
      steps: [{ label: '−', delta: -0.1 }, { label: '+', delta: 0.1 }],
    }),
    stepper({
      label: '효과음 볼륨',
      get: () => getSettings().sfxVolume,
      set: (v) => updateSettings({ sfxVolume: Math.round(v * 10) / 10 }).sfxVolume,
      format: pct,
      steps: [{ label: '−', delta: -0.1 }, { label: '+', delta: 0.1 }],
    }),
  );

  const bar = h('div', 'actions');
  bar.append(
    button('돌아가기', 'neon', opts.onBack),
    button('설정 초기화', 'neon secondary', () => { resetSettings(); opts.rerender(); }),
  );
  screen.append(h('div', 'title', '설정'), list, bar);
  return screen;
}
