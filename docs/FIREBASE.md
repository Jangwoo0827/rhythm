# Firebase 설정 (온라인 기능)

로그인(익명 → 구글 연결), 맵 저장·공유, 곡별 리더보드, 오프라인 점수 동기화는 Firebase(Auth + Firestore)를 씁니다.
**설정하지 않아도 게임은 그대로 플레이할 수 있고**, 온라인 기능 버튼만 보이지 않습니다. Storage 는 쓰지 않으며 오디오 원본은 절대 업로드하지 않습니다.

## 1. 프로젝트와 웹 앱 만들기
1. [Firebase 콘솔](https://console.firebase.google.com) → **프로젝트 추가** (Google Analytics 는 꺼도 됩니다)
2. 프로젝트 개요 → **웹 앱 추가(</>)** → 앱 닉네임 입력 → (Hosting 은 체크하지 않음) → 표시되는 `firebaseConfig` 값을 메모

## 2. Authentication
1. **빌드 → Authentication → 시작하기**
2. **Sign-in method** 에서 **익명** 과 **Google** 을 사용 설정 (Google 은 프로젝트 지원 이메일 선택)
3. **설정 → 승인된 도메인** 에 배포 주소의 도메인을 추가: `jangwoo0827.github.io`
   (`localhost` 는 기본 포함. 빠뜨리면 구글 로그인에서 `auth/unauthorized-domain` 오류가 나며, 앱이 해결 방법을 안내합니다.)

## 3. Firestore
1. **빌드 → Firestore Database → 데이터베이스 만들기** → **프로덕션 모드** (보안 규칙은 아래에서 배포) → 위치 선택(가까운 곳, 예: `asia-northeast3` 서울)
2. 보안 규칙과 인덱스 배포 (저장소 루트에서):
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <프로젝트 ID>
   ```
   - `firestore.rules`: 인증된 사용자만, 본인 문서만 쓰기, `scores` 는 생성만(수정·삭제 불가), 맵 크기 제한
   - `firestore.indexes.json`: 리더보드 쿼리용 복합 인덱스 `scores(mapId ↑, score ↓)` — **배포하지 않으면 리더보드가 오류**를 냅니다. 인덱스 생성에는 몇 분 걸릴 수 있어요.

## 4. 앱에 설정값 넣기
**로컬 개발**: `.env.example` 을 `.env` 로 복사하고 값을 채웁니다.
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<프로젝트 ID>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<프로젝트 ID>
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...   # 선택
```
**GitHub Pages 배포**: 저장소 **Settings → Secrets and variables → Actions → Variables** 탭에 같은 이름(`VITE_FIREBASE_*`)으로 등록하세요.
(`deploy.yml` 이 빌드 시 주입합니다. 웹 앱 설정값은 비밀 키가 아니라 브라우저에 공개되는 값이라 Variables 로 충분하며, 보안은 규칙과 도메인 제한으로 지킵니다.) 등록 후 Actions 에서 *Run workflow* 로 다시 배포합니다.

## 5. 확인
앱을 열면 메뉴에 `☁ Player1234 (익명)` 이 표시되면 성공입니다.
- 설정 → **온라인 계정**: 닉네임 변경, **Google 계정 연결**(익명 계정의 기록이 그대로 이어짐), 로그아웃
- 곡 업로드 → 준비 화면의 **🏆 리더보드 / 🔗 맵 공유**
- 메뉴 → **공유 맵 불러오기** (링크 `…/#/song/<곡지문>` 또는 곡 지문/맵 ID)

## 로컬 에뮬레이터로 개발·테스트
실제 Firebase 프로젝트 없이도 전체 흐름을 시험할 수 있습니다 (Java 필요).
```bash
npm run emulators      # Auth(9099) + Firestore(8080), 실제 보안 규칙 적용
npm run dev:emu        # 다른 터미널: 에뮬레이터에 연결된 앱 (VITE_FIREBASE_EMULATOR=1)
npm run test:rules     # 보안 규칙 테스트 (에뮬레이터를 자동으로 띄우고 종료)
```

## 데이터 모델
| 컬렉션 | 문서 ID | 필드 | 규칙 |
|---|---|---|---|
| `users` | `{uid}` | `nickname`, `settings{speed,musicVolume,sfxVolume,difficulty}`, `updatedAt` | 본인만 읽기/쓰기 |
| `maps` | `{곡지문}_{난이도}` | `songHash`, `title`, `bpm`, `offset?`, `difficulty`, `notes[{t,lane,dur}]`, `uid`(만든 사람), `createdAt`, `v` | 로그인 사용자 읽기, **생성만**(수정·삭제 불가) |
| `scores` | 클라이언트가 만든 ID | `uid`, `mapId`, `nickname`, `score`, `accuracy`, `combo`, `time`(서버), `playedAt` | 로그인 사용자 읽기, **생성만** |

- **곡 지문(songHash)**: 디코드된 오디오의 에너지 윤곽에서 계산한 64비트 해시(16자리 16진수). 같은 파일이면 항상 같고, 다른 인코딩(mp3 ↔ wav)은 다른 곡으로 취급됩니다.
- **맵은 곡·난이도당 하나**이며 처음 올린 것이 기준입니다. 같은 곡을 다시 올리면 저장된 맵을 받아 쓰고, 없을 때만 분석 후 저장합니다.
- 점수는 **개인 최고 기록을 갱신했을 때만** 업로드합니다. 오프라인이거나 로그인 전이면 기기에 보관했다가 연결되면 맵 → 점수 순서로 올립니다.
- 설정 동기화에서 **판정 오프셋은 제외**합니다 (이어폰·기기마다 달라서). 다른 계정으로 로그인하면 그 계정의 클라우드 설정(속도·볼륨·난이도)과 닉네임을 받아옵니다.

## 알려진 한계 (운영 시 참고)
- **점수는 클라이언트가 계산**하므로 규칙으로는 범위(0~1,000,000점, 정확도 0~100, 콤보 ≤ 맵 노트 수, 서버 시각)만 검증합니다. 조작을 막으려면 서버(Cloud Functions)에서 재검증하거나 App Check 를 도입해야 합니다.
- **맵 선점**: 맵은 불변이라 누군가 아직 없는 곡 지문으로 이상한 맵을 먼저 올리면 기준이 됩니다. 규칙은 형식·크기만 검사합니다(노트 최대 2500개). 클라이언트는 받은 맵을 엄격히 검증하고 불량이면 무시하고 새로 분석합니다. 필요하면 콘솔에서 해당 문서를 삭제하세요.
- 리더보드는 사람당 최고 기록만 보여 주기 위해 상위 60건을 가져와 중복 uid 를 걸러 20명을 표시합니다.
- 권장: Google Cloud 콘솔에서 웹 API 키에 **HTTP 리퍼러 제한**(`https://jangwoo0827.github.io/*`, `http://localhost:*`)을 걸고, 사용량 알림을 설정하세요. 무료(Spark) 요금제의 사용량 한도는 콘솔에서 확인하세요.
