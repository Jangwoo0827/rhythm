/** Firebase 설정은 .env(VITE_FIREBASE_*) 에서 읽는다. 설정이 없으면 온라인 기능만 꺼지고 앱은 정상 동작한다. */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
}

export interface OnlineConfig {
  firebase: FirebaseConfig;
  /** VITE_FIREBASE_EMULATOR=1 → 로컬 에뮬레이터(Auth 9099 / Firestore 8080)에 연결 (개발·테스트용) */
  emulator: boolean;
}

type Env = Record<string, string | undefined>;

export function readConfig(env: Env = import.meta.env as Env): OnlineConfig | null {
  const emulator = env.VITE_FIREBASE_EMULATOR === '1';
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  // 에뮬레이터 모드에서는 가짜 값으로도 충분하다
  if (emulator) {
    return {
      emulator,
      firebase: {
        apiKey: apiKey || 'demo-key',
        authDomain: authDomain || 'localhost',
        projectId: projectId || 'demo-rhythm',
        appId: appId || 'demo-app',
      },
    };
  }
  if (!apiKey || !projectId || !appId || !authDomain) return null;
  return {
    emulator: false,
    firebase: {
      apiKey, authDomain, projectId, appId,
      ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
    },
  };
}
