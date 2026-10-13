# Rhythm

모바일 웹 리듬 게임 (Vite + TypeScript, Canvas 2D, Web Audio). 진행 상황: **STEP 1 완료** (뼈대).

## 실행

```bash
npm install
npm run dev          # http://localhost:5173  (같은 와이파이의 폰에서는 터미널에 뜨는 Network 주소)
npm run build        # 타입체크 + 프로덕션 빌드
npm run preview      # 빌드 결과 확인
```

### 폰에서 테스트 (같은 와이파이)
1. PC에서 `npm run dev` 실행 → 터미널의 `Network: http://192.168.x.x:5173/` 확인
2. 폰 브라우저(크롬/사파리)에서 그 주소로 접속 (PC 방화벽이 5173 포트를 막고 있으면 허용)
3. 접속이 안 되면 같은 와이파이인지, 게스트 와이파이(기기 간 격리)가 아닌지 확인
4. 홈 화면 추가(PWA)·서비스워커·구글 로그인은 HTTPS가 필요하므로 STEP 5에서 별도 안내 (STEP 1~4는 http로 충분)

### PC에서 테스트
`D F J K` 키가 레인 1~4. 크롬 개발자도구의 모바일 에뮬레이션(터치)으로도 가능.

## STEP 1 테스트 체크리스트
- START → 3·2·1 카운트다운 후 노트 낙하, 백킹 사운드가 노트와 맞는지
- 탭 노트: 판정선에 맞춰 탭 → PERFECT / GREAT / GOOD, 빠르면 FAST, 늦으면 SLOW 표시
- 안 치면 MISS, 콤보 끊김
- 롱노트: 누르고 있다가 끝에서 떼기. 도중에 떼면 MISS + 콤보 끊김
- 멀티터치: 롱노트를 누른 채 다른 손가락으로 다른 레인 탭 (8마디), 동시치기 (9마디)
- 화면을 스크롤/핀치/길게 눌러도 아무 일도 일어나지 않는지
- 곡이 끝나면 결과 화면(점수·정확도·랭크) → 다시 하기
- 홈 버튼/앱 전환 시 자동 일시정지

## 구조
```
src/
  audio/     Web Audio 엔진, AudioContext 기반 Clock, 테스트 사운드 합성
  game/      게임 로직(game, judge, score), 샘플 맵, 입력, 렌더러, 이펙트, 원근 레이아웃
  ui/        DOM 오버레이(시작/일시정지/결과), 브라우저 제스처 차단
  analysis/  (STEP 3) 오디오 분석·맵 생성
  firebase/  (STEP 5) Auth / Firestore
```

### 타이밍 설계
모든 시간은 `AudioContext.currentTime` 기준입니다. 렌더 프레임(rAF)이 아니라 `audio/clock.ts`가
오디오 시계에 고정된 시각을 제공하고, 터치 이벤트는 `event.timeStamp`(실제 입력 시각)를 같은
시간축으로 변환해 판정하므로 프레임 간격(16ms)의 영향을 받지 않습니다.
출력 지연(블루투스 이어폰 등)은 `Game.offset`으로 보정하며 보정 화면은 STEP 4에서 추가됩니다.

### 판정 / 점수
- 윈도우: Perfect ±50ms, Great ±100ms, Good ±150ms, 그 밖은 Miss
- 정확도 가중치: Perfect 100%, Great 75%, Good 40%, Miss 0%
- 점수 = 정확도 90만 + 최대콤보 비율 10만 (만점 1,000,000)
- 랭크: S ≥ 95%, A ≥ 85%, B ≥ 70%, 그 외 C
