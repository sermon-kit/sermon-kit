# 설교 쇼츠 자동 생성기 MVP v3

## v3 핵심 수정

v2의 `youtube-transcript` 방식은 Vercel 서버에서 YouTube 자막 접근이 차단되거나 YouTube 내부 형식이 바뀌면 `분석 중 오류가 발생했습니다`가 날 수 있습니다.

v3는 **Gemini 공식 YouTube URL 입력 기능**을 사용해 공개 YouTube 영상을 Gemini가 직접 분석합니다.

- YouTube 자막 수집 라이브러리 제거
- 신규 프로젝트 권장 모델 `gemini-3.8-flash` 기본값
- 긴 설교 분석에 agentic video processing 사용
- 오류 상세 내용을 화면에 표시
- 선택한 구간의 자막은 렌더 직전에 Gemini가 해당 구간을 다시 듣고 생성
- API 키 저장 표시를 실제 입력 여부에 맞게 수정

## 사용 흐름

1. Gemini API 키 입력
2. **공개(Public)** YouTube 설교 URL 입력
3. 30초 / 1분 / 3분 선택
4. Gemini가 YouTube 영상을 직접 분석해 후보 5개 선정
5. 구간 선택
6. 원본 MP4 업로드
7. 렌더 직전에 선택 구간 자막 생성
8. 별도 FFmpeg 워커에서 9:16 MP4 렌더링

## 주의

Gemini의 YouTube URL 입력은 **공개 영상만 지원**합니다. 비공개 또는 일부 공개(unlisted) 영상은 분석할 수 없습니다.

## Vercel 환경변수

Settings → Environment Variables에서 필요하면 아래를 추가합니다.

```text
GEMINI_MODEL=gemini-3.8-flash
NEXT_PUBLIC_RENDER_WORKER_URL=https://your-render-worker.example.com
```

`NEXT_PUBLIC_RENDER_WORKER_URL`은 쇼츠 MP4 렌더 서버를 별도로 배포한 뒤 설정합니다. 후보 분석만 테스트할 때는 없어도 됩니다.
