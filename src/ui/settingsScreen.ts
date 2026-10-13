import {
  OFFSET_LIMIT, SPEED_MAX, SPEED_MIN, approachFor, getSettings, resetSettings, updateSettings,
} from '../game/settings';
import { online } from '../firebase/online';
import { DEFAULT_KEYS, assignKey, keyLabel } from '../game/keys';
import { sanitizeNickname, NICKNAME_MAX } from '../firebase/profile';
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

  list.append(keySection(), accountSection());

  const bar = h('div', 'actions');
  bar.append(
    button('돌아가기', 'neon', opts.onBack),
    button('설정 초기화', 'neon secondary', () => { resetSettings(); opts.rerender(); }),
  );
  screen.append(h('div', 'title', '설정'), list, bar);
  return screen;
}

/** 온라인 계정: 닉네임, 익명 → 구글 연결, 로그아웃, 업로드 대기 상태 */
function accountSection(): HTMLElement {
  const box = h('div', 'setting account');
  const render = () => {
    const st = online.status();
    box.replaceChildren(h('div', 'setting-label', '온라인 계정'));
    if (!st.configured) {
      box.append(h('div', 'setting-hint', '온라인 기능(로그인·맵 공유·리더보드)은 Firebase 설정 후 사용할 수 있어요.\n설정 방법은 docs/FIREBASE.md 를 참고하세요. 게임은 설정 없이도 그대로 플레이할 수 있어요.'));
      return;
    }
    const who = st.signedIn ? (st.anonymous ? '익명 계정으로 연결됨' : `Google 계정: ${st.email ?? ''}`) : '오프라인 (연결되면 자동으로 로그인해요)';
    box.append(h('div', 'setting-hint', who));
    if (st.pending > 0) box.append(h('div', 'setting-hint', `업로드 대기 중인 기록 ${st.pending}개 — 온라인에 연결되면 자동으로 올라가요`));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.maxLength = NICKNAME_MAX;
    input.value = st.nickname;
    input.setAttribute('aria-label', '닉네임');
    input.setAttribute('autocomplete', 'off');
    const msg = h('div', 'setting-hint', '');
    const save = button('닉네임 저장', 'neon secondary small', () => {
      if (!sanitizeNickname(input.value)) { msg.textContent = '닉네임을 입력해 주세요.'; return; }
      input.value = online.updateNickname(input.value);
      msg.textContent = '저장했어요.';
    });
    const row = h('div', 'mini-row');
    row.append(input, save);
    box.append(row);

    const share = button('', 'neon secondary small', () => {
      updateSettings({ publicShare: !getSettings().publicShare });
      paintShare();
    });
    const paintShare = () => {
      share.textContent = `내 곡을 공유 목록에 공개: ${getSettings().publicShare ? 'ON' : 'OFF'}`;
      shareHint.textContent = getSettings().publicShare
        ? '분석한 곡의 제목(파일 이름)·닉네임·노트 수가 "공유 맵" 목록에 올라가요. 음악 파일은 올라가지 않아요.'
        : '목록에는 올리지 않아요. (리더보드를 위해 맵 자체는 저장되고, 링크를 아는 사람은 열 수 있어요.)';
    };
    const shareHint = h('div', 'setting-hint', '');
    paintShare();
    box.append(share, shareHint);

    if (st.signedIn && st.anonymous) {
      box.append(button('Google 계정 연결', 'neon secondary small', async () => {
        msg.textContent = '로그인 창을 여는 중…';
        try {
          const r = await online.linkGoogle();
          msg.textContent = r === 'switched' ? '이미 연결된 계정으로 전환했어요.'
            : r === 'cancelled' ? '취소했어요.' : r === 'redirect' ? '로그인 페이지로 이동해요…' : '연결했어요!';
        } catch (e) {
          msg.textContent = e instanceof Error ? e.message : '연결하지 못했어요.';
        }
      }));
    } else if (st.signedIn) {
      box.append(button('로그아웃', 'neon secondary small', () => {
        msg.textContent = '';
        void online.signOut();
      }));
    }
    box.append(msg);
  };
  render();
  const off = online.subscribe(() => {
    if (!box.isConnected) { off(); return; }
    // 입력 중인 닉네임이 사라지지 않도록, 입력창에 포커스가 있으면 다시 그리지 않는다
    if (!box.contains(document.activeElement)) render();
  });
  return box;
}

/** PC 키 설정: 레인 버튼을 누른 뒤 원하는 키를 누르면 배정. 이미 쓰는 키면 두 레인이 서로 바뀐다. */
function keySection(): HTMLElement {
  const box = h('div', 'setting');
  const msg = h('div', 'setting-hint', '');
  const row = h('div', 'mini-row keys');
  let stopCapture: (() => void) | null = null;

  const render = () => {
    const keys = getSettings().keys;
    row.replaceChildren(...keys.map((code, lane) => {
      const b = document.createElement('button');
      b.className = 'key-btn';
      b.append(h('span', 'key-lane', `레인 ${lane + 1}`), h('span', 'key-name', keyLabel(code)));
      b.addEventListener('click', () => capture(lane, b));
      return b;
    }));
  };

  const capture = (lane: number, btn: HTMLButtonElement) => {
    stopCapture?.();
    btn.classList.add('listening');
    btn.querySelector('.key-name')!.textContent = '키 입력…';
    msg.textContent = '원하는 키를 누르세요 (Esc: 취소)';
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      stopCapture = null;
      render();
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { msg.textContent = ''; return done(); }
      const next = assignKey(getSettings().keys, lane, e.code);
      if (!next) { msg.textContent = '이 키는 쓸 수 없어요. 다른 키를 눌러 주세요.'; return; }
      const swapped = next.filter((k, i) => k !== getSettings().keys[i]).length > 1;
      updateSettings({ keys: next });
      msg.textContent = swapped ? '다른 레인이 쓰던 키라서 두 레인의 키를 서로 바꿨어요.' : '저장했어요.';
      done();
    };
    // 다른 곳을 누르면 취소 (키 버튼 자신을 다시 누르는 경우는 click 핸들러가 새로 시작)
    const onPointer = (e: PointerEvent) => { if (!(e.target instanceof Element && e.target.closest('.key-btn'))) { msg.textContent = ''; done(); } };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    stopCapture = done;
  };

  const reset = button('기본값 (D F J K)', 'neon secondary small', () => {
    stopCapture?.();
    updateSettings({ keys: [...DEFAULT_KEYS] });
    msg.textContent = '기본값으로 되돌렸어요.';
    render();
  });
  box.append(
    h('div', 'setting-label', 'PC 키 설정'),
    h('div', 'setting-hint', '키보드로 플레이할 때 쓰는 키예요 (레인 1~4 = 왼쪽 → 오른쪽).\n한/영 상태와 상관없이 자판 위치 기준으로 동작해요.'),
    row, reset, msg,
  );
  render();
  return box;
}
