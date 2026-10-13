import { h } from './dom';

export interface StepperOptions {
  label: string;
  hint?: string;
  get: () => number;
  /** 값을 적용하고 실제 저장된(보정된) 값을 반환 */
  set: (v: number) => number;
  format: (v: number) => string;
  /** 음수 → 양수 순서의 증감 버튼 */
  steps: Array<{ label: string; delta: number }>;
}

/**
 * − / + 버튼 입력. 터치 슬라이더는 앱 전체의 touchmove 차단(스크롤·확대 방지)과 충돌하므로 쓰지 않는다.
 * 버튼을 길게 누르면 반복 입력된다.
 */
export function stepper(o: StepperOptions): HTMLElement {
  const wrap = h('div', 'setting');
  wrap.append(h('div', 'setting-label', o.label));
  if (o.hint) wrap.append(h('div', 'setting-hint', o.hint));
  const row = h('div', 'stepper');
  const value = h('div', 'stepper-value');
  const refresh = () => { value.textContent = o.format(o.get()); };

  const makeBtn = (label: string, delta: number) => {
    const b = document.createElement('button');
    b.className = 'step-btn';
    b.textContent = label;
    let timer: number | undefined;
    const apply = () => { o.set(o.get() + delta); refresh(); };
    const stop = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const repeat = (delay: number) => { timer = window.setTimeout(() => { apply(); repeat(70); }, delay); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); apply(); repeat(420); });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, stop);
    b.addEventListener('click', (e) => { if (e.detail === 0) apply(); }); // 키보드 접근
    return b;
  };

  const neg = o.steps.filter((s) => s.delta < 0);
  const pos = o.steps.filter((s) => s.delta > 0);
  row.append(...neg.map((s) => makeBtn(s.label, s.delta)), value, ...pos.map((s) => makeBtn(s.label, s.delta)));
  wrap.append(row);
  refresh();
  return wrap;
}
