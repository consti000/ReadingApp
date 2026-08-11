/** ReadLink — Node-View 통합 데이터 모델 */

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

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
  /** OPFS 내 파일 경로 (documents/{id}.pdf) */
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
  yellow: '#f5d76e',
  green: '#7dcea0',
  blue: '#85c1e9',
  pink: '#f5b7b1',
  orange: '#f0b27a',
}
