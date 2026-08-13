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
import type { Flashcard } from '@/types'

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

export async function getDueFlashcards(projectId: string, now = Date.now()): Promise<Flashcard[]> {
  const all = await db.flashcards.where('projectId').equals(projectId).toArray()
  return all.filter((f) => f.due <= now).sort((a, b) => a.due - b.due)
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

export async function getReviewStats(projectId: string) {
  const cards = await db.flashcards.where('projectId').equals(projectId).toArray()
  const now = Date.now()
  const due = cards.filter((c) => c.due <= now).length
  const learning = cards.filter((c) => c.state === State.Learning || c.state === State.Relearning).length
  const review = cards.filter((c) => c.state === State.Review).length
  const newCount = cards.filter((c) => c.state === State.New).length
  const noAnswer = cards.filter((c) => !c.back.trim()).length
  return { total: cards.length, due, learning, review, newCount, noAnswer }
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
