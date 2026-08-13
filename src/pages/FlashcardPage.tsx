import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Rating, State, type Grade } from 'ts-fsrs'
import { db } from '@/lib/db'
import {
  clearEchoedAnswers,
  downloadAnkiExport,
  listFlashcardsByExcerpt,
  reviewFlashcard,
  setFlashcardAnswer,
  syncNodesToFlashcards,
  type FlashcardListItem,
} from '@/lib/fsrs'
import { useUiStore } from '@/store/uiStore'
import './FlashcardPage.css'

type View = 'list' | 'review'
type Filter = 'all' | 'noAnswer' | 'due'

/** 발췌가 있던 자리 — PDF 는 쪽, EPUB 는 장 */
function spotOf(item: FlashcardListItem): string | null {
  if (item.pageIndex === undefined) return null
  return item.format === 'epub' ? `${item.pageIndex + 1}장` : `${item.pageIndex + 1}쪽`
}

export function FlashcardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const setPendingJump = useUiStore((s) => s.setPendingJump)

  const [view, setView] = useState<View>('list')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** 복습 차례를 기다리는 카드 — 평가하면 빠지고, 미루면 뒤로 돌아간다 */
  const [queue, setQueue] = useState<string[]>([])

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const items = useLiveQuery(
    () => (projectId ? listFlashcardsByExcerpt(projectId) : []),
    [projectId],
    [] as FlashcardListItem[],
  )

  // 문제와 정답이 똑같이 적힌 옛 카드는 정답 자리를 비워 다시 적게 한다
  useEffect(() => {
    if (projectId) void clearEchoedAnswers(projectId)
  }, [projectId])

  const byId = useMemo(
    () => new Map(items.map((i) => [i.card.id, i] as const)),
    [items],
  )
  const stats = useMemo(() => {
    const learning = items.filter(
      (i) => i.card.state === State.Learning || i.card.state === State.Relearning,
    ).length
    return {
      total: items.length,
      due: items.filter((i) => i.due).length,
      noAnswer: items.filter((i) => !i.hasAnswer).length,
      newCount: items.filter((i) => i.card.state === State.New).length,
      learning,
    }
  }, [items])
  const manyDocs = useMemo(
    () => new Set(items.map((i) => i.documentId)).size > 1,
    [items],
  )

  const shown = items.filter((i) =>
    filter === 'noAnswer' ? !i.hasAnswer : filter === 'due' ? i.due : true,
  )

  // 복습을 열 때 오늘 볼 카드를 기한 순으로 담는다
  useEffect(() => {
    if (view !== 'review') return
    setQueue((q) => {
      if (q.length) return q
      return items
        .filter((i) => i.due)
        .sort((a, b) => a.card.due - b.card.due)
        .map((i) => i.card.id)
    })
  }, [view, items])

  const current = queue.length ? byId.get(queue[0]) : undefined

  useEffect(() => {
    setDraft(current?.card.back ?? '')
    setWriting(false)
    setRevealed(false)
  }, [current?.card.id])

  if (!projectId) return null
  if (project === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!project) return <div className="empty-state">프로젝트를 찾을 수 없습니다</div>

  const openCard = (item: FlashcardListItem) => {
    if (openId === item.card.id) {
      setOpenId(null)
      return
    }
    setOpenId(item.card.id)
    setDraft(item.card.back)
  }

  const saveAnswer = async (cardId: string, text: string) => {
    const answer = text.trim()
    if (!answer) return
    setBusy(true)
    try {
      await setFlashcardAnswer(cardId, answer)
    } finally {
      setBusy(false)
    }
  }

  /** 발췌한 자리로 옮겨 원문을 보며 정답을 적을 수 있게 한다 */
  const openSource = (item: FlashcardListItem) => {
    if (!item.documentId || !item.highlightId) return
    setPendingJump({ documentId: item.documentId, highlightId: item.highlightId })
    navigate(`/project/${projectId}/read/${item.documentId}`)
  }

  const postpone = () => setQueue((q) => (q.length < 2 ? q : [...q.slice(1), q[0]]))

  const rate = async (rating: Grade) => {
    if (!current) return
    setBusy(true)
    try {
      await reviewFlashcard(current.card.id, rating)
      setQueue((q) => q.slice(1))
      setRevealed(false)
    } finally {
      setBusy(false)
    }
  }

  /* 번호 · 자리 · 제목 · 상태 — 접힌 카드와 펼친 카드가 같은 머리글을 쓴다 */
  const cardMeta = (item: FlashcardListItem) => (
    <>
      <span className="fc-num">{item.order}</span>
      {spotOf(item) && <span className="fc-spot">{spotOf(item)}</span>}
      {manyDocs && <span className="fc-tile-loc">{item.documentTitle}</span>}
      {!item.hasAnswer ? (
        <span className="fc-flag">정답 미작성</span>
      ) : (
        item.due && <span className="fc-flag due">오늘 복습</span>
      )}
    </>
  )

  const answerBox = (cardId: string, onDone: () => void, canCancel: boolean) => (
    <>
      <textarea
        className="input fc-answer"
        autoFocus
        rows={4}
        placeholder="이 발췌에 대한 정답을 적어 주세요"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && canCancel) onDone()
          // 줄바꿈은 그대로 두고, 저장은 Ctrl+Enter 로
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            void saveAnswer(cardId, draft).then(onDone)
          }
        }}
      />
      <div className="fc-answer-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !draft.trim()}
          onClick={() => void saveAnswer(cardId, draft).then(onDone)}
        >
          정답 저장
        </button>
        <span className="fc-answer-hint">Ctrl+Enter 로 저장</span>
      </div>
    </>
  )

  return (
    <div className="fc-page">
      <header className="fc-head">
        <div>
          <Link to={`/project/${projectId}`} className="back-link">
            ← {project.name}
          </Link>
          <h1>플래시카드</h1>
          <p className="meta">
            FSRS · 전체 {stats.total} · 오늘 복습 {stats.due} · 신규 {stats.newCount} · 학습 중{' '}
            {stats.learning}
            {stats.noAnswer > 0 && ` · 정답 미작성 ${stats.noAnswer}`}
          </p>
        </div>
        <div className="fc-actions">
          <div className="fc-tabs">
            <button
              className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`}
              onClick={() => setView('list')}
            >
              전체 보기
            </button>
            <button
              className={`btn btn-sm ${view === 'review' ? 'btn-primary' : ''}`}
              onClick={() => {
                setOpenId(null)
                setView('review')
              }}
            >
              한 장씩 복습
            </button>
          </div>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await syncNodesToFlashcards(projectId)
                setToast(n ? `${n}장 생성 · 정답을 적어 주세요` : '새 카드 없음 (이미 동기화됨)')
              } finally {
                setBusy(false)
                setTimeout(() => setToast(null), 2500)
              }
            }}
          >
            발췌 → 카드 동기화
          </button>
          <button className="btn" onClick={() => void downloadAnkiExport(projectId)}>
            Anki 내보내기
          </button>
        </div>
      </header>

      {view === 'list' ? (
        <div className="fc-list-body">
          <div className="fc-filters">
            <button
              className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : ''}`}
              onClick={() => setFilter('all')}
            >
              전체 {stats.total}
            </button>
            <button
              className={`btn btn-sm ${filter === 'noAnswer' ? 'btn-primary' : ''}`}
              onClick={() => setFilter('noAnswer')}
            >
              정답 미작성 {stats.noAnswer}
            </button>
            <button
              className={`btn btn-sm ${filter === 'due' ? 'btn-primary' : ''}`}
              onClick={() => setFilter('due')}
            >
              오늘 복습 {stats.due}
            </button>
            <span className="fc-list-hint">번호는 원문에 나오는 발췌 순서입니다</span>
          </div>

          {!shown.length ? (
            <div className="fc-empty">
              <p>{items.length ? '해당하는 카드가 없습니다.' : '카드가 없습니다.'}</p>
              <p className="muted">
                {items.length ? '다른 묶음을 골라 보세요.' : '발췌를 동기화해 카드를 만드세요.'}
              </p>
            </div>
          ) : (
            <ul className="fc-grid">
              {shown.map((item) => {
                const open = openId === item.card.id
                return (
                  <li
                    key={item.card.id}
                    className={`fc-tile ${open ? 'open' : ''} ${item.hasAnswer ? '' : 'blank'}`}
                  >
                    {open ? (
                      <>
                        <div className="fc-tile-head">{cardMeta(item)}</div>
                        <p className="fc-tile-text full">{item.card.front}</p>
                        <div className="fc-tile-open">
                          <span className="fc-label">정답</span>
                          {answerBox(item.card.id, () => setOpenId(null), true)}
                          <div className="fc-tile-links">
                            {item.documentId && item.highlightId && (
                              <button className="btn btn-sm" onClick={() => openSource(item)}>
                                원문 보기
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => setOpenId(null)}>
                              닫기
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <button className="fc-tile-pick" onClick={() => openCard(item)}>
                        <span className="fc-tile-head">{cardMeta(item)}</span>
                        <span className="fc-tile-text">{item.card.front}</span>
                        <span className={`fc-tile-answer ${item.hasAnswer ? '' : 'muted'}`}>
                          {item.hasAnswer ? item.card.back : '눌러서 정답을 적으세요'}
                        </span>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="fc-body">
          {!current ? (
            <div className="fc-empty">
              <p>복습할 카드가 없습니다.</p>
              <p className="muted">발췌를 동기화하거나 나중에 다시 확인하세요.</p>
            </div>
          ) : (
            <div className="fc-card">
              <div className="fc-side">
                <span className="fc-label">
                  문제 (발췌) · {current.order}번{' '}
                  <span className="muted fc-where">
                    {[spotOf(current), manyDocs ? current.documentTitle : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <p>{current.card.front}</p>
              </div>
              {writing || !current.hasAnswer ? (
                <div className="fc-side fc-back">
                  <span className="fc-label">정답</span>
                  {answerBox(
                    current.card.id,
                    () => {
                      setWriting(false)
                      setRevealed(true)
                    },
                    current.hasAnswer,
                  )}
                  {!current.hasAnswer && (
                    <div className="fc-answer-actions">
                      <button className="btn" disabled={queue.length < 2} onClick={postpone}>
                        나중에 적기
                      </button>
                    </div>
                  )}
                </div>
              ) : revealed ? (
                <>
                  <div className="fc-side fc-back">
                    <div className="fc-back-head">
                      <span className="fc-label">정답</span>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setDraft(current.card.back)
                          setWriting(true)
                        }}
                      >
                        정답 고치기
                      </button>
                    </div>
                    <p>{current.card.back}</p>
                  </div>
                  <div className="fc-ratings">
                    <button
                      className="btn rating-again"
                      disabled={busy}
                      onClick={() => void rate(Rating.Again)}
                    >
                      Again
                    </button>
                    <button
                      className="btn rating-hard"
                      disabled={busy}
                      onClick={() => void rate(Rating.Hard)}
                    >
                      Hard
                    </button>
                    <button
                      className="btn rating-good"
                      disabled={busy}
                      onClick={() => void rate(Rating.Good)}
                    >
                      Good
                    </button>
                    <button
                      className="btn rating-easy"
                      disabled={busy}
                      onClick={() => void rate(Rating.Easy)}
                    >
                      Easy
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn btn-primary fc-reveal" onClick={() => setRevealed(true)}>
                  정답 보기
                </button>
              )}
              <p className="fc-progress">남은 카드 {queue.length}장</p>
            </div>
          )}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
