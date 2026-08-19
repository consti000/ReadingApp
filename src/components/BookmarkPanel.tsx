import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { createBookmark, deleteBookmark, renameBookmark } from '@/lib/actions'
import { useUiStore } from '@/store/uiStore'
import type { Bookmark } from '@/types'
import './BookmarkPanel.css'

export interface BookmarkPlace {
  pageIndex: number
  cfi?: string
  label: string
}

interface PanelProps {
  projectId: string
  /** 지금 읽고 있는 문서 — 있으면 그 문서 책갈피를 먼저 보여 준다 */
  documentId?: string
  open: boolean
  onClose: () => void
  /** 같은 문서면 뷰어가 직접 옮긴다. 다른 문서는 패널이 읽기 화면으로 보낸다 */
  onJump?: (bookmark: Bookmark) => void
}

interface ControlsProps {
  projectId: string
  documentId: string
  getPlace: () => BookmarkPlace | null
  onJump: (bookmark: Bookmark) => void
}

function spotOf(bm: Bookmark, format?: string): string {
  if (format === 'epub') return `${bm.pageIndex + 1}장`
  return `${bm.pageIndex + 1}쪽`
}

export function BookmarkPanel({ projectId, documentId, open, onClose, onJump }: PanelProps) {
  const navigate = useNavigate()
  const setPendingJump = useUiStore((s) => s.setPendingJump)
  const [scope, setScope] = useState<'doc' | 'all'>(documentId ? 'doc' : 'all')
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)

  const bookmarks = useLiveQuery(
    () => db.bookmarks.where('projectId').equals(projectId).sortBy('createdAt'),
    [projectId],
    [] as Bookmark[],
  )
  const documents = useLiveQuery(
    () => db.documents.where('projectId').equals(projectId).toArray(),
    [projectId],
    [] as { id: string; title: string; format?: string; createdAt: number }[],
  )

  useEffect(() => {
    if (!open) {
      setEditing(null)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing) setEditing(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, onClose])

  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents])
  const docRank = useMemo(
    () =>
      new Map(
        [...documents]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((d, i) => [d.id, i] as const),
      ),
    [documents],
  )

  const shown = useMemo(() => {
    const rows = scope === 'doc' && documentId
      ? bookmarks.filter((b) => b.documentId === documentId)
      : bookmarks
    return [...rows].sort((a, b) => {
      const ra = docRank.get(a.documentId) ?? 9999
      const rb = docRank.get(b.documentId) ?? 9999
      if (ra !== rb) return ra - rb
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
      return a.createdAt - b.createdAt
    })
  }, [bookmarks, scope, documentId, docRank])

  if (!open) return null

  const jump = (bm: Bookmark) => {
    if (documentId && bm.documentId === documentId && onJump) {
      onJump(bm)
      onClose()
      return
    }
    setPendingJump({ documentId: bm.documentId, bookmarkId: bm.id })
    navigate(`/project/${projectId}/read/${bm.documentId}`)
    onClose()
  }

  const saveName = async () => {
    if (!editing) return
    await renameBookmark(editing.id, editing.draft)
    setEditing(null)
  }

  return (
    <div
      className="bm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bm-dialog" role="dialog" aria-labelledby="bm-title">
        <header className="bm-head">
          <h2 id="bm-title">책갈피</h2>
          <div className="bm-tabs">
            {documentId && (
              <button
                className={`btn btn-sm ${scope === 'doc' ? 'btn-primary' : ''}`}
                onClick={() => setScope('doc')}
              >
                이 문서
              </button>
            )}
            <button
              className={`btn btn-sm ${scope === 'all' ? 'btn-primary' : ''}`}
              onClick={() => setScope('all')}
            >
              프로젝트 전체
            </button>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            닫기
          </button>
        </header>

        {!shown.length ? (
          <p className="bm-empty">
            {scope === 'doc'
              ? '이 문서에 단 책갈피가 없습니다. 도구막대의 책갈피로 지금 자리를 저장하세요.'
              : '아직 책갈피가 없습니다.'}
          </p>
        ) : (
          <ul className="bm-list">
            {shown.map((bm) => {
              const doc = docById.get(bm.documentId)
              const openEdit = editing?.id === bm.id
              return (
                <li key={bm.id} className="bm-item">
                  {openEdit ? (
                    <form
                      className="bm-edit"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void saveName()
                      }}
                    >
                      <input
                        className="input"
                        autoFocus
                        value={editing.draft}
                        onChange={(e) => setEditing({ id: bm.id, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setEditing(null)
                          }
                        }}
                      />
                      <button className="btn btn-sm btn-primary" type="submit">
                        저장
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        취소
                      </button>
                    </form>
                  ) : (
                    <>
                      <button className="bm-jump" onClick={() => jump(bm)}>
                        <span className="bm-label">{bm.label}</span>
                        {(() => {
                          const spot = spotOf(bm, doc?.format)
                          const title = scope === 'all' && doc ? doc.title : ''
                          const sub =
                            bm.label === spot
                              ? title
                              : [spot, title].filter(Boolean).join(' · ')
                          return sub ? <span className="bm-spot">{sub}</span> : null
                        })()}
                      </button>
                      <div className="bm-actions">
                        <button
                          className="btn btn-sm"
                          title="이름 바꾸기"
                          onClick={() => setEditing({ id: bm.id, draft: bm.label })}
                        >
                          ✎
                        </button>
                        <button
                          className="btn btn-sm"
                          title="삭제"
                          onClick={() => {
                            if (window.confirm('이 책갈피를 지울까요?')) void deleteBookmark(bm.id)
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** 읽기 도구막대에 붙는 책갈피 추가·목록 */
export function BookmarkControls({ projectId, documentId, getPlace, onJump }: ControlsProps) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const count =
    useLiveQuery(
      () => db.bookmarks.where('documentId').equals(documentId).count(),
      [documentId],
    ) ?? 0

  const add = async () => {
    const place = getPlace()
    if (!place) return
    const { created } = await createBookmark({
      documentId,
      projectId,
      pageIndex: place.pageIndex,
      cfi: place.cfi,
      label: place.label,
    })
    setToast(created ? `${place.label}에 책갈피를 달았습니다` : '이미 이 자리에 책갈피가 있습니다')
    window.setTimeout(() => setToast(null), 2200)
    if (!created) setOpen(true)
  }

  return (
    <div className="bm-controls">
      <button
        className="btn btn-sm bm-add"
        title="지금 보고 있는 자리에 책갈피"
        aria-label="책갈피 달기"
        onClick={() => void add()}
      >
        <svg className="bm-icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M6.2 2.8h11.6c.9 0 1.6.7 1.6 1.6v16.6c0 .7-.8 1.1-1.4.7L12 17.4 6 21.7c-.6.4-1.4 0-1.4-.7V4.4c0-.9.7-1.6 1.6-1.6z" />
        </svg>
      </button>
      <button
        className="btn btn-sm"
        title="책갈피 목록"
        onClick={() => setOpen(true)}
      >
        책갈피 목록{count > 0 ? ` ${count}` : ''}
      </button>
      <BookmarkPanel
        projectId={projectId}
        documentId={documentId}
        open={open}
        onClose={() => setOpen(false)}
        onJump={onJump}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
