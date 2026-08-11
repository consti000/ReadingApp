# ReadLink

개인용 로컬 논문 리딩·연구 웹앱 (Phase 1 MVP).

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## Phase 1 포함 기능

- 프로젝트 / PDF 업로드 (OPFS 저장)
- PDF 뷰어 + 텍스트 하이라이트
- 발췌 Node → 워크스페이스 카드
- 원문 위치 추적
- IndexedDB(Dexie) 메타데이터
- zip 백업 / 복원
- PWA 설치 가능

## 기술

React · TypeScript · Vite · PDF.js · Dexie · Zustand · OPFS
