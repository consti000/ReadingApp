import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import {
  saveDocument,
  deleteDocumentFile,
  documentOpfsPath,
  detectFormat,
} from '@/lib/opfs'
import type { Bookmark, HighlightColor, Rect } from '@/types'

export async function createProject(name: string, description?: string) {
  const now = Date.now()
  const id = uuid()
  await db.projects.add({
    id,
    name,
    description,
    createdAt: now,
    updatedAt: now,
    color: '#c4a574',
  })
  // 기본 워크스페이스
  await db.workspaces.add({
    id: uuid(),
    projectId: id,
    name: '메인 워크스페이스',
    backgroundColor: '#1a1f26',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function renameProject(id: string, name: string) {
  await db.projects.update(id, { name, updatedAt: Date.now() })
}

/** 프로젝트 안의 문서·발췌·카드만 지운다. 프로젝트 칸 자체는 남긴다. */
export async function wipeProjectContents(projectId: string): Promise<void> {
  const docs = await db.documents.where('projectId').equals(projectId).toArray()
  for (const d of docs) await deleteDocumentFile(d.id, d.format ?? 'pdf')
  await db.transaction(
    'rw',
    [
      db.documents,
      db.highlights,
      db.nodes,
      db.workspaces,
      db.cardPlacements,
      db.inkLinks,
      db.mindMaps,
      db.mindMapNodes,
      db.flashcardDecks,
      db.flashcards,
      db.bibliography,
      db.bookmarks,
      db.penStrokes,
    ],
    async () => {
      const ws = await db.workspaces.where('projectId').equals(projectId).toArray()
      for (const w of ws) {
        await db.cardPlacements.where('workspaceId').equals(w.id).delete()
        await db.inkLinks.where('workspaceId').equals(w.id).delete()
      }
      const mms = await db.mindMaps.where('projectId').equals(projectId).toArray()
      for (const m of mms) {
        await db.mindMapNodes.where('mindMapId').equals(m.id).delete()
      }
      await db.flashcards.where('projectId').equals(projectId).delete()
      await db.mindMaps.where('projectId').equals(projectId).delete()
      await db.flashcardDecks.where('projectId').equals(projectId).delete()
      await db.bibliography.where('projectId').equals(projectId).delete()
      await db.bookmarks.where('projectId').equals(projectId).delete()
      await db.penStrokes.where('projectId').equals(projectId).delete()
      await db.workspaces.where('projectId').equals(projectId).delete()
      await db.nodes.where('projectId').equals(projectId).delete()
      await db.highlights.where('projectId').equals(projectId).delete()
      await db.documents.where('projectId').equals(projectId).delete()
    },
  )
}

export async function deleteProject(id: string) {
  await wipeProjectContents(id)
  await db.projects.delete(id)
}

export async function addDocument(projectId: string, file: File) {
  const format = detectFormat(file)
  if (!format) throw new Error('지원하지 않는 파일 형식입니다 (PDF/EPUB)')

  const id = uuid()
  const now = Date.now()
  const title = file.name.replace(/\.(pdf|epub)$/i, '')
  const opfsPath = await saveDocument(id, file, format)
  await db.documents.add({
    id,
    projectId,
    title,
    format,
    opfsPath: opfsPath || documentOpfsPath(id, format),
    createdAt: now,
    updatedAt: now,
  })
  await db.projects.update(projectId, { updatedAt: now })
  return id
}

export async function deleteDocument(documentId: string) {
  const doc = await db.documents.get(documentId)
  if (!doc) return
  await deleteDocumentFile(documentId, doc.format ?? 'pdf')
  const highlights = await db.highlights.where('documentId').equals(documentId).toArray()
  const highlightIds = new Set(highlights.map((h) => h.id))
  const nodes = await db.nodes.where('documentId').equals(documentId).toArray()
  await db.transaction(
    'rw',
    [db.documents, db.highlights, db.nodes, db.cardPlacements, db.bookmarks],
    async () => {
      for (const n of nodes) {
        await db.cardPlacements.where('nodeId').equals(n.id).delete()
      }
      await db.nodes.where('documentId').equals(documentId).delete()
      await db.highlights.where('documentId').equals(documentId).delete()
      await db.bookmarks.where('documentId').equals(documentId).delete()
      await db.documents.delete(documentId)
    },
  )
  void highlightIds
}

export async function createHighlight(params: {
  documentId: string
  projectId: string
  text: string
  color: HighlightColor
  rects: Rect[]
  pageIndex: number
  note?: string
  cfi?: string
}) {
  const now = Date.now()
  const highlightId = uuid()
  const nodeId = uuid()

  await db.transaction('rw', [db.highlights, db.nodes], async () => {
    await db.highlights.add({
      id: highlightId,
      documentId: params.documentId,
      projectId: params.projectId,
      text: params.text,
      color: params.color,
      rects: params.rects,
      pageIndex: params.pageIndex,
      cfi: params.cfi,
      note: params.note,
      createdAt: now,
      updatedAt: now,
    })
    await db.nodes.add({
      id: nodeId,
      projectId: params.projectId,
      documentId: params.documentId,
      sourceHighlightId: highlightId,
      text: params.text,
      color: params.color,
      tags: [],
      memo: params.note,
      createdAt: now,
      updatedAt: now,
    })
  })

  return { highlightId, nodeId }
}

/**
 * 같은 자리를 다시 그었을 때 쓰는 갈아 끼우기.
 * 새로 만들면 색이 겹쳐 진해지고 카드도 둘로 늘어나므로,
 * 원래 하이라이트의 범위와 색만 바꿔 카드·메모를 그대로 살린다.
 */
export async function updateHighlightRegion(
  highlightId: string,
  patch: { text: string; color: HighlightColor; rects: Rect[]; pageIndex: number; cfi?: string },
) {
  const now = Date.now()
  await db.transaction('rw', [db.highlights, db.nodes], async () => {
    const changed = await db.highlights.update(highlightId, { ...patch, updatedAt: now })
    if (!changed) return
    const nodes = await db.nodes.where('sourceHighlightId').equals(highlightId).toArray()
    for (const n of nodes) {
      await db.nodes.update(n.id, { text: patch.text, color: patch.color, updatedAt: now })
    }
  })
}

/** 하이라이트 색은 발췌 노드에도 그대로 반영해 카드·마인드맵 색과 어긋나지 않게 한다 */
export async function updateHighlightColor(highlightId: string, color: HighlightColor) {
  const now = Date.now()
  await db.transaction('rw', [db.highlights, db.nodes], async () => {
    const changed = await db.highlights.update(highlightId, { color, updatedAt: now })
    if (!changed) return
    const nodes = await db.nodes.where('sourceHighlightId').equals(highlightId).toArray()
    for (const n of nodes) await db.nodes.update(n.id, { color, updatedAt: now })
  })
}

/**
 * 하이라이트를 지우면 그 발췌 노드를 참조하던 모든 뷰(워크스페이스 카드, 잉크 링크,
 * 마인드맵 노드, 플래시카드)도 함께 정리한다. 마인드맵에서는 자식이 끊기지 않도록
 * 지워지는 노드의 부모로 옮겨 붙인다.
 */
export async function deleteHighlight(highlightId: string) {
  await db.transaction(
    'rw',
    [db.highlights, db.nodes, db.cardPlacements, db.inkLinks, db.mindMapNodes, db.flashcards],
    async () => {
      const nodes = await db.nodes.where('sourceHighlightId').equals(highlightId).toArray()
      for (const n of nodes) {
        await db.cardPlacements.where('nodeId').equals(n.id).delete()
        await db.inkLinks.where('fromNodeId').equals(n.id).delete()
        await db.inkLinks.where('toNodeId').equals(n.id).delete()
        await db.flashcards.where('nodeId').equals(n.id).delete()

        const mapNodes = await db.mindMapNodes.where('nodeId').equals(n.id).toArray()
        for (const m of mapNodes) {
          const children = await db.mindMapNodes.where('parentId').equals(m.id).toArray()
          for (const c of children) {
            await db.mindMapNodes.update(c.id, { parentId: m.parentId })
          }
        }
        await db.mindMapNodes.bulkDelete(mapNodes.map((m) => m.id))
      }
      await db.nodes.bulkDelete(nodes.map((n) => n.id))
      await db.highlights.delete(highlightId)
    },
  )
}

export async function addNodeToWorkspace(
  workspaceId: string,
  nodeId: string,
  x = 80,
  y = 80,
) {
  const existing = await db.cardPlacements
    .where({ workspaceId, nodeId })
    .first()
  if (existing) return existing.id

  const id = uuid()
  await db.cardPlacements.add({
    id,
    workspaceId,
    nodeId,
    x,
    y,
    width: 260,
    height: 140,
  })
  return id
}

export async function updateCardPosition(
  placementId: string,
  x: number,
  y: number,
) {
  await db.cardPlacements.update(placementId, { x, y })
}

export async function updateNodeMemo(nodeId: string, memo: string) {
  const now = Date.now()
  const node = await db.nodes.get(nodeId)
  if (!node) return
  await db.nodes.update(nodeId, { memo, updatedAt: now })
  await db.highlights.update(node.sourceHighlightId, { note: memo, updatedAt: now })
}

export async function createWorkspace(projectId: string, name: string) {
  const now = Date.now()
  const id = uuid()
  await db.workspaces.add({
    id,
    projectId,
    name,
    backgroundColor: '#1a1f26',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function createInkLink(
  workspaceId: string,
  fromNodeId: string,
  toNodeId: string,
  color = '#c4a574',
) {
  if (fromNodeId === toNodeId) return null
  const existing = await db.inkLinks
    .where('workspaceId')
    .equals(workspaceId)
    .filter((l) => l.fromNodeId === fromNodeId && l.toNodeId === toNodeId)
    .first()
  if (existing) return existing.id
  const id = uuid()
  await db.inkLinks.add({
    id,
    workspaceId,
    fromNodeId,
    toNodeId,
    color,
  })
  return id
}

export async function deleteInkLink(id: string) {
  await db.inkLinks.delete(id)
}

export async function savePenStroke(params: {
  documentId: string
  projectId: string
  pageIndex: number
  color: string
  points: { x: number; y: number; pressure: number }[]
}) {
  if (params.points.length < 2) return null
  const id = uuid()
  await db.penStrokes.add({
    id,
    documentId: params.documentId,
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    color: params.color,
    points: params.points,
    createdAt: Date.now(),
  })
  return id
}

export async function clearPagePenStrokes(documentId: string, pageIndex: number) {
  const strokes = await db.penStrokes
    .where('documentId')
    .equals(documentId)
    .filter((s) => s.pageIndex === pageIndex)
    .toArray()
  await db.penStrokes.bulkDelete(strokes.map((s) => s.id))
}

export async function deleteLastPenStroke(documentId: string) {
  const strokes = await db.penStrokes.where('documentId').equals(documentId).toArray()
  if (!strokes.length) return
  strokes.sort((a, b) => a.createdAt - b.createdAt)
  const stroke = strokes[strokes.length - 1]
  await db.penStrokes.delete(stroke.id)
}

function samePlace(a: { pageIndex: number; cfi?: string }, b: { pageIndex: number; cfi?: string }) {
  if (a.cfi || b.cfi) return Boolean(a.cfi) && a.cfi === b.cfi
  return a.pageIndex === b.pageIndex
}

/** 지금 보고 있는 자리에 책갈피를 단다. 이미 있으면 그 책갈피를 돌려준다. */
export async function createBookmark(params: {
  documentId: string
  projectId: string
  pageIndex: number
  cfi?: string
  label: string
}): Promise<{ bookmark: Bookmark; created: boolean }> {
  const existing = await db.bookmarks.where('documentId').equals(params.documentId).toArray()
  const hit = existing.find((b) => samePlace(b, params))
  if (hit) return { bookmark: hit, created: false }

  const bookmark: Bookmark = {
    id: uuid(),
    documentId: params.documentId,
    projectId: params.projectId,
    pageIndex: params.pageIndex,
    cfi: params.cfi,
    label: params.label.trim() || `${params.pageIndex + 1}쪽`,
    createdAt: Date.now(),
  }
  await db.bookmarks.add(bookmark)
  return { bookmark, created: true }
}

export async function renameBookmark(id: string, label: string): Promise<void> {
  const text = label.trim()
  if (!text) return
  await db.bookmarks.update(id, { label: text })
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
}
