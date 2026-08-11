# ReadLink

개인용 로컬 논문 리딩·연구 웹앱.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## 기능

### Phase 1
- 프로젝트 / PDF 업로드 (OPFS)
- PDF 뷰어 + 하이라이트
- 발췌 Node → 워크스페이스 카드
- 원문 위치 추적
- IndexedDB(Dexie) + zip 백업/복원
- PWA

### Phase 2+
- 워크스페이스 잉크 링크
- 마인드맵 자동 생성 + OPML 내보내기
- FSRS 플래시카드 복습 + Anki TSV 내보내기
- BibTeX / CSL-JSON 참고문헌 + APA/MLA/Chicago 인용
- S펜/스타일러스 압력 필기

## 기술

React · TypeScript · Vite · PDF.js · Dexie · Zustand · ts-fsrs · OPFS
