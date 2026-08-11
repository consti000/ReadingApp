/**
 * 카드↔본문 연결선을 그리기 위한 좌표 통로.
 *
 * 본문에서 하이라이트가 실제로 어디 그려졌는지는 형식마다 계산법이 달라
 * (PDF 는 페이지 위 DOM, EPUB 은 iframe 안의 CFI 범위) 뷰어가 측정을 맡고,
 * 리더 화면은 받은 좌표로 선만 그린다.
 */

/** 뷰포트 좌표 기준, 본문에서 선이 출발할 지점 */
export interface HighlightAnchor {
  x: number
  y: number
}

export interface AnchorSnapshot {
  /** 본문이 보이는 영역 — 이 밖의 하이라이트는 연결선을 그리지 않는다 */
  clip: DOMRect
  anchors: Map<string, HighlightAnchor>
}

export type AnchorProvider = () => AnchorSnapshot | null

export interface AnchorPort {
  register: (provider: AnchorProvider | null) => void
  /** 페이지 렌더·이동·확대처럼 좌표가 달라진 뒤 다시 측정하라는 신호 */
  invalidate: () => void
}
