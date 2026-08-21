import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { PdfViewer } from '@/components/PdfViewer'
import { EpubViewer } from '@/components/EpubViewer'
import { ColorPalette } from '@/components/ColorPalette'
import { PaneDivider } from '@/components/PaneDivider'
import { addNodeToWorkspace, deleteHighlight, updateHighlightColor } from '@/lib/actions'
import type { AnchorPort, AnchorProvider } from '@/lib/highlightAnchors'
import { clamp, useMediaQuery, usePaneSize } from '@/lib/panes'
import { sortHighlightsByPlace } from '@/lib/highlightOrder'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS } from '@/types'
import './ReadPage.css'

/** 손가락이 주 입력인 기기 — 카드를 떠나도 연결선을 바로 지우지 않는다 */
const COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

/** 카드 왼쪽 변에서 선이 붙는 높이 */
const CARD_ANCHOR_OFFSET = 18

const SIDEBAR_DEFAULT = 280
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 720
/** 사이드바를 아무리 넓혀도 본문에 이만큼은 남긴다 */
const DOC_MIN = 360

/** 좌표가 이만큼 연속으로 같으면 레이아웃이 정착한 것으로 본다 */
const SETTLE_FRAMES = 4

function sameLines(a: ConnectorLine[], b: ConnectorLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.id === b[i].id && l.path === b[i].path)
}

/** 색은 그릴 때 최신 하이라이트에서 읽으므로 좌표만 담는다 */
interface ConnectorLine {
  id: string
  path: string
  x: number
  y: number
}

export function ReadPage() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const navigate = useNavigate()

  const bodyRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const providerRef = useRef<AnchorProvider | null>(null)
  const rafRef = useRef(0)
  const settleRef = useRef(0)
  const linesRef = useRef<ConnectorLine[]>([])
  const [lines, setLines] = useState<ConnectorLine[]>([])

  const narrow = useMediaQuery('(max-width: 800px)')
  const [sidebarWidth, setSidebarWidth, commitSidebarWidth] = usePaneSize(
    'read-sidebar',
    SIDEBAR_DEFAULT,
  )
  const widthRef = useRef(sidebarWidth)
  const dragBaseRef = useRef(sidebarWidth)

  const activeHighlightId = useUiStore((s) => s.activeHighlightId)
  const setActiveHighlightId = useUiStore((s) => s.setActiveHighlightId)
  const setPendingJump = useUiStore((s) => s.setPendingJump)

  const doc = useLiveQuery(
    () => (documentId ? db.documents.get(documentId) : undefined),
    [documentId],
  )
  const workspace = useLiveQuery(
    async () => {
      if (!projectId) return undefined
      const list = await db.workspaces.where('projectId').equals(projectId).toArray()
      return list[0]
    },
    [projectId],
  )
  const highlights = useLiveQuery(
    () =>
      documentId
        ? db.highlights.where('documentId').equals(documentId).reverse().sortBy('createdAt')
        : [],
    [documentId],
  )
  const nodes = useLiveQuery(
    () => (documentId ? db.nodes.where('documentId').equals(documentId).toArray() : []),
    [documentId],
  )

  const isEpubDoc = (doc?.format ?? 'pdf') === 'epub'
  const orderedHighlights = useMemo(
    () => sortHighlightsByPlace(highlights ?? [], isEpubDoc),
    [highlights, isEpubDoc],
  )

  /**
   * 본문 좌표(뷰어가 계산)와 카드 위치(사이드바 DOM)를 합쳐 연결선을 만든다.
   * 스크롤·확대·페이지 이동마다 다시 재야 해서 rAF 로 한 프레임에 한 번만 계산한다.
   */
  const measure = useCallback((): boolean => {
    const body = bodyRef.current
    const provider = providerRef.current
    const snapshot = provider?.()
    const sideRect = sidebarRef.current?.getBoundingClientRect()
    // 좁은 화면에서는 사이드바가 숨겨져 이을 카드가 없다
    if (!body || !snapshot || !snapshot.anchors.size || !sideRect || sideRect.width < 1) {
      if (!linesRef.current.length) return false
      linesRef.current = []
      setLines([])
      return true
    }

    const bodyRect = body.getBoundingClientRect()
    const next: ConnectorLine[] = []

    for (const [id, anchor] of snapshot.anchors) {
      const card = body.querySelector<HTMLElement>(`[data-hl-card="${id}"]`)
      if (!card) continue
      const cardRect = card.getBoundingClientRect()
      if (cardRect.width < 1) continue
      // 사이드바를 스크롤해 카드가 가려졌으면 선을 그리지 않는다
      if (cardRect.bottom < sideRect.top || cardRect.top > sideRect.bottom) continue

      const x1 = anchor.x - bodyRect.left
      const y1 = anchor.y - bodyRect.top
      const x2 = cardRect.left - bodyRect.left
      const y2 =
        cardRect.top + Math.min(CARD_ANCHOR_OFFSET, cardRect.height / 2) - bodyRect.top
      const bend = Math.min(Math.max((x2 - x1) / 2, 16), 70)

      next.push({
        id,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        x: x1,
        y: y1,
      })
    }

    const changed = !sameLines(linesRef.current, next)
    if (changed) {
      linesRef.current = next
      setLines(next)
    }
    return changed
  }, [])

  /*
   * 본문 레이아웃은 한 프레임에 끝나지 않는다 (PDF 렌더, EPUB 재조판, 폰트 적용).
   * 좌표가 연달아 같아질 때까지 다시 재서 선이 예전 위치에 굳는 것을 막는다.
   */
  const schedule = useCallback(() => {
    settleRef.current = SETTLE_FRAMES
    if (rafRef.current) return
    const step = () => {
      settleRef.current = measure() ? SETTLE_FRAMES : settleRef.current - 1
      rafRef.current = settleRef.current > 0 ? requestAnimationFrame(step) : 0
    }
    rafRef.current = requestAnimationFrame(step)
  }, [measure])

  const anchorPort = useMemo<AnchorPort>(
    () => ({
      register: (provider) => {
        providerRef.current = provider
        schedule()
      },
      invalidate: schedule,
    }),
    [schedule],
  )

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    // scroll 은 버블링하지 않으므로 캡처 단계에서 본문·사이드바 스크롤을 함께 받는다
    body.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(body)
    return () => {
      body.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [schedule])

  useEffect(() => {
    schedule()
  }, [highlights, orderedHighlights, schedule])

  /** 창 폭에 따라 사이드바가 넓힐 수 있는 한계가 달라진다 */
  const widthLimit = useCallback(() => {
    const room = bodyRef.current?.clientWidth ?? 0
    if (room < 1) return SIDEBAR_MAX
    return clamp(room - DOC_MIN, SIDEBAR_MIN, SIDEBAR_MAX)
  }, [])

  const applyWidth = useCallback(
    (value: number) => {
      const next = clamp(value, SIDEBAR_MIN, widthLimit())
      widthRef.current = next
      setSidebarWidth(next)
      // 칸 크기가 바뀌면 카드 위치도 옮겨지므로 연결선을 다시 잰다
      schedule()
    },
    [schedule, setSidebarWidth, widthLimit],
  )

  // 창을 줄였을 때 사이드바가 본문을 다 먹지 않도록 되돌린다
  useEffect(() => {
    const onResize = () => applyWidth(widthRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [applyWidth])

  if (!projectId || !documentId) return null
  if (doc === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!doc) return <div className="empty-state">문서를 찾을 수 없습니다</div>

  const nodeByHighlight = new Map((nodes ?? []).map((n) => [n.sourceHighlightId, n]))
  const colorByHighlight = new Map((highlights ?? []).map((h) => [h.id, h.color]))
  const format = doc.format ?? 'pdf'
  const isEpub = format === 'epub'

  const removeHighlight = (id: string) => {
    if (!window.confirm('하이라이트를 삭제할까요? 연결된 카드·플래시카드도 함께 지워집니다.')) {
      return
    }
    void deleteHighlight(id)
  }

  return (
    <div className="read-page">
      <header className="read-header">
        <div className="read-nav">
          <Link to={`/project/${projectId}`} className="back-link">
            ← {doc.title}
          </Link>
        </div>
        <div className="read-actions">
          {workspace && (
            <Link className="btn btn-sm" to={`/project/${projectId}/workspace/${workspace.id}`}>
              워크스페이스
            </Link>
          )}
          <Link
            className="btn btn-sm"
            to={`/project/${projectId}/split/${documentId}/${workspace?.id ?? 'none'}`}
          >
            분할 보기
          </Link>
          <Link className="btn btn-sm" to={`/project/${projectId}/flashcards`}>
            플래시카드
          </Link>
          <Link className="btn btn-sm" to={`/project/${projectId}/bibliography`}>
            참고문헌
          </Link>
        </div>
      </header>

      <div
        className="read-body"
        ref={bodyRef}
        style={narrow ? undefined : { gridTemplateColumns: `1fr auto ${sidebarWidth}px` }}
      >
        <div className="read-pdf">
          {isEpub ? (
            <EpubViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={workspace?.id}
              anchorPort={anchorPort}
            />
          ) : (
            <PdfViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={workspace?.id}
              anchorPort={anchorPort}
            />
          )}
        </div>

        <svg className="hl-connectors" aria-hidden>
          {lines.map((l) => {
            const color = colorByHighlight.get(l.id)
            if (!color) return null
            const active = l.id === activeHighlightId
            const stroke = HIGHLIGHT_COLORS[color]
            return (
              <g key={l.id} className={active ? 'active' : ''} stroke={stroke} fill={stroke}>
                <path d={l.path} strokeWidth={active ? 2.4 : 1.3} fill="none" />
                <circle cx={l.x} cy={l.y} r={active ? 4 : 2.6} stroke="none" />
              </g>
            )
          })}
        </svg>

        {!narrow && (
          <PaneDivider
            orientation="vertical"
            label="하이라이트 칸 너비"
            onStart={() => {
              dragBaseRef.current = widthRef.current
            }}
            onMove={(delta) => applyWidth(dragBaseRef.current - delta)}
            onEnd={() => commitSidebarWidth(widthRef.current)}
            onReset={() => {
              applyWidth(SIDEBAR_DEFAULT)
              commitSidebarWidth(widthRef.current)
            }}
          />
        )}

        <aside className="read-sidebar" ref={sidebarRef}>
          <h3>하이라이트</h3>
          {!orderedHighlights.length ? (
            <p className="muted">텍스트를 드래그해 하이라이트하세요</p>
          ) : (
            <ul className="hl-list">
              {orderedHighlights.map((h) => {
                const node = nodeByHighlight.get(h.id)
                return (
                  <li
                    key={h.id}
                    className={`hl-item ${activeHighlightId === h.id ? 'active' : ''}`}
                    data-hl-card={h.id}
                    style={{ borderLeftColor: HIGHLIGHT_COLORS[h.color] }}
                    onMouseEnter={() => setActiveHighlightId(h.id)}
                    onMouseLeave={() => {
                      if (!COARSE_POINTER) setActiveHighlightId(null)
                    }}
                  >
                    <button
                      className="hl-item-text"
                      title="원문 위치로 이동"
                      onClick={() => {
                        setActiveHighlightId(h.id)
                        setPendingJump({ documentId, highlightId: h.id })
                      }}
                    >
                      {h.text}
                    </button>

                    <div className="hl-item-colors">
                      <ColorPalette
                        value={h.color}
                        onPick={(c) => void updateHighlightColor(h.id, c)}
                      />
                    </div>

                    <div className="hl-item-actions">
                      <span className="page-badge">
                        {isEpub ? `§${h.pageIndex + 1}` : `p.${h.pageIndex + 1}`}
                      </span>
                      <div className="hl-item-buttons">
                        {node && workspace && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              void addNodeToWorkspace(workspace.id, node.id).then(() =>
                                navigate(`/project/${projectId}/workspace/${workspace.id}`),
                              )
                            }
                          >
                            카드로
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm hl-item-delete"
                          onClick={() => removeHighlight(h.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
