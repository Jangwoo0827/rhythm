/** 스크롤·확대·길게 누르기 메뉴·더블탭 줌 등 브라우저 기본 제스처 전부 차단 (CSS touch-action 과 이중 방어). */
export function blockGestures(): void {
  const stop = (e: Event) => e.preventDefault();
  const events = [
    'contextmenu', 'selectstart', 'dragstart', 'dblclick',
    'gesturestart', 'gesturechange', 'gestureend', // iOS Safari 핀치 줌
  ];
  for (const type of events) document.addEventListener(type, stop, { passive: false });
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener(
    'touchstart',
    (e) => { if (e.touches.length > 1) e.preventDefault(); },
    { passive: false },
  );
  // 데스크톱 Ctrl+휠 줌
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}
