/**
 * 화면 레이아웃과 원근 투영.
 * 노트는 깊이(z)를 따라 등속으로 다가온다고 보고 화면 배율 s = 1/z 로 투영한다.
 *   p: 낙하 진행도 (0 = 맨 위에서 생성, 1 = 판정선)
 *   s: 배율 (s0 = 위쪽의 좁은 폭, 1 = 판정선의 전체 폭)
 */
export interface Layout {
  w: number;
  h: number;
  /** 게임 영역(스테이지): 세로 화면 비율을 유지하며 가운데 정렬 */
  sx: number;
  sw: number;
  /** 판정선 y, 소실점 y */
  jy: number;
  vy: number;
  /** 트랙 맨 위(p=0)의 y */
  topY: number;
  s0: number;
  zFar: number;
  /** 하단 터치 패드 영역 */
  padTop: number;
  padBottom: number;
  /** 이 y 이하(아래)의 터치만 입력으로 인정 */
  touchTop: number;
  noteH: number;
}

export function computeLayout(w: number, h: number, safeBottom: number): Layout {
  const sw = Math.min(w, h * 0.62);
  const sx = (w - sw) / 2;
  const jy = h * 0.76;
  const vy = h * 0.05;
  const s0 = 0.3;
  const padBottom = h - Math.max(safeBottom, h * 0.015) - 6;
  return {
    w, h, sx, sw, jy, vy, s0,
    zFar: 1 / s0,
    topY: vy + (jy - vy) * s0,
    padTop: jy + h * 0.02,
    padBottom,
    touchTop: h * 0.5,
    noteH: (sw / 4) * 0.34,
  };
}

/** 낙하 진행도 p → 배율 s */
export function scaleAt(L: Layout, p: number): number {
  const z = Math.max(0.3, L.zFar - (L.zFar - 1) * p);
  return 1 / z;
}

export function yAt(L: Layout, s: number): number {
  return L.vy + (L.jy - L.vy) * s;
}

/** 레인 내부 위치 frac(0=왼쪽 가장자리, 1=오른쪽 가장자리)의 x 좌표 */
export function laneX(L: Layout, lane: number, s: number, frac = 0.5): number {
  return L.sx + L.sw / 2 + (lane - 2 + frac) * ((L.sw * s) / 4);
}

/** 화면 x → 레인 (스테이지를 4등분, 바깥은 가장 가까운 레인으로) */
export function laneFromX(L: Layout, x: number): number {
  const lane = Math.floor(((x - L.sx) / L.sw) * 4);
  return Math.max(0, Math.min(3, lane));
}

export function readSafeBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom, 0px);visibility:hidden';
  document.body.appendChild(probe);
  const v = probe.getBoundingClientRect().height;
  probe.remove();
  return v;
}
