# 설교 쇼츠 자동 생성기 MVP v2

검정/금색 모바일 UI를 유지하면서 실제 제작 흐름을 한 단계 확장한 버전입니다.

## 사용자 흐름

1. Gemini API 키 입력(브라우저 localStorage 저장)
2. 설교 YouTube URL 입력
3. 30초 / 1분 / 3분 선택
4. YouTube 자막을 가져와 Gemini가 쇼츠 후보 5개 선정
5. 후보별 시작/종료 시간, 후킹, 요약, 선정 이유, 점수 표시
6. 원하는 후보를 선택하고 YouTube 구간 미리보기
7. AI가 제목 5개, 설명, 해시태그, 썸네일 문구, 첫 화면 문구 생성
8. 사용 권한이 있는 원본 MP4 업로드
9. FFmpeg 워커가 1080×1920 세로 영상 + 한글 자막 + 첫 화면 후킹 문구 렌더링
10. MP4 다운로드

> YouTube 영상을 임의로 다운로드하지 않습니다. 분석은 자막을 이용하고, 실제 영상 렌더링은 사용자가 권한을 가진 원본 MP4를 업로드하는 방식입니다.

## v2에서 추가된 기능

- 후보 선택 후 브라우저 YouTube 구간 미리보기
- SNS 게시 패키지 자동 생성
  - 제목 5개
  - 게시 설명
  - 해시태그
  - 썸네일 문구
  - 영상 첫 2~3초 문구
- 실제 영상에 첫 화면 후킹 문구 삽입
- ASS 자막 기반 한글 자막 스타일 개선
- 세로화 방식 선택
  - `원본 유지 + 흐린 배경` (추천)
  - `화면 꽉 채우기` (센터 크롭)
- 30초 / 1분 / 3분 길이 지원

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

별도 터미널에서 영상 워커:

```bash
npm run worker
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 환경변수

`.env.local`

```text
GEMINI_MODEL=gemini-2.5-flash
NEXT_PUBLIC_RENDER_WORKER_URL=http://localhost:8787
```

## Vercel 배포

웹 UI와 `/api/analyze`, `/api/social`은 Vercel에 배포할 수 있습니다. 긴 MP4의 FFmpeg 렌더링은 Vercel 함수보다 별도 Render/Railway/Cloud Run 워커를 권장합니다.

렌더 워커를 배포한 뒤 Vercel 환경변수에 아래를 넣습니다.

```text
NEXT_PUBLIC_RENDER_WORKER_URL=https://your-render-worker.example.com
```

## 렌더 워커 Docker 배포

`worker/Dockerfile`은 FFmpeg와 한글 Noto 폰트를 설치하도록 구성되어 있습니다. Render/Railway/Cloud Run에서 Docker 서비스로 배포할 수 있습니다.

## 다음 개발 우선순위

1. 얼굴 추적 기반 자동 크롭
2. 쇼츠 후보 5개 일괄 렌더링
3. 직접 자막 수정 UI
4. 자막 핵심 단어 노란색 강조
5. 채널 로고/설교자 이름 템플릿
6. 공개 서비스용 로그인/사용량/결제
7. 사용자가 API 키를 입력하지 않아도 되는 서버측 키 관리

## 보안 메모

현재 Gemini API 키는 브라우저 localStorage에 저장되고 분석/SNS 문구 생성 요청 시 서버 라우트로 전달됩니다. 서버 DB에는 저장하지 않습니다. 공개 서비스로 운영할 때는 사용자에게 API 키를 요구하지 않고 서비스 서버가 자체 키와 사용량 제한을 관리하는 구조로 바꾸는 편이 좋습니다.
