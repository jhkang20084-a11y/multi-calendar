# 함께 캘린더 아이폰 앱 (홈 화면 위젯 포함)

웹앱(https://multi-calendar-2c53f.firebaseapp.com)을 그대로 띄우는 아이폰 앱에 **홈 화면·잠금 화면 위젯**을 더했어요.
웹앱을 고치면(배포하면) 앱에도 바로 반영되므로, 앱은 처음 한 번만 설치하면 됩니다.

## 들어 있는 것
- **앱**: 웹앱 화면 + 구글 로그인(앱 안에서 구글 로그인이 막혀 있어 Safari 로그인 창 사용) + 지도·링크는 밖에서 열기
- **위젯**
  - 작은 크기: 오늘 날짜·오늘 일정 3개
  - 중간 크기: 오늘 + 다가오는 일정 5줄
  - 큰 크기: 앞으로 일정 + 기념일 D-day
  - 잠금 화면: 다음 일정
  - 날짜를 누르면 앱에서 그날 일정이 열려요.
- 위젯은 **앱에서 보고 있는 캘린더**(구독한 캘린더 일정 포함)를 보여 주고, 30분마다 새로 고쳐요.
  앱에서 일정을 바꾸면 바로 새로 고쳐요.

## 설치 (처음 한 번, 약 15분)

### 0. 서버 먼저 배포
Cloud Shell 에서 평소처럼 배포해 주세요(위젯용 서버 함수와 로그인 페이지가 함께 올라갑니다).
```
cd ~ && rm -rf multi-calendar-new && git clone https://github.com/jhkang20084-a11y/multi-calendar multi-calendar-new && cd multi-calendar-new && npm install && npm run deploy:auto
```

### 1. 맥 준비
- App Store 에서 **Xcode** 설치 → 한 번 실행해서 추가 구성요소 설치·약관 동의
- Xcode → 설정(Settings) → **Accounts** → 왼쪽 아래 **＋** → Apple ID 로 로그인

### 2. 프로젝트 만들기
맥의 **터미널** 앱에서 아래 한 줄:
```
cd ~ && rm -rf multi-calendar && git clone https://github.com/jhkang20084-a11y/multi-calendar && bash multi-calendar/ios/setup.sh
```
끝나면 Xcode 가 자동으로 열려요.

### 3. 서명 팀 고르기 (Xcode)
1. 왼쪽 맨 위 파란 **KittyCal** 을 누름
2. 가운데 TARGETS 에서 **KittyCal** → 위쪽 **Signing & Capabilities** → **Team** 에서 내 이름(Personal Team) 선택
3. TARGETS 의 **KittyCalWidget** 도 똑같이 **Team** 선택

"이미 사용 중인 Bundle Identifier" 오류가 나면: `ios/Config.xcconfig` 의 `BUNDLE_PREFIX` 끝에 숫자를 붙이고(예: `kr.jhkang20084b`) 2번을 다시 실행하세요.

### 4. 아이폰에 설치
1. 아이폰을 케이블로 맥에 연결 → 아이폰에서 "이 컴퓨터를 신뢰" 허용
2. 아이폰 **설정 → 개인정보 보호 및 보안 → 개발자 모드** 켜기 → 재시동
3. Xcode 위쪽 가운데에서 내 아이폰을 고르고 **▶** 누르기
4. 처음엔 "신뢰하지 않는 개발자" 가 나오면: 아이폰 **설정 → 일반 → VPN 및 기기 관리** → 내 Apple ID → **신뢰**
5. 앱을 열고 **Google 계정으로 로그인** → "로그인하기 위해 firebaseapp.com 사용" 창에서 **계속**

### 5. 위젯 추가
홈 화면 빈 곳을 길게 누름 → 왼쪽 위 **편집 → 위젯 추가** → "함께 캘린더" 검색 → 크기 고르고 **위젯 추가**
(잠금 화면: 잠금 화면 길게 누름 → 사용자화 → 잠금 화면 → 위젯 칸)

## 알아 둘 것
- **무료 Apple ID 로 설치하면 7일 뒤에 앱이 열리지 않아요.** 그때 맥에 연결하고 Xcode 에서 ▶ 를 다시 누르면 7일 연장돼요.
  애플 개발자 프로그램(연 약 13만 원)에 가입하면 1년 동안 그대로 쓸 수 있고, TestFlight 로 다른 사람에게도 보낼 수 있어요.
- 무료 계정에서 App Groups 관련 서명 오류가 나면 알려 주세요(위젯이 앱의 로그인 정보를 받는 데 필요한 설정이에요).
- 위젯이 "앱을 열어 로그인하면 일정이 보여요"라고 나오면 앱을 한 번 열어 주세요.
  설정 → 홈 화면 위젯 → **위젯 다시 연결**을 누르면 예전 연결이 끊기고 새로 연결돼요.
- 앱 안에서는 아직 일정 알림이 울리지 않아요(웹 알림을 아이폰 앱에서 쓸 수 없음).
- 위젯 새로 고침 횟수는 아이폰이 정해요. 30분보다 늦게 바뀔 때도 있어요.

## 개발자용 메모
- 프로젝트는 [XcodeGen](https://github.com/yonaskolb/XcodeGen) 설정(`project.yml`)으로 만들고, `KittyCal.xcodeproj` 는 저장소에 넣지 않아요.
- 웹 ↔ 앱 메시지: `src/nativeBridge.js`, `src/native.js` ↔ `KittyCal/WebController.swift`
- 위젯 데이터: 서버 함수 `widgetFeed` (`functions/widget.js`, 앱과 같은 `src/lib` 계산 사용) → `Shared/WidgetFeed.swift`
- 컴파일 확인: GitHub Actions(`.github/workflows/ios.yml`)가 `ios/` 가 바뀔 때마다 서명 없이 빌드해요.
