/** 스크롤·확대·길게 누르기 메뉴·더블탭 줌 등 브라우저 기본 제스처 전부 차단 (CSS touch-action 과 이중 방어). */
export function blockGestures(): void {
  const stop = (e: Event) => e.preventDefault();
  // 입력창(닉네임, 맵 ID 붙여넣기)에서는 길게 눌러 붙여넣기/선택이 가능해야 한다
  const stopUnlessField = (e: Event) => { if (!isField(e.target)) e.preventDefault(); };
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(type, stopUnlessField, { passive: false });
  const events = [
    'dblclick',
    'gesturestart', 'gesturechange', 'gestureend', // iOS Safari 핀치 줌
  ];
  for (const type of events) document.addEventListener(type, stop, { passive: false });
  // 스크롤 영역(.scroll, 곡 목록/설정)만 터치 스크롤을 허용한다
  document.addEventListener(
    'touchmove',
    (e) => { if (!(e.target instanceof Element) || !e.target.closest('.scroll')) e.preventDefault(); },
    { passive: false },
  );
  document.addEventListener(
    'touchstart',
    (e) => { if (e.touches.length > 1) e.preventDefault(); },
    { passive: false },
  );
  // 데스크톱 Ctrl+휠 줌
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}

export function isField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
