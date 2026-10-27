/** Firebase 오류 코드를 사용자에게 보여 줄 한국어 메시지로 바꾼다. */
export function friendlyError(e) {
  const code = e?.code || '';
  const map = {
    'permission-denied': '권한이 없습니다. 캘린더 역할을 확인하세요.',
    'unauthenticated': '로그인이 만료되었습니다. 다시 로그인하세요.',
    'unavailable': '서버에 연결할 수 없습니다. 네트워크 상태를 확인하세요.',
    'deadline-exceeded': '요청 시간이 초과되었습니다. 다시 시도하세요.',
    'not-found': '대상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
    'failed-precondition': '현재 상태에서 처리할 수 없습니다. 새로고침 후 다시 시도하세요.',
    'resource-exhausted': '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
    'auth/network-request-failed': '네트워크 오류로 로그인하지 못했습니다.',
    'auth/unauthorized-domain': '이 도메인은 Firebase 인증에 등록되지 않았습니다(승인된 도메인 설정 필요).',
    'auth/operation-not-allowed': 'Google 로그인이 꺼져 있습니다. Firebase 콘솔 > Authentication > 로그인 방법에서 Google 을 사용 설정하세요.',
    'auth/web-storage-unsupported': '브라우저가 로그인 정보를 저장할 수 없습니다. 개인정보 보호 브라우징(시크릿 모드)을 끄고 다시 시도하세요.',
    'auth/internal-error': '로그인 중 오류가 났습니다. 잠시 후 다시 시도하세요.',
    'auth/cancelled-popup-request': '로그인 창이 이미 열려 있습니다.',
    'auth/redirect-cancelled-by-user': '로그인이 취소되었습니다.',
    'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
    'app/already-member': '이미 이 캘린더의 멤버입니다.',
    'app/already-invited': '이미 같은 역할로 초대 중인 사용자입니다.',
    'app/self-invite': '자기 자신은 초대할 수 없습니다.',
    'app/invalid-email': '올바른 이메일 주소를 입력하세요.',
    'app/not-shared': '개인 캘린더는 초대할 수 없습니다. 먼저 공유 캘린더로 전환하세요.',
    'app/already-subscribed': '이미 구독 중인 캘린더입니다.',
    'app/self-subscribe': '같은 캘린더는 구독할 수 없습니다.',
    'app/no-access': '해당 캘린더에 접근 권한이 없습니다.',
    'app/link-invalid': '초대 링크가 올바르지 않거나 취소되었습니다. 초대한 사람에게 새 링크를 받아 주세요.',
    'app/link-expired': '초대 링크의 유효 기간이 지났습니다. 초대한 사람에게 새 링크를 받아 주세요.',
    'app/login-cancelled': '로그인을 취소했어요.',
    'app/native-login': '로그인 창에서 문제가 생겼어요. 다시 시도해 주세요.',
    'app/invalid-feed': '캘린더 링크는 https:// 또는 webcal:// 로 시작해야 합니다.',
    'app/has-members': '다른 멤버가 있는 캘린더는 개인 캘린더로 바꿀 수 없습니다.',
  };
  const text = map[code] || e?.message || '알 수 없는 오류가 발생했습니다.';
  // 로그인 오류는 원인을 찾기 쉽게 코드도 함께 보여 준다.
  return code.startsWith('auth/') ? `${text} (${code})` : text;
}

export function appError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}
