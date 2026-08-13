import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Rating, type Grade } from 'ts-fsrs'
import { db } from '@/lib/db'
import {
  clearEchoedAnswers,
  downloadAnkiExport,
  getDueFlashcards,
  getReviewStats,
  reviewFlashcard,
  setFlashcardAnswer,
  syncNodesToFlashcards,
} from '@/lib/fsrs'
import type { Flashcard } from '@/types'
import './FlashcardPage.css'

export function FlashcardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [queue, setQueue] = useState<Flashcard[]>([])
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    due: 0,
    learning: 0,
    review: 0,
    newCount: 0,
    noAnswer: 0,
  })
  const [draft, setDraft] = useState('')
  const [writing, setWriting] = useState(false)

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )

  const refresh = async () => {
    if (!projectId) return
    // 문제와 정답이 똑같이 적힌 옛 카드는 정답 자리를 비워 다시 적게 한다
    await clearEchoedAnswers(projectId)
    setStats(await getReviewStats(projectId))
    setQueue(await getDueFlashcards(projectId))
    setRevealed(false)
  }

  useEffect(() => {
    void refresh()
  }, [projectId])

  const current = queue[0]

  // 카드가 바뀌면 적던 내용과 펼친 상태를 정리한다
  useEffect(() => {
    setDraft(current?.back ?? '')
    setWriting(false)
    setRevealed(false)
  }, [current?.id])

  if (!projectId) return null
  if (project === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!project) return <div className="empty-state">프로젝트를 찾을 수 없습니다</div>

  const hasAnswer = Boolean(current?.back.trim())

  const saveAnswer = async () => {
    if (!current) return
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      await setFlashcardAnswer(current.id, text)
      setQueue((q) => q.map((c) => (c.id === current.id ? { ...c, back: text } : c)))
      setWriting(false)
      setRevealed(true)
      setStats(await getReviewStats(projectId))
    } finally {
      setBusy(false)
    }
  }

  /** 정답을 아직 못 적었으면 뒤로 미뤄 둔다 */
  const postpone = () => setQueue((q) => [...q.slice(1), q[0]])

  const rate = async (rating: Grade) => {
    if (!current) return
    setBusy(true)
    try {
      await reviewFlashcard(current.id, rating)
      setQueue((q) => q.slice(1))
      setRevealed(false)
      setStats(await getReviewStats(projectId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fc-page">
      <header className="fc-head">
        <div>
          <Link to={`/project/${projectId}`} className="back-link">
            ← {project.name}
          </Link>
          <h1>플래시카드 복습</h1>
          <p className="meta">
            FSRS · 오늘 복습 {stats.due} · 전체 {stats.total} · 신규 {stats.newCount} · 학습 중{' '}
            {stats.learning}
            {stats.noAnswer > 0 && ` · 정답 미작성 ${stats.noAnswer}`}
          </p>
        </div>
        <div className="fc-actions">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await syncNodesToFlashcards(projectId)
                setToast(n ? `${n}장 생성 · 정답을 적어 주세요` : '새 카드 없음 (이미 동기화됨)')
                await refresh()
              } finally {
                setBusy(false)
                setTimeout(() => setToast(null), 2500)
              }
            }}
          >
            발췌 → 카드 동기화
          </button>
          <button
            className="btn"
            onClick={() => void downloadAnkiExport(projectId)}
          >
            Anki 내보내기
          </button>
        </div>
      </header>

      <div className="fc-body">
        {!current ? (
          <div className="fc-empty">
            <p>복습할 카드가 없습니다.</p>
            <p className="muted">발췌를 동기화하거나 나중에 다시 확인하세요.</p>
          </div>
        ) : (
          <div className="fc-card">
            <div className="fc-side">
              <span className="fc-label">문제 (발췌)</span>
              <p>{current.front}</p>
            </div>
            {writing || !hasAnswer ? (
              <div className="fc-side fc-back">
                <span className="fc-label">정답</span>
                <textarea
                  className="input fc-answer"
                  autoFocus
                  rows={4}
                  placeholder="이 발췌에 대한 정답을 적어 주세요"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && hasAnswer) {
                      setDraft(current.back)
                      setWriting(false)
                    }
                    // 줄바꿈은 그대로 두고, 저장은 Ctrl+Enter 로
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveAnswer()
                  }}
                />
                <div className="fc-answer-actions">
                  <button
                    className="btn btn-primary"
                    disabled={busy || !draft.trim()}
                    onClick={() => void saveAnswer()}
                  >
                    정답 저장
                  </button>
                  {hasAnswer ? (
                    <button
                      className="btn"
                      onClick={() => {
                        setDraft(current.back)
                        setWriting(false)
                      }}
                    >
                      취소
                    </button>
                  ) : (
                    <button className="btn" disabled={queue.length < 2} onClick={postpone}>
                      나중에 적기
                    </button>
                  )}
                  <span className="fc-answer-hint">Ctrl+Enter 로 저장</span>
                </div>
              </div>
            ) : revealed ? (
              <>
                <div className="fc-side fc-back">
                  <div className="fc-back-head">
                    <span className="fc-label">정답</span>
                    <button className="btn btn-sm" onClick={() => setWriting(true)}>
                      정답 고치기
                    </button>
                  </div>
                  <p>{current.back}</p>
                </div>
                <div className="fc-ratings">
                  <button className="btn rating-again" disabled={busy} onClick={() => void rate(Rating.Again)}>
                    Again
                  </button>
                  <button className="btn rating-hard" disabled={busy} onClick={() => void rate(Rating.Hard)}>
                    Hard
                  </button>
                  <button className="btn rating-good" disabled={busy} onClick={() => void rate(Rating.Good)}>
                    Good
                  </button>
                  <button className="btn rating-easy" disabled={busy} onClick={() => void rate(Rating.Easy)}>
                    Easy
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-primary fc-reveal" onClick={() => setRevealed(true)}>
                정답 보기
              </button>
            )}
            <p className="fc-progress">
              남은 카드 {queue.length}장
            </p>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
