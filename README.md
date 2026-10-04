# Sermon Shorts MVP v5

## v5 변경점

이번 버전은 Gemini의 일시적인 `high demand` / `overloaded` 오류에 더 잘 버티도록 수정했습니다.

- 기본 모델: `gemini-3.8-flash`
- 일시적 혼잡(429/5xx, high demand 등)이 발생하면 짧게 재시도
- 계속 실패하면 `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash` 순서로 자동 대체
- 잘못된 API 키, 권한, 잘못된 요청 같은 비일시적 오류는 즉시 사용자에게 표시
- 분석, 자막 생성, SNS 문구 생성 모두 같은 자동 재시도/대체 모델 로직 적용

## 배포

기존 GitHub 저장소에 v5 폴더 안의 파일과 폴더를 그대로 덮어 올리고 `Commit changes`를 누르면 Vercel이 자동 재배포합니다.

> ZIP 자체를 GitHub에 올리지 말고, ZIP을 푼 뒤 안의 파일과 폴더를 업로드하세요.

## 참고

공개 YouTube 영상 URL을 Gemini가 직접 분석하는 구조입니다. YouTube URL 입력 기능은 Gemini API의 Preview 기능이므로, Google 측의 일시적 용량 부족이나 정책/제한 변화가 있을 수 있습니다.

`npm install`은 이 작업 환경의 외부 네트워크 제한으로 빌드 검증을 완료하지 못했습니다.
