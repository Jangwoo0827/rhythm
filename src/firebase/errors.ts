/** Firebase 오류 코드 → 사용자가 무엇을 해야 하는지 알려 주는 안내 문구 */
export function friendlyAuthError(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return '이 사이트 주소가 Firebase 승인된 도메인에 없어요. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 추가해 주세요.';
    case 'auth/operation-not-allowed':
      return 'Firebase 콘솔 → Authentication → 로그인 방법에서 Google(또는 익명) 로그인을 켜 주세요.';
    case 'auth/network-request-failed':
      return '네트워크에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.';
    case 'auth/popup-blocked':
      return '팝업이 차단됐어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요.';
    case 'auth/internal-error':
      return '로그인 창을 열지 못했어요. 네트워크/브라우저 설정(서드파티 쿠키·팝업)을 확인하거나, 승인된 도메인 설정을 확인해 주세요.';
    case 'auth/too-many-requests':
      return '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.';
    case 'auth/user-disabled':
      return '이 계정은 비활성화되어 있어요.';
    default:
      return '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}
