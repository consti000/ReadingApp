/** ReadLink — Node-View 통합 데이터 모델 */

/** 'red' 는 칠하지 않고 밑줄만 긋는 범례 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'red'

export type DocumentFormat = 'pdf' | 'epub'

export interface Rect {
  pageIndex: number
  left: number
  top: number
  width: number
  height: number
}

export interface Project {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  color?: string
}

export interface DocumentMeta {
  id: string
  projectId: string
  title: string
  /** pdf | epub — 구버전 데이터는 undefined → pdf 취급 */
  format?: DocumentFormat
  /** OPFS 내 파일 경로 (documents/{id}.pdf|epub) */
  opfsPath: string
  pageCount?: number
  /** BibTeX cite key 연결 */
  citeKey?: string
  createdAt: number
  updatedAt: number
}

export interface Highlight {
  id: string
  documentId: string
  projectId: string
  text: string
  color: HighlightColor
  rects: Rect[]
  pageIndex: number
  /** EPUB Canonical Fragment Identifier (범위) */
  cfi?: string
  note?: string
  createdAt: number
  updatedAt: number
}

/** 통합 발췌 단위 — 한 번만 존재하고 각 뷰가 참조 */
export interface Node {
  id: string
  projectId: string
  documentId: string
  sourceHighlightId: string
  text: string
  color: HighlightColor
  tags: string[]
  memo?: string
  createdAt: number
  updatedAt: number
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  backgroundColor: string
  createdAt: number
  updatedAt: number
}

export interface CardPlacement {
  id: string
  workspaceId: string
  nodeId: string
  x: number
  y: number
  width: number
  height: number
}

export interface InkLink {
  id: string
  workspaceId: string
  fromNodeId: string
  toNodeId: string
  /** SVG path points in world coords */
  points?: { x: number; y: number }[]
  color: string
}

export interface MindMap {
  id: string
  projectId: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface MindMapNode {
  id: string
  mindMapId: string
  nodeId: string | null
  /** 루트/폴더 노드용 라벨 (nodeId 없을 때) */
  label?: string
  parentId: string | null
  x: number
  y: number
  collapsed?: boolean
}

export interface FlashcardDeck {
  id: string
  projectId: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface Flashcard {
  id: string
  deckId: string
  projectId: string
  nodeId: string
  front: string
  back: string
  /** FSRS Card 직렬화 */
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  state: number
  last_review?: number
  createdAt: number
  updatedAt: number
}

export interface BibliographyEntry {
  id: string
  projectId: string
  citeKey: string
  entryType: string
  title: string
  authors: string[]
  year?: string
  journal?: string
  booktitle?: string
  publisher?: string
  doi?: string
  url?: string
  raw: string
  createdAt: number
}

/** 문서 속 한 자리에 단 책갈피 */
export interface Bookmark {
  id: string
  documentId: string
  projectId: string
  /** PDF 는 쪽(0부터), EPUB 은 장(spine) 번호 */
  pageIndex: number
  /** EPUB Canonical Fragment Identifier — PDF 에는 없음 */
  cfi?: string
  label: string
  createdAt: number
}

/** PDF 페이지 위 자유 필기 스트로크 */
export interface PenStroke {
  id: string
  documentId: string
  projectId: string
  pageIndex: number
  color: string
  points: { x: number; y: number; pressure: number }[]
  createdAt: number
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#ffe000',
  green: '#00d15a',
  blue: '#2b7fff',
  pink: '#ff3d8b',
  orange: '#ff8a00',
  red: '#ff2233',
}

/** 원색을 그대로 얹으면 글자를 덮으므로 이만큼만 남기고 투과시킨다 */
export const HIGHLIGHT_OPACITY = 0.5

/** 칠하지 않고 밑줄만 긋는 범례 — 글자를 전혀 가리지 않는다 */
export function isUnderlineColor(color: HighlightColor) {
  return color === 'red'
}
