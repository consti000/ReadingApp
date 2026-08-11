import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Rating, type Grade } from 'ts-fsrs'
import { db } from '@/lib/db'
import {
  downloadAnkiExport,
  getDueFlashcards,
  getReviewStats,
  reviewFlashcard,
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
  const [stats, setStats] = useState({ total: 0, due: 0, learning: 0, review: 0, newCount: 0 })

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )

  const refresh = async () => {
    if (!projectId) return
    setStats(await getReviewStats(projectId))
    setQueue(await getDueFlashcards(projectId))
    setRevealed(false)
  }

  useEffect(() => {
    void refresh()
  }, [projectId])

  if (!projectId) return null
  if (project === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!project) return <div className="empty-state">프로젝트를 찾을 수 없습니다</div>

  const current = queue[0]

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
                setToast(n ? `${n}장 생성` : '새 카드 없음 (이미 동기화됨)')
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
              <span className="fc-label">앞면</span>
              <p>{current.front}</p>
            </div>
            {revealed ? (
              <>
                <div className="fc-side fc-back">
                  <span className="fc-label">뒷면</span>
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
