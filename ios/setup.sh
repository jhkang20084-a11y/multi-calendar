#!/bin/bash
# 아이폰 앱 Xcode 프로젝트 만들기. 맥의 터미널에서:  bash ios/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d /Applications/Xcode.app ] && ! ls -d /Applications/Xcode*.app >/dev/null 2>&1; then
  echo "✖ Xcode 가 없어요. App Store 에서 Xcode 를 설치한 뒤 한 번 실행해 약관에 동의하고 다시 시도하세요."
  exit 1
fi

XCODEGEN="$(command -v xcodegen || true)"
if [ -z "$XCODEGEN" ]; then
  XCODEGEN="$(find .tools -type f -name xcodegen -perm -u+x 2>/dev/null | head -1 || true)"
fi
if [ -z "$XCODEGEN" ]; then
  echo "▶ 프로젝트 생성 도구(XcodeGen) 내려받는 중…"
  mkdir -p .tools
  curl -fsSL -o .tools/xcodegen.zip https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip
  (cd .tools && unzip -oq xcodegen.zip)
  XCODEGEN="$(find .tools -type f -name xcodegen -perm -u+x | head -1)"
fi

echo "▶ KittyCal.xcodeproj 만드는 중…"
"$XCODEGEN" generate --quiet
echo "✅ 완료! Xcode 가 열리면 안내(ios/README.md)대로 팀을 고르고 ▶ 를 누르세요."
open KittyCal.xcodeproj
