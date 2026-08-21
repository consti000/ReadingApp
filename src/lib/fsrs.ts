import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs'
import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import { compareHighlightPlace } from '@/lib/highlightOrder'
import type { DocumentFormat, Flashcard } from '@/types'

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, maximum_interval: 365 }))

export { Rating }

function toFsrsCard(f: Flashcard): Card {
  return {
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsed_days,
    scheduled_days: f.scheduled_days,
    learning_steps: 0,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state as State,
    last_review: f.last_review ? new Date(f.last_review) : undefined,
  }
}

function fromFsrsCard(
  base: Pick<Flashcard, 'id' | 'deckId' | 'projectId' | 'nodeId' | 'front' | 'back' | 'createdAt'>,
  card: Card,
): Flashcard {
  return {
    ...base,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.getTime(),
    updatedAt: Date.now(),
  }
}

export async function ensureDefaultDeck(projectId: string): Promise<string> {
  const existing = await db.flashcardDecks.where('projectId').equals(projectId).first()
  if (existing) return existing.id
  const now = Date.now()
  const id = uuid()
  await db.flashcardDecks.add({
    id,
    projectId,
    name: '기본 덱',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function syncNodesToFlashcards(projectId: string): Promise<number> {
  const deckId = await ensureDefaultDeck(projectId)
  const nodes = await db.nodes.where('projectId').equals(projectId).toArray()
  const existing = await db.flashcards.where('projectId').equals(projectId).toArray()
  const byNode = new Set(existing.map((f) => f.nodeId))
  let added = 0
  const now = Date.now()

  for (const node of nodes) {
    if (byNode.has(node.id)) continue
    const empty = createEmptyCard(new Date())
    const card = fromFsrsCard(
      {
        id: uuid(),
        deckId,
        projectId,
        nodeId: node.id,
        front: node.text.slice(0, 200),
        // 정답은 사람이 적는 자리다. 메모가 있으면 그것으로 시작하고, 없으면 비워 둔다
        back: node.memo?.trim() ?? '',
        createdAt: now,
      },
      empty,
    )
    await db.flashcards.add(card)
    added++
  }
  await db.flashcardDecks.update(deckId, { updatedAt: now })
  return added
}

/** 정답을 적거나 고친다 */
export async function setFlashcardAnswer(cardId: string, back: string): Promise<void> {
  await db.flashcards.update(cardId, { back: back.trim(), updatedAt: Date.now() })
}

/** 정답 자리에 문제와 같은 글이 들어 있는지 */
function echoesQuestion(front: string, back: string): boolean {
  const question = front.trim()
  const answer = back.trim()
  if (!answer) return false
  // 예전 카드는 앞면을 200자에서 자르고 뒷면에는 발췌문 전체를 넣었다
  return answer === question || (question.length === 200 && answer.startsWith(question))
}

/**
 * 문제와 정답이 똑같이 적힌 카드를 비워 정답을 적을 수 있게 한다.
 * 메모 없이 만든 카드가 발췌문을 양쪽에 넣던 때에 생긴 것들이다.
 */
export async function clearEchoedAnswers(projectId: string): Promise<number> {
  const cards = await db.flashcards.where('projectId').equals(projectId).toArray()
  const echoed = cards.filter((c) => echoesQuestion(c.front, c.back))
  if (!echoed.length) return 0
  const now = Date.now()
  await db.flashcards.bulkPut(echoed.map((c) => ({ ...c, back: '', updatedAt: now })))
  return echoed.length
}

export interface FlashcardListItem {
  card: Flashcard
  /** 원문 발췌 순서 번호 (1부터) */
  order: number
  documentId?: string
  documentTitle: string
  /** 원문으로 옮겨 갈 때 쓴다 */
  highlightId?: string
  /** PDF 는 쪽 번호, EPUB 는 장(챕터) 번호 */
  pageIndex?: number
  format: DocumentFormat
  hasAnswer: boolean
  due: boolean
}

/**
 * 모든 카드를 원문 발췌 순서대로 늘어놓고 번호를 붙인다.
 * 문서는 프로젝트에 들인 순서, 문서 안에서는 쪽·줄 순서를 따른다.
 * 원문을 찾지 못한 카드(하이라이트가 지워진 경우)는 뒤에 붙인다.
 */
export async function listFlashcardsByExcerpt(
  projectId: string,
  now = Date.now(),
): Promise<FlashcardListItem[]> {
  const [cards, nodes, highlights, docs] = await Promise.all([
    db.flashcards.where('projectId').equals(projectId).toArray(),
    db.nodes.where('projectId').equals(projectId).toArray(),
    db.highlights.where('projectId').equals(projectId).toArray(),
    db.documents.where('projectId').equals(projectId).toArray(),
  ])

  const docRank = new Map(
    [...docs]
      .sort((a, b) => a.createdAt - b.createdAt || a.title.localeCompare(b.title))
      .map((d, i) => [d.id, i] as const),
  )
  const docById = new Map(docs.map((d) => [d.id, d] as const))
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const))
  const highlightById = new Map(highlights.map((h) => [h.id, h] as const))

  const rows = cards.map((card) => {
    const node = nodeById.get(card.nodeId)
    const doc = node ? docById.get(node.documentId) : undefined
    const highlight = node ? highlightById.get(node.sourceHighlightId) : undefined
    return { card, doc, highlight }
  })

  const LAST = Number.MAX_SAFE_INTEGER
  rows.sort((a, b) => {
    const ra = a.doc ? (docRank.get(a.doc.id) ?? LAST) : LAST
    const rb = b.doc ? (docRank.get(b.doc.id) ?? LAST) : LAST
    if (ra !== rb) return ra - rb
    if (a.highlight && b.highlight) {
      return compareHighlightPlace(a.highlight, b.highlight, (a.doc?.format ?? 'pdf') === 'epub')
    }
    if (a.highlight) return -1
    if (b.highlight) return 1
    return a.card.createdAt - b.card.createdAt
  })

  return rows.map((r, i) => ({
    card: r.card,
    order: i + 1,
    documentId: r.doc?.id,
    documentTitle: r.doc?.title ?? '원문 없음',
    highlightId: r.highlight?.id,
    pageIndex: r.highlight?.pageIndex,
    format: r.doc?.format ?? 'pdf',
    hasAnswer: Boolean(r.card.back.trim()),
    due: r.card.due <= now,
  }))
}

export async function reviewFlashcard(cardId: string, rating: Grade): Promise<Flashcard | null> {
  const row = await db.flashcards.get(cardId)
  if (!row) return null
  const now = new Date()
  const recordLog = scheduler.repeat(toFsrsCard(row), now)
  const item = recordLog[rating]
  if (!item) return null
  const updated = fromFsrsCard(row, item.card)
  await db.flashcards.put(updated)
  return updated
}

export async function exportAnkiTsv(projectId: string): Promise<Blob> {
  const cards = await db.flashcards.where('projectId').equals(projectId).toArray()
  const lines = cards.map((c) => {
    const front = c.front.replace(/\t/g, ' ').replace(/\n/g, '<br>')
    const back = c.back.replace(/\t/g, ' ').replace(/\n/g, '<br>')
    return `${front}\t${back}`
  })
  return new Blob([`#separator:tab\n#html:true\n${lines.join('\n')}`], {
    type: 'text/tab-separated-values;charset=utf-8',
  })
}

export async function downloadAnkiExport(projectId: string): Promise<void> {
  const blob = await exportAnkiTsv(projectId)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `readlink-anki-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
