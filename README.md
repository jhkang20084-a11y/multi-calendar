# 함께 캘린더 — Firebase 실시간 멀티 캘린더 웹앱

개인·연인·가족·친구·모임 누구나 쓸 수 있는 반응형 캘린더 웹앱입니다.
여러 캘린더를 만들고, 캘린더마다 사람을 초대해 역할(소유자/편집자/열람자)을 주고,
같은 원본 일정을 실시간으로 함께 보고 고칠 수 있습니다. 다른 캘린더를 **복사 없이 읽기 전용으로 구독**할 수도 있습니다.

- 프런트엔드: React 18 + Vite 6 (기존 프로젝트가 없어 새로 구성)
- 인증: Firebase Authentication (Google 로그인)
- 데이터: Cloud Firestore + 실시간 리스너 + 오프라인 캐시
- 권한: Firestore Security Rules (Cloud Functions 없이 동작 → 무료 Spark 요금제 가능)
- 호스팅: Firebase Hosting, PWA(홈 화면에 추가) 지원
- 시간대: 기본 Asia/Seoul, 일정마다 시간대 저장

### 디자인 (빈티지 종이 달력, 휴대폰 우선)
- 따뜻한 종이색 배경과 은은한 종이 질감, 잉크색 글씨, 얇은 격자 + 위아래 굵은 선
- 큰 영문 월 이름(Abril Fatface), 띄어 쓴 연도 "2 0 2 6"과 ♥♥♥ 장식, 영문 요일(SUN~SAT)
- 일요일·공휴일 빨강, 토요일 파랑, 날짜 아래 공휴일 이름(개천절·대체휴일·한글날 …)과 기념일(할로윈 등)
- 오늘은 형광펜, 고른 날은 손으로 그린 동그라미로 표시
- 설정에서 **달력 선: 반듯한 선 / 손그림 선**(삐뚤빼뚤한 손그림 격자) 선택
- 달력 아래 줄 노트 두 칸: **Schedule**(누른 날짜의 일정) + **Memo**(캘린더별 이달의 메모, 멤버끼리 공유, 손글씨체)
- 캘린더 커버: 튤립·하트·깅엄 체크·물방울 등 일러스트나 내 사진, 아래쪽은 찢어진 종이 가장자리
- 휴대폰: 달력을 좌우로 밀어 이전/다음 달, 아래에서 올라오는 종이 시트, 큰 터치 영역, 상단 알림
- 라이트/다크(밤의 종이) 모드, 글꼴은 앱에 포함되어 오프라인·PWA에서도 같은 모양

---

## 1. 빠른 시작 (Firebase 계정 없이 로컬에서 체험)

필요한 것: Node.js 20 이상, Java 11 이상(에뮬레이터용)

```bash
npm install
npm run emulators      # 터미널 1: 로컬 가짜 Firebase(Auth + Firestore) 실행
npm run dev:emu        # 터미널 2: 앱 실행 → http://localhost:5173
```

로그인 버튼을 누르면 실제 Google 대신 에뮬레이터의 테스트 계정 화면이 열립니다.
"Add new account"로 이메일을 아무거나 입력하면 됩니다. 두 번째 사용자는 시크릿 창에서 다른 이메일로 로그인해 보세요.
에뮬레이터 화면(데이터 확인용): http://localhost:4000

---

## 2. 실제 Firebase 프로젝트 설정

### 2-1. 프로젝트와 웹 앱 만들기
1. https://console.firebase.google.com 에서 **프로젝트 추가**
2. 프로젝트 설정(⚙) → **내 앱** → 웹(`</>`) 앱 추가 → 표시되는 `firebaseConfig` 값을 복사
3. 이 폴더에서 `.env.example` 을 `.env.local` 로 복사하고 값을 채웁니다.

```bash
cp .env.example .env.local
```

### 2-2. Google 로그인 설정
1. 콘솔 → **Authentication** → 시작하기 → **로그인 방법** → **Google** 사용 설정 → 지원 이메일 선택 → 저장
2. Authentication → **설정** → **승인된 도메인**에 사용할 도메인이 있는지 확인
   - 기본 포함: `localhost`, `<프로젝트ID>.web.app`, `<프로젝트ID>.firebaseapp.com`
   - 직접 산 도메인을 쓰면 추가
3. **iPhone Safari / 홈 화면 앱 로그인 안정화(권장)**: `.env.local` 의
   `VITE_FIREBASE_AUTH_DOMAIN` 을 `<프로젝트ID>.firebaseapp.com` 대신 **실제 접속 도메인**(예: `<프로젝트ID>.web.app`)으로 설정하세요.
   Safari 의 쿠키 차단 때문에 로그인 도메인이 앱 도메인과 다르면 리디렉션 로그인이 실패할 수 있습니다.
   Firebase Hosting 은 `/__/auth/handler` 를 자동 제공하므로 별도 작업이 필요 없습니다.
   (Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보 > 웹 클라이언트의 "승인된 리디렉션 URI"에
   `https://<프로젝트ID>.web.app/__/auth/handler` 추가가 필요할 수 있습니다.)

### 2-3. Firestore 만들기
콘솔 → **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (서울)` 권장 → **프로덕션 모드**로 시작
(보안 규칙은 아래 배포 명령으로 이 저장소의 `firestore.rules` 가 올라갑니다.)

### 2-4. 이 폴더를 내 프로젝트에 연결
```bash
npx firebase login
npx firebase use --add      # 방금 만든 프로젝트 선택, 별칭은 default
```
`.firebaserc` 의 `demo-multi-calendar` 가 실제 프로젝트 ID 로 바뀝니다.

---

## 3. 로컬 실행 (실제 Firebase 사용)
```bash
npm run dev     # http://localhost:5173
```

## 4. Firebase Hosting 배포
```bash
npm run deploy
# = vite build && firebase deploy --only hosting,firestore:rules,firestore:indexes
```
- 배포 후 주소: `https://<프로젝트ID>.web.app`
- **인덱스 생성에는 몇 분이 걸립니다.** 그 사이 일정이 안 보이고 "index" 오류가 나면 잠시 기다리세요.
  콘솔 > Firestore > 색인 에서 상태가 "사용 설정됨"이 되면 정상입니다.
- 휴대폰에서 주소를 열고 Safari **공유 → 홈 화면에 추가**하면 앱처럼 쓸 수 있습니다.

---

## 5. 테스트

| 명령 | 내용 | 필요 |
|---|---|---|
| `npm run test:unit` | 반복 일정 전개, D-day, 시간대, 통합 보기/구독 계산, 겹침 배치, 공휴일 (22개) | Node |
| `npm run test:rules` | 보안 규칙 (19개, 이달의 메모 포함): 소유자 위조, 초대 우회, 열람자 수정, 비공개 일정, 구독 우회 등 | Java |
| `npm run test:integration` | 두 사용자 실시간 동기화 (8개, 지시서 17장 시나리오) | Java |
| `npm test` | 위 전부 | Java |
| `node tests/e2e/ui-smoke.mjs` | 실제 브라우저(PC 화면 A + iPhone 13 화면 B) 16단계 UI 테스트(메모 공유·날짜 선택 포함), 스크린샷은 `test-results/` | `npm run emulators` + `npm run dev:emu` 실행 중, Chromium |

필수 시나리오 ↔ 테스트 위치

| # | 시나리오 | 검증 위치 |
|---|---|---|
| 1 | A 로그인 후 개인 캘린더 | integration 1, rules "사용자 프로필", e2e 1 |
| 2–3 | 공유 캘린더 생성·B 초대·수락 | integration 2~3, rules "초대와 권한", e2e 2~3 |
| 4–5 | A 추가 → B 실시간 표시, B 수정 → A 반영 | integration 4~5, e2e 4~5 |
| 6 | B 체크리스트 완료 → A 반영 | integration 6, e2e 5~6 |
| 7–9 | 원본 수정/삭제가 구독 화면 반영, 구독 해제해도 원본 유지 | integration 7~9, rules "구독", e2e 7~8 |
| 10 | 열람자 수정/삭제 불가 | rules "일정 권한", integration 10, e2e 10 (버튼 미노출) |
| 11 | 권한 없는 사용자 읽기 불가 | rules "외부 사용자", "비로그인" |
| 12 | 비공개 일정 세부 내용 비노출 | rules "비공개", "시간만 공개", e2e 12 |
| 13 | 구독 권한 취소 시 접근 차단 | rules "구독으로 원본 권한을 얻지 못함", integration 10·13 |
| 14 | 중복 구독 불가 | rules, integration 7~9 |
| 15 | 모바일/PC 같은 데이터 | integration 15 (같은 계정 두 기기), e2e (PC A + 모바일 B) |
| 16 | 네트워크 끊김 → 복구 일관성 | integration 16, e2e 16 |

---

## 6. 데이터 구조 (Firestore)

```
users/{uid}                                   프로필 + settings(테마, 시간대, 주 시작, 숨긴 캘린더, 알림 설정)
calendars/{calendarId}                        이름, 설명, 색, 커버, shared(공유 여부)
    ownerId, editorIds[], viewerIds[]         역할 (규칙이 서로 겹치지 않음을 검증)
    memberIds[]                               = 소유자+편집자+열람자 ("내 캘린더" 조회용)
    memberInfo{uid: {name,email,photoURL}}    표시용 멤버 정보
    createdBy, createdAt, updatedAt, updatedBy
  /memos/{YYYY-MM}                            이달의 메모: text, updatedBy, updatedAt (멤버 읽기, 편집자 쓰기)
  /invitations/{소문자이메일}                 role, status(pending/accepted/declined/canceled), 초대자
  /events/{eventId}                           원본 일정 (구독용 복제 없음)
      calendarId, title, description, location, notes, color, category,
      allDay, startMs/endMs(시간 일정) 또는 startDate/endDate(종일),
      timeZone, recurrence{freq,interval,byWeekday,until|count}, exdates[],
      recurringEventId/originalStart(반복 중 한 회차만 수정한 경우),
      visibility(members|busy|private), kind(event|anniversary), completed,
      reminders[], showDday, rangeStartMs/rangeEndMs(기간 조회용),
      createdBy, createdAt, updatedBy, updatedAt
    /todos/{todoId}                           체크리스트: text, done, assigneeUid, doneBy, doneAt …
    /secret/detail                            "시간만 공개" 일정의 실제 제목/장소/설명/메모 (작성자만)
subscriptions/{uid__대상ID__원본ID}           ownerUid, targetCalendarId, sourceCalendarId, active, createdAt, updatedAt
```

지시서의 개념과 다르게 조정한 부분과 이유
- **멤버를 하위 컬렉션 대신 캘린더 문서 안 배열로 관리**: 보안 규칙이 한 번의 읽기로 역할을 확인할 수 있고,
  "초대 없이 멤버 추가", "소유자 위조"를 집합 비교로 확실히 막을 수 있습니다. (멤버 최대 100명)
- **초대 문서 ID = 소문자 이메일**: 같은 사람을 중복 초대할 수 없습니다.
- **구독 문서 ID = 사용자__대상__원본**: 같은 조합을 두 번 만들 수 없습니다(규칙에서도 차단).
- **알림 설정은 users 문서의 settings.notifications** 에 둡니다.

## 7. 권한 모델 요약 (`firestore.rules`)

| 동작 | 소유자 | 편집자 | 열람자 | 비멤버 |
|---|---|---|---|---|
| 캘린더/일정 보기 | ✅ | ✅ | ✅ | ❌ |
| 일정·체크리스트 추가/수정/삭제 | ✅ | ✅ | ❌ | ❌ |
| 캘린더 설정·초대·역할 변경·멤버 제거·소유권 이전·삭제 | ✅ | ❌ | ❌ | ❌ |
| 캘린더 나가기 | (먼저 이전) | ✅ | ✅ | – |

- 새 멤버는 **초대 수락 배치**로만 추가됩니다. 규칙이 같은 요청 안에서 초대가 `pending → accepted` 로 바뀌는지,
  로그인한 Google 계정 이메일(인증됨)이 초대 이메일과 같은지, 초대된 역할과 같은 역할로 들어가는지 확인합니다.
- 비공개(private) 일정은 작성자 외에는 문서 자체를 읽을 수 없습니다.
  "시간만 공개(busy)" 일정은 본문에 제목·장소 등을 넣을 수 없게 규칙이 강제하고, 세부 내용은 작성자만 읽는 `secret` 문서에 저장됩니다.
- 구독 문서는 원본 일정 권한을 주지 않습니다. 원본 일정을 읽을 때마다 **원본 캘린더 멤버십**을 다시 확인합니다.
- `createdBy`, `createdAt`, `calendarId`, `ownerId` 변경, 허용 목록에 없는 필드 추가는 거부됩니다.
  `updatedBy` 는 실제 로그인 UID, `updatedAt` 은 서버 시각이어야 합니다.

## 8. 주요 기능
- Google 로그인/로그아웃, 로그인 유지, 최초 로그인 시 프로필 + "내 캘린더" 자동 생성
- 캘린더 여러 개 생성(개인/공유), 색상·설명·커버 이미지(기본 그라디언트 또는 사진 업로드)
- 이메일 초대, 수락/거절, 초대 취소·재발송, 초대 상태 표시, 이미 멤버/중복 초대 처리, 역할 변경, 멤버 제거, 나가기, 소유권 이전, 캘린더 삭제
- 일정: 생성/수정/삭제, 종일·여러 날, 시간대, 반복(매일/매주 요일/매월/매년, 간격, 종료일·횟수),
  반복 회차 수정·삭제("이 일정만 / 이 일정 및 이후 / 모든 반복"), 장소·설명·메모·색상·분류, 완료 표시, 작성자/수정자 기록
- 체크리스트: 추가·완료·수정·삭제·담당자, 실시간 공유
- 기념일: 매년 반복, "N일째", 다음 주년 D-day, 다음 100일 단위 기념일 / 일반 일정 D-day 표시
- 구독: 다른 캘린더를 대상 캘린더 화면에 읽기 전용으로 표시, 일시중지/해제, 권한 상실 시 자동 표시 중단, 🔗·점선으로 구분, 원본 이름 표시
- 통합 보기(여러 캘린더 동시), 캘린더별 표시/숨기기, 월/주/일/목록 보기, 오늘·이전·다음, 검색, 목록 기간 필터
- 겹치는 일정 나란히 배치, 라이트/다크 모드, 모바일 서랍 메뉴, 큰 터치 영역, PWA
- 동기화 상태 표시(동기화됨/동기화 중/불러오는 중/오프라인/오류), 오류·권한 부족·로그인 만료 안내,
  **서버 저장이 확정될 때만 "저장했습니다" 표시** (오프라인에서는 "아직 저장되지 않음" 안내)

## 9. 알려진 제한 사항 (정직하게)
1. **실제 Firebase 프로젝트·실제 Google 로그인·실제 iPhone 은 검증하지 못했습니다.** 모든 테스트는 Firebase 에뮬레이터와
   Chromium(아이폰 화면 크기 흉내)으로 수행했습니다. 배포 후 실제 기기에서 로그인과 홈 화면 앱을 꼭 확인하세요.
2. **복합 색인(`firestore.indexes.json`)은 실제 프로젝트에 배포해 보지 못했습니다.** 에뮬레이터는 색인이 필요 없습니다.
   배포 후 "The query requires an index" 오류가 나면, 오류 메시지의 링크를 눌러 색인을 만들면 됩니다.
3. **알림은 앱이 열려 있을 때만** 울립니다. 앱이 닫혀 있을 때의 푸시 알림(FCM + 서버 예약)은 구현하지 않았습니다.
   iPhone 은 홈 화면에 추가한 앱에서만 알림 권한을 요청할 수 있습니다.
4. **초대 이메일은 자동 발송되지 않습니다.** 초대받은 사람에게 앱 주소를 알려 주면, 같은 이메일의 Google 계정으로 로그인했을 때 초대가 보입니다.
5. 캘린더 삭제 시, 소유자가 읽을 수 없는 **다른 멤버의 비공개/시간만 공개 일정 문서는 Firestore 에 남을 수 있습니다**(아무도 접근 불가).
   완전한 정리는 Cloud Functions(유료 Blaze 요금제)가 필요합니다.
6. 이미 열려 있는 실시간 리스너는 권한 취소 직후가 아니라 **다음 데이터 변경 시점에** 서버가 끊습니다(그 사이 새 데이터는 전달되지 않음).
   앱은 캘린더 목록에서 빠지는 즉시 해당 리스너를 스스로 해제합니다.
7. 검색은 **현재 화면 기간에 불러온 일정 안에서만** 합니다(Firestore 는 전문 검색 미지원). 목록 보기에서 기간을 넓혀 검색하세요(최대 1년).
8. 체크리스트와 메모는 반복 일정의 **전체**에 공통으로 연결됩니다(회차별 체크리스트 아님).
9. 일정을 다른 캘린더로 옮기는 기능, 캘린더 공개 링크(비멤버 공개)는 없습니다. 커버 사진은 400KB 이하로 줄여 캘린더 문서에 저장합니다.
10. 한 화면에서 실시간으로 표시하는 캘린더는 최대 20개입니다(캘린더당 리스너 2개). 넘으면 안내가 나오고 일부를 숨겨야 합니다.
11. **공휴일은 표(`src/lib/holidays.js`)로 관리합니다.** 2025·2026년은 설날·추석·대체공휴일까지 넣었지만,
    2027년은 양력 공휴일과 그 대체공휴일만 넣었습니다(설날·추석·부처님오신날 미포함). 임시공휴일 등 정부 발표에 맞춰 매년 갱신이 필요합니다.
12. 손그림 선은 SVG 필터로 그리므로 아주 오래된 브라우저에서는 반듯한 선으로 보일 수 있습니다.
13. 매월 31일 반복은 31일이 없는 달을 건너뛰고, 2월 29일 매년 반복(기념일)은 평년에 2월 28일로 표시됩니다.

## 10. 파일 구조
```
firebase.json, .firebaserc        Firebase 설정(호스팅, 에뮬레이터)
firestore.rules                   보안 규칙
firestore.indexes.json            복합 색인
.env.example / .env.emulator      환경 변수 예시 / 에뮬레이터용
index.html, public/               PWA manifest, 서비스 워커, 아이콘
src/firebase.js                   Firebase 초기화, Google 로그인(팝업/리디렉션)
src/services/                     Firestore 읽기/쓰기 (users, calendars, invitations, events, todos, subscriptions)
src/lib/                          시간대·반복·D-day·통합 보기 계산, 공휴일 표, 색상/커버 일러스트
src/hooks/                        로그인 상태, 온라인 상태, 실시간 일정 리스너 관리
src/components/                   화면 (월/주/일/목록, 줄 노트·메모, 일정 편집/상세, 캘린더 설정, 사이드바 등)
src/styles.css                    빈티지 종이 달력 테마 (라이트/다크, 휴대폰 우선)
tests/unit, tests/rules, tests/integration, tests/e2e
```
