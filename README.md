# Sermon Kit Free v7

GitHub에 그대로 업로드하고 Vercel에서 배포할 수 있는 **무료 기능 중심 버전**입니다.

## 포함 기능

- 공개 YouTube 설교 URL 분석
- 30초 / 1분 / 3분 쇼츠 후보 5개 선정
- 원본 구간 YouTube 미리보기 및 시작 시점 링크 복사
- 제목 5개 / 설명 / 해시태그 / 썸네일 문구 생성
- 선택 구간 실제 발화 기반 SRT 자막 생성 및 다운로드
- Gemini 3.8 Flash-Lite TTS 기반 한국어 AI 음성 생성
- AI 음성 WAV 재생 및 다운로드
- Gemini API 키는 사용자의 브라우저 localStorage에 저장

## 이 무료판에서 제외한 기능

- AI 이미지 자동 생성: 이미지 생성 모델은 무료 등급이 보장되지 않으므로 제외
- YouTube 원본 영상 자동 다운로드: YouTube 정책/권리 및 서버 처리가 필요하므로 제외
- 서버 FFmpeg MP4 렌더링: 별도 컴퓨팅 서버 비용이 발생할 수 있으므로 제외
- 음성 복제: 타인 음성 오용 방지와 추가 설정이 필요하므로 제외

즉, 이 버전은 **GitHub + Vercel + 사용자의 Gemini 무료 API 등급**만으로 핵심 분석/자막/TTS 기능을 사용할 수 있게 구성했습니다.

## GitHub에 올리는 방법

1. 이 ZIP을 다운로드합니다.
2. ZIP 압축을 풉니다.
3. GitHub `sermon-kit/sermon-kit` 저장소를 엽니다.
4. `Add file` → `Upload files`를 누릅니다.
5. **압축을 푼 폴더 안의 파일과 폴더 전체**를 업로드합니다. ZIP 자체를 올리지 않습니다.
6. `Commit changes`를 누릅니다.
7. 기존 Vercel 프로젝트가 GitHub 저장소에 연결되어 있으면 자동 재배포됩니다.

## 사용 방법

1. Google AI Studio에서 발급한 Gemini API 키를 입력합니다.
2. 공개 YouTube 설교 링크를 입력합니다.
3. 쇼츠 길이를 선택하고 `쇼츠 후보 5개 찾기`를 누릅니다.
4. 후보 하나를 선택합니다.
5. 필요하면 SNS 게시 문구를 생성합니다.
6. `선택 구간 자막 만들기`를 눌러 실제 발화 자막을 준비합니다.
7. SRT 파일을 다운로드하거나 AI 음성을 생성해 WAV 파일을 다운로드합니다.
8. SRT + WAV + 원본 영상 구간을 CapCut/Premiere/DaVinci Resolve 등에서 결합할 수 있습니다.

## 무료 사용에 대한 주의

Gemini API 무료 등급에는 사용량 한도가 있습니다. Google 정책이 변경되거나 무료 한도를 초과하면 요청이 제한될 수 있습니다. 공개 YouTube URL 분석은 공개 영상만 지원됩니다.

2026-10 기준 Google 공식 문서:
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Video understanding / YouTube URL: https://ai.google.dev/gemini-api/docs/video-understanding
- TTS: https://ai.google.dev/gemini-api/docs/speech-generation

## 개인정보 / API 키

이 프로젝트는 API 키를 브라우저 `localStorage`에 저장하고 요청 시 서버 라우트로 전달합니다. 여러 사람이 함께 쓰는 공개 서비스로 확장할 경우에는 사용자별 API 키 입력 방식 대신 서버 보안 저장 구조로 변경하는 것이 좋습니다.
