import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import { savePdf, deletePdf, documentOpfsPath } from '@/lib/opfs'
import type { HighlightColor, Rect } from '@/types'

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

export async function deleteProject(id: string) {
  const docs = await db.documents.where('projectId').equals(id).toArray()
  for (const d of docs) await deletePdf(d.id)
  await db.transaction(
    'rw',
    [
      db.projects,
      db.documents,
      db.highlights,
      db.nodes,
      db.workspaces,
      db.cardPlacements,
      db.inkLinks,
    ],
    async () => {
      const ws = await db.workspaces.where('projectId').equals(id).toArray()
      for (const w of ws) {
        await db.cardPlacements.where('workspaceId').equals(w.id).delete()
        await db.inkLinks.where('workspaceId').equals(w.id).delete()
      }
      await db.workspaces.where('projectId').equals(id).delete()
      await db.nodes.where('projectId').equals(id).delete()
      await db.highlights.where('projectId').equals(id).delete()
      await db.documents.where('projectId').equals(id).delete()
      await db.projects.delete(id)
    },
  )
}

export async function addDocument(projectId: string, file: File) {
  const id = uuid()
  const now = Date.now()
  const title = file.name.replace(/\.pdf$/i, '')
  const opfsPath = await savePdf(id, file)
  await db.documents.add({
    id,
    projectId,
    title,
    opfsPath: opfsPath || documentOpfsPath(id),
    createdAt: now,
    updatedAt: now,
  })
  await db.projects.update(projectId, { updatedAt: now })
  return id
}

export async function deleteDocument(documentId: string) {
  const doc = await db.documents.get(documentId)
  if (!doc) return
  await deletePdf(documentId)
  const highlights = await db.highlights.where('documentId').equals(documentId).toArray()
  const highlightIds = new Set(highlights.map((h) => h.id))
  const nodes = await db.nodes.where('documentId').equals(documentId).toArray()
  await db.transaction(
    'rw',
    [db.documents, db.highlights, db.nodes, db.cardPlacements],
    async () => {
      for (const n of nodes) {
        await db.cardPlacements.where('nodeId').equals(n.id).delete()
      }
      await db.nodes.where('documentId').equals(documentId).delete()
      await db.highlights.where('documentId').equals(documentId).delete()
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
