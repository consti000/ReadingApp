import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import { HIGHLIGHT_COLORS, type MindMapNode } from '@/types'

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

/** 화면에 놓이는 카드의 대략적인 크기 — 새 노드 자리를 고를 때 쓴다 */
const SPOT_W = 232
const SPOT_H = 120

/** 이미 놓인 카드와 겹치지 않도록 아래로 밀어 둔 자리 */
export function freeSpot(
  taken: { x: number; y: number }[],
  x: number,
  y: number,
): { x: number; y: number } {
  const spot = { x, y }
  const hits = () =>
    taken.some((t) => Math.abs(t.x - spot.x) < SPOT_W && Math.abs(t.y - spot.y) < SPOT_H)
  for (let guard = 0; guard < 40 && hits(); guard++) spot.y += SPOT_H
  return spot
}

/** 손으로 만든 노드 — 발췌와 이어지지 않고 적어 넣은 글만 갖는다 */
export async function createMindMapNode(
  mindMapId: string,
  x: number,
  y: number,
  parentId: string | null = null,
): Promise<string> {
  const id = uuid()
  await db.mindMapNodes.add({ id, mindMapId, nodeId: null, label: '', parentId, x, y })
  await db.mindMaps.update(mindMapId, { updatedAt: Date.now() })
  return id
}

/**
 * 노드에 보일 글을 고친다. 발췌에서 온 노드를 비우면 붙여 둔 이름을 떼어
 * 다시 발췌문을 보여 준다. 원문 하이라이트와 워크스페이스 카드는 건드리지 않는다.
 */
export async function renameMindMapNode(id: string, label: string): Promise<void> {
  const row = await db.mindMapNodes.get(id)
  if (!row) return
  const text = label.trim()
  if (!text && row.nodeId) {
    delete row.label
    await db.mindMapNodes.put(row)
  } else {
    await db.mindMapNodes.update(id, { label: text })
  }
  await db.mindMaps.update(row.mindMapId, { updatedAt: Date.now() })
}

/** 그 노드 아래 달린 모든 노드 */
export function descendantIds(
  rows: { id: string; parentId: string | null }[],
  id: string,
): string[] {
  const found: string[] = []
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const r of rows) {
      if (r.parentId !== cur || found.includes(r.id)) continue
      found.push(r.id)
      queue.push(r.id)
    }
  }
  return found
}

/** 지우기 전의 모습 — 되돌리기에 쓴다 */
export interface MindMapRemoval {
  removed: MindMapNode[]
  reparented: { id: string; parentId: string | null }[]
}

/**
 * 지도에서만 노드를 뺀다. 발췌에서 온 노드라도 하이라이트·워크스페이스 카드는 남는다.
 * 'promote'는 자식을 그 위 부모에 이어 붙이고, 'subtree'는 아래 가지까지 통째로 뺀다.
 */
export async function deleteMindMapNode(
  id: string,
  mode: 'promote' | 'subtree',
): Promise<MindMapRemoval> {
  const row = await db.mindMapNodes.get(id)
  if (!row) return { removed: [], reparented: [] }
  const rows = await db.mindMapNodes.where('mindMapId').equals(row.mindMapId).toArray()

  if (mode === 'subtree') {
    const ids = [id, ...descendantIds(rows, id)]
    await db.mindMapNodes.bulkDelete(ids)
    await db.mindMaps.update(row.mindMapId, { updatedAt: Date.now() })
    return { removed: rows.filter((r) => ids.includes(r.id)), reparented: [] }
  }

  const children = rows.filter((r) => r.parentId === id)
  for (const c of children) await db.mindMapNodes.update(c.id, { parentId: row.parentId })
  await db.mindMapNodes.delete(id)
  await db.mindMaps.update(row.mindMapId, { updatedAt: Date.now() })
  return { removed: [row], reparented: children.map((c) => ({ id: c.id, parentId: id })) }
}

export async function restoreMindMapNodes(edit: MindMapRemoval): Promise<void> {
  if (!edit.removed.length) return
  await db.mindMapNodes.bulkAdd(edit.removed)
  for (const r of edit.reparented) await db.mindMapNodes.update(r.id, { parentId: r.parentId })
  await db.mindMaps.update(edit.removed[0].mindMapId, { updatedAt: Date.now() })
}

/** 노드에 보여 줄 글 — 직접 붙인 이름이 없으면 발췌문 앞머리를 쓴다 */
async function readMindMapCards(mindMapId: string) {
  const map = await db.mindMaps.get(mindMapId)
  const rows = await db.mindMapNodes.where('mindMapId').equals(mindMapId).toArray()
  const nodes = await db.nodes.toArray()
  const byNode = new Map(nodes.map((n) => [n.id, n]))
  return {
    name: map?.name ?? '마인드맵',
    rows,
    labelOf: (m: MindMapNode) =>
      m.label || (m.nodeId ? byNode.get(m.nodeId)?.text.slice(0, 100) : '…') || '…',
    colorOf: (m: MindMapNode) =>
      (m.nodeId ? HIGHLIGHT_COLORS[byNode.get(m.nodeId)?.color ?? 'yellow'] : null) ?? PAPER.accent,
  }
}

/** 화면에서 쓰는 색·크기를 그림에도 그대로 쓴다 */
const PAPER = {
  bg: '#141a22',
  card: '#243044',
  folder: '#1e2a38',
  border: 'rgba(196, 165, 116, 0.18)',
  edge: 'rgba(196, 165, 116, 0.45)',
  accent: '#c4a574',
  text: '#e8e2d6',
  muted: '#9aa3b2',
}

const CARD_WIDTH = 220
const CARD_PAD = 12
const LABEL_SIZE = 14
const LABEL_LINE = 19
/** 화면에서도 세 줄까지만 보여 주므로 그림도 같게 자른다 */
const LABEL_LINES = 3
const IMAGE_MARGIN = 40
const TITLE_SIZE = 22
/** 글자가 또렷하도록 두 배 크기로 그린다 */
const IMAGE_SCALE = 2

/**
 * 글상자 너비에 맞춰 줄을 나눈다. 낱말은 되도록 끊지 않고, 한 줄에도 안 들어가는
 * 긴 낱말은 글자 단위로 자른다. 정해진 줄 수를 넘기면 뒤를 버리고 「…」를 붙인다.
 */
function wrapLabel(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  let cutOff = false

  const fits = (s: string) => ctx.measureText(s).width <= width

  let w = 0
  for (; w < words.length && lines.length < LABEL_LINES; w++) {
    let word = words[w]
    while (word && lines.length < LABEL_LINES) {
      const joined = line ? `${line} ${word}` : word
      if (fits(joined)) {
        line = joined
        word = ''
        break
      }
      if (line) {
        lines.push(line)
        line = ''
        continue
      }
      let take = word.length
      while (take > 1 && !fits(word.slice(0, take))) take--
      lines.push(word.slice(0, take))
      word = word.slice(take)
    }
    if (word) cutOff = true
  }
  if (w < words.length) cutOff = true

  if (line && lines.length < LABEL_LINES) lines.push(line)
  else if (line) cutOff = true

  if (cutOff && lines.length) {
    let last = lines[lines.length - 1]
    while (last && !fits(`${last}…`)) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return lines
}

/**
 * 마인드맵을 그림 한 장으로 그린다.
 *
 * 화면을 그대로 찍는 대신 저장된 위치·연결을 보고 다시 그린다. 그래서 지금 어디를 보고 있든
 * 전체가 한 장에 담기고, 끌기 손잡이나 버튼 같은 조작용 표시는 빠진다.
 */
export async function exportMindMapImage(mindMapId: string): Promise<Blob | null> {
  const { name, rows, labelOf, colorOf } = await readMindMapCards(mindMapId)
  if (!rows.length) return null

  // 글꼴이 준비되기 전에 재면 줄 나눔이 어긋난다
  await document.fonts?.ready

  const ruler = document.createElement('canvas').getContext('2d')
  if (!ruler) return null
  const bodyFont = (size: number, weight = 400) =>
    `${weight} ${size}px 'Source Sans 3', 'Segoe UI', sans-serif`
  const cards = rows.map((m) => {
    const folder = !m.nodeId
    // 굵기가 다르면 폭도 달라지므로 그릴 때와 같은 글꼴로 잰다
    ruler.font = bodyFont(LABEL_SIZE, folder ? 600 : 400)
    const lines = wrapLabel(ruler, labelOf(m), CARD_WIDTH - CARD_PAD * 2)
    return {
      id: m.id,
      parentId: m.parentId,
      x: m.x,
      y: m.y,
      lines,
      height: CARD_PAD * 2 + lines.length * LABEL_LINE,
      folder,
      color: colorOf(m),
    }
  })

  const left = Math.min(...cards.map((c) => c.x))
  const top = Math.min(...cards.map((c) => c.y))
  const right = Math.max(...cards.map((c) => c.x + CARD_WIDTH))
  const bottom = Math.max(...cards.map((c) => c.y + c.height))
  const headroom = TITLE_SIZE + 18
  const width = right - left + IMAGE_MARGIN * 2
  const height = bottom - top + IMAGE_MARGIN * 2 + headroom

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * IMAGE_SCALE)
  canvas.height = Math.ceil(height * IMAGE_SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE)

  ctx.fillStyle = PAPER.bg
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = PAPER.text
  // 제목 글꼴(Instrument Serif)에는 한글이 없어 본문 글꼴로 적는다
  ctx.font = bodyFont(TITLE_SIZE, 600)
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(name, IMAGE_MARGIN, IMAGE_MARGIN + TITLE_SIZE - 4)

  // 좌표를 그림 안쪽으로 옮겨 둔다
  const at = (c: { x: number; y: number }) => ({
    x: c.x - left + IMAGE_MARGIN,
    y: c.y - top + IMAGE_MARGIN + headroom,
  })
  const byId = new Map(cards.map((c) => [c.id, c]))

  ctx.strokeStyle = PAPER.edge
  ctx.lineWidth = 2
  for (const c of cards) {
    const parent = c.parentId ? byId.get(c.parentId) : null
    if (!parent) continue
    const a = at(parent)
    const b = at(c)
    ctx.beginPath()
    ctx.moveTo(a.x + CARD_WIDTH / 2, a.y + parent.height / 2)
    ctx.lineTo(b.x + CARD_WIDTH / 2, b.y + c.height / 2)
    ctx.stroke()
  }

  for (const c of cards) {
    const { x, y } = at(c)
    ctx.beginPath()
    ctx.roundRect(x, y, CARD_WIDTH, c.height, 8)
    ctx.fillStyle = c.folder ? PAPER.folder : PAPER.card
    ctx.fill()
    ctx.strokeStyle = PAPER.border
    ctx.lineWidth = 1
    ctx.stroke()

    // 왼쪽 띠로 하이라이트 색을 보여 준다 (화면과 같다)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, CARD_WIDTH, c.height, 8)
    ctx.clip()
    ctx.fillStyle = c.color
    ctx.fillRect(x, y, 3, c.height)
    ctx.restore()

    ctx.fillStyle = c.folder ? PAPER.accent : PAPER.text
    ctx.font = bodyFont(LABEL_SIZE, c.folder ? 600 : 400)
    c.lines.forEach((line, i) => {
      ctx.fillText(line, x + CARD_PAD, y + CARD_PAD + LABEL_LINE * i + LABEL_SIZE)
    })
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
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
