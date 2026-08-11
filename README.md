# ReadLink

개인용 로컬 논문 리딩·연구 웹앱.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/ReadingApp/` 접속. (배포 경로와 맞추기 위해 `base`를 설정해 두었습니다)

## 배포

`master`에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드해 GitHub Pages에 올립니다.
공개 주소는 <https://consti000.github.io/ReadingApp/> 입니다.

저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로 한 번 설정해야 합니다.
다른 주소로 옮길 때는 `vite.config.ts` 의 `base` 를 함께 바꿔야 합니다.

데이터는 브라우저 오리진별로 저장되므로 로컬(`localhost`)과 배포 주소는 서로 다른 저장소를 씁니다.
옮기려면 앱의 백업 내보내기 / 복원을 사용하세요.

## 기능

### Phase 1
- 프로젝트 / PDF·EPUB 업로드 (OPFS)
- PDF·EPUB 뷰어 + 하이라이트
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
