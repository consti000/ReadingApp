import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import type { MindMapNode } from '@/types'

export async function ensureDefaultMindMap(projectId: string): Promise<string> {
  const existing = await db.mindMaps.where('projectId').equals(projectId).first()
  if (existing) return existing.id
  const now = Date.now()
  const id = uuid()
  await db.mindMaps.add({
    id,
    projectId,
    name: '메인 마인드맵',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function createMindMap(projectId: string, name: string): Promise<string> {
  const now = Date.now()
  const id = uuid()
  await db.mindMaps.add({
    id,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/** 문서별 루트 → 발췌 노드 트리로 자동 배치 */
export async function autoBuildMindMap(mindMapId: string, projectId: string): Promise<number> {
  const mindMap = await db.mindMaps.get(mindMapId)
  if (!mindMap) return 0

  await db.mindMapNodes.where('mindMapId').equals(mindMapId).delete()

  const documents = await db.documents.where('projectId').equals(projectId).toArray()
  const nodes = await db.nodes.where('projectId').equals(projectId).toArray()
  const now = Date.now()
  const rows: MindMapNode[] = []

  const rootId = uuid()
  rows.push({
    id: rootId,
    mindMapId,
    nodeId: null,
    label: mindMap.name,
    parentId: null,
    x: 400,
    y: 40,
  })

  documents.forEach((doc, i) => {
    const mmId = uuid()
    const x = 80 + i * 320
    rows.push({
      id: mmId,
      mindMapId,
      nodeId: null,
      label: doc.title,
      parentId: rootId,
      x,
      y: 160,
    })

    const docNodes = nodes
      .filter((n) => n.documentId === doc.id)
      .sort((a, b) => a.createdAt - b.createdAt)
    docNodes.forEach((n, j) => {
      const col = j % 3
      const row = Math.floor(j / 3)
      rows.push({
        id: uuid(),
        mindMapId,
        nodeId: n.id,
        parentId: mmId,
        x: x + col * 100 - 80,
        y: 280 + row * 110,
      })
    })
  })

  await db.mindMapNodes.bulkAdd(rows)
  await db.mindMaps.update(mindMapId, { updatedAt: now })
  return rows.length
}

export async function updateMindMapNodePosition(id: string, x: number, y: number) {
  await db.mindMapNodes.update(id, { x, y })
}

/** 자손인지 검사 (순환 참조 방지) */
export function isDescendantOf(
  nodes: { id: string; parentId: string | null }[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur: string | null = candidateId
  const seen = new Set<string>()
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/**
 * 위계 재설정. parentId=null 이면 루트.
 * 자기 자신·자손을 부모로 지정하면 거부.
 */
export async function setMindMapParent(
  nodeId: string,
  parentId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (parentId === nodeId) {
    return { ok: false, reason: '자기 자신을 부모로 둘 수 없습니다' }
  }
  const node = await db.mindMapNodes.get(nodeId)
  if (!node) return { ok: false, reason: '노드를 찾을 수 없습니다' }

  if (parentId) {
    const parent = await db.mindMapNodes.get(parentId)
    if (!parent) return { ok: false, reason: '부모 노드를 찾을 수 없습니다' }
    if (parent.mindMapId !== node.mindMapId) {
      return { ok: false, reason: '같은 마인드맵 안에서만 연결할 수 있습니다' }
    }
    const siblings = await db.mindMapNodes.where('mindMapId').equals(node.mindMapId).toArray()
    // parentId가 nodeId의 자손이면 순환
    if (isDescendantOf(siblings, nodeId, parentId)) {
      return { ok: false, reason: '하위 노드를 부모로 둘 수 없습니다' }
    }
  }

  await db.mindMapNodes.update(nodeId, { parentId })
  await db.mindMaps.update(node.mindMapId, { updatedAt: Date.now() })
  return { ok: true }
}

export async function moveMindMapNode(
  id: string,
  x: number,
  y: number,
  parentId?: string | null,
) {
  if (parentId !== undefined) {
    const result = await setMindMapParent(id, parentId)
    if (!result.ok) {
      await updateMindMapNodePosition(id, x, y)
      return result
    }
  }
  await updateMindMapNodePosition(id, x, y)
  return { ok: true as const }
}

export async function addNodeToMindMap(
  mindMapId: string,
  nodeId: string,
  parentId: string | null,
  x: number,
  y: number,
) {
  const existing = await db.mindMapNodes
    .where('mindMapId')
    .equals(mindMapId)
    .filter((row) => row.nodeId === nodeId)
    .first()
  if (existing) return existing.id
  const id = uuid()
  await db.mindMapNodes.add({
    id,
    mindMapId,
    nodeId,
    parentId,
    x,
    y,
  })
  return id
}

export async function exportMindMapOpml(mindMapId: string): Promise<Blob> {
  const mm = await db.mindMaps.get(mindMapId)
  const mmNodes = await db.mindMapNodes.where('mindMapId').equals(mindMapId).toArray()
  const nodes = await db.nodes.toArray()
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const labelOf = (m: MindMapNode) =>
    m.label || (m.nodeId ? nodeMap.get(m.nodeId)?.text.slice(0, 80) : '…') || '…'

  const render = (parentId: string | null, indent: string): string => {
    return mmNodes
      .filter((n) => n.parentId === parentId)
      .map((n) => {
        const text = labelOf(n)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
        const kids = render(n.id, indent + '  ')
        if (kids) {
          return `${indent}<outline text="${text}">\n${kids}${indent}</outline>\n`
        }
        return `${indent}<outline text="${text}"/>\n`
      })
      .join('')
  }

  const body = `<?xml version="1.0"?>\n<opml version="2.0">\n<head><title>${
    mm?.name ?? 'MindMap'
  }</title></head>\n<body>\n${render(null, '  ')}</body>\n</opml>`
  return new Blob([body], { type: 'text/xml;charset=utf-8' })
}
