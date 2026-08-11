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
  path?: string
  color: string
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#f5d76e',
  green: '#7dcea0',
  blue: '#85c1e9',
  pink: '#f5b7b1',
  orange: '#f0b27a',
}
