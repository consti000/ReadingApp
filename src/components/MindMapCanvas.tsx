import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import {
  createMindMapNode,
  deleteMindMapNode,
  descendantIds,
  freeSpot,
  isDescendantOf,
  moveMindMapNode,
  renameMindMapNode,
  restoreMindMapNodes,
  setMindMapParent,
  updateMindMapNodePosition,
  type MindMapRemoval,
} from '@/lib/mindmap'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS, type MindMapNode } from '@/types'
import './MindMapCanvas.css'

interface Props {
  mindMapId: string
  projectId: string
  onOpenDocument?: (documentId: string, highlightId: string) => void
}

type DragState = {
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
}

type PosMap = Record<string, { x: number; y: number }>

/** 알림 한 줄. 지운 직후에는 되돌릴 거리를 함께 들고 있는다 */
type Toast = { text: string; undo?: MindMapRemoval }

/** 손가락·펜으로 빈 곳을 눌러 노드를 만들 때까지 기다리는 시간 */
const HOLD_MS = 550
const HOLD_SLOP_PX = 10

type Box = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }

/** 아직 재 보지 못한 카드에 쓰는 크기 */
const CARD_FALLBACK = { w: 220, h: 96 }
/** 연결선 그림판을 카드 바깥으로 조금 더 넓게 잡는 여백 */
const EDGE_PAD = 200

/** 상자 가운데에서 목표 쪽으로 나가다 테두리와 만나는 점 */
function borderPoint(box: Box, toward: Point): Point {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const step = Math.min(
    dx ? box.w / 2 / Math.abs(dx) : Infinity,
    dy ? box.h / 2 / Math.abs(dy) : Infinity,
  )
  return { x: c.x + dx * step, y: c.y + dy * step }
}

/** 두 카드를 잇는 선분 — 카드에 가려지지 않도록 테두리에서 테두리까지만 그린다 */
function edgeBetween(a: Box, b: Box) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const from = borderPoint(a, cb)
  const to = borderPoint(b, ca)
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y }
}

export function MindMapCanvas({ mindMapId, projectId, onOpenDocument }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 20, y: 20 })
  const [zoom, setZoom] = useState(0.9)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [livePos, setLivePos] = useState<PosMap>({})
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  /** 글을 고치는 중인 노드와 적고 있는 내용 */
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  /** 하위 노드가 달린 노드를 지울 때 어떻게 할지 묻는 중 */
  const [asking, setAsking] = useState<{ id: string; count: number } | null>(null)
  /** 끌기·캔버스 이동을 따라다니는 귀를 떼는 손잡이 */
  const dragReleaseRef = useRef<(() => void) | null>(null)
  const panReleaseRef = useRef<(() => void) | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const dropTargetRef = useRef<string | null>(null)
  const holdRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const toastTimerRef = useRef(0)
  const zoomRef = useRef(zoom)
  const mmNodesRef = useRef<MindMapNode[]>([])
  zoomRef.current = zoom
  dragRef.current = drag
  dropTargetRef.current = dropTargetId

  const setPendingJump = useUiStore((s) => s.setPendingJump)
  const mmNodes = useLiveQuery(
    () => db.mindMapNodes.where('mindMapId').equals(mindMapId).toArray(),
    [mindMapId],
  )
  const nodes = useLiveQuery(
    () => db.nodes.where('projectId').equals(projectId).toArray(),
    [projectId],
  )
  const nodeMap = new Map((nodes ?? []).map((n) => [n.id, n]))
  mmNodesRef.current = mmNodes ?? []

  const posOf = useCallback(
    (id: string, x: number, y: number) => livePos[id] ?? { x, y },
    [livePos],
  )

  /**
   * 카드 크기는 글 길이와 버튼 줄 수에 따라 달라진다. 연결선을 카드 테두리에 정확히
   * 대려면 실제 크기가 필요해서 재어 둔다. (확대·축소와 무관한 본래 크기가 나온다)
   */
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({})
  const sizeWatchRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const watch = new ResizeObserver((entries) => {
      setSizes((prev) => {
        const next = { ...prev }
        let changed = false
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const id = el.dataset.mm
          if (!id) continue
          // offset* 는 테두리까지 포함한 본래 크기다 (확대·축소의 영향을 받지 않는다)
          const w = el.offsetWidth
          const h = el.offsetHeight
          const old = prev[id]
          if (old && Math.abs(old.w - w) < 0.5 && Math.abs(old.h - h) < 0.5) continue
          next[id] = { w, h }
          changed = true
        }
        return changed ? next : prev
      })
    })
    sizeWatchRef.current = watch
    return () => watch.disconnect()
  }, [])

  const watchSize = useCallback((el: HTMLDivElement | null) => {
    if (el) sizeWatchRef.current?.observe(el)
  }, [])

  /**
   * 카드는 캔버스 어디에나 놓을 수 있어서 좌표가 음수가 되기도 한다. 지도를 열 때
   * 늘 같은 자리를 비추면 노드가 화면 밖에 있어 빈 판처럼 보인다. 처음 한 번 맞춰 준다.
   */
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !mmNodes?.length) return
    fittedRef.current = true
    const left = Math.min(...mmNodes.map((n) => n.x))
    const top = Math.min(...mmNodes.map((n) => n.y))
    setPan({ x: 24 - left * zoom, y: 24 - top * zoom })
    // 지도를 바꿔 열면 다시 맞춘다
  }, [mmNodes, zoom])

  useEffect(() => {
    fittedRef.current = false
  }, [mindMapId])

  const boxOf = useCallback(
    (m: { id: string; x: number; y: number }): Box => {
      const at = posOf(m.id, m.x, m.y)
      const size = sizes[m.id] ?? CARD_FALLBACK
      return { x: at.x, y: at.y, w: size.w, h: size.h }
    },
    [posOf, sizes],
  )

  const labelOf = (m: { id: string; label?: string; nodeId: string | null }) => {
    if (m.label) return m.label
    if (m.nodeId) return nodeMap.get(m.nodeId)?.text.slice(0, 100) ?? '…'
    return '…'
  }

  const showToast = (text: string, undo?: MindMapRemoval) => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ text, undo })
    // 되돌릴 수 있는 알림은 누를 틈을 좀 더 준다
    toastTimerRef.current = window.setTimeout(() => setToast(null), undo ? 6000 : 2200)
  }

  /** 화면 위 한 점이 캔버스 안에서는 어디인지 */
  const worldAt = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
  }

  /** 노드를 하나 만들고 곧바로 글을 적을 수 있게 한다 */
  const addNode = async (x: number, y: number, parentId: string | null = null) => {
    const spot = freeSpot(mmNodesRef.current, x, y)
    const id = await createMindMapNode(mindMapId, spot.x, spot.y, parentId)
    setEditing({ id, draft: '' })
  }

  /** 빈 노드는 남겨 두어 봐야 쓸모가 없으므로 치운다 */
  const dropIfBlank = async (id: string) => {
    const row = mmNodesRef.current.find((n) => n.id === id)
    if (!row || row.nodeId || row.label?.trim()) return
    if (mmNodesRef.current.some((n) => n.parentId === id)) return
    await deleteMindMapNode(id, 'promote')
  }

  const commitEdit = async () => {
    const edit = editing
    if (!edit) return
    setEditing(null)
    await renameMindMapNode(edit.id, edit.draft)
    await dropIfBlank(edit.id)
  }

  const cancelEdit = async () => {
    const edit = editing
    if (!edit) return
    setEditing(null)
    await dropIfBlank(edit.id)
  }

  const removeNode = async (id: string, mode: 'promote' | 'subtree') => {
    setAsking(null)
    const undo = await deleteMindMapNode(id, mode)
    showToast(
      undo.removed.length > 1 ? `노드 ${undo.removed.length}개를 지웠습니다` : '노드를 지웠습니다',
      undo,
    )
  }

  /** 도구막대 버튼으로 만들 때는 지금 보고 있는 화면 한가운데에 놓는다 */
  const addAtViewCenter = async () => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const at = worldAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    await addNode(at.x - 110, at.y - 24)
  }

  const askRemove = (id: string) => {
    const count = descendantIds(mmNodesRef.current, id).length
    if (count) setAsking({ id, count })
    else void removeNode(id, 'promote')
  }

  const findDropTarget = (clientX: number, clientY: number, draggingId: string) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const target = el?.closest('[data-mm]') as HTMLElement | null
    const tid = target?.dataset.mm
    if (!tid || tid === draggingId) return null
    const list = mmNodesRef.current
    // 자손을 부모로 두는 경우 미리 제외
    if (isDescendantOf(list, draggingId, tid)) return null
    return tid
  }

  /**
   * 끌기를 따라다닐 귀를 창에 단다. 누르는 그 순간 달아야 한다 — 상태를 바꾼 뒤
   * 화면을 다시 그리고 나서 달면 그 사이의 빠른 움직임을 놓친다.
   */
  const trackNodeDrag = () => {
    const release = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      dragReleaseRef.current = null
    }

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const z = zoomRef.current
      const x = d.originX + (e.clientX - d.startX) / z
      const y = d.originY + (e.clientY - d.startY) / z
      setLivePos((prev) => ({ ...prev, [d.id]: { x, y } }))
      const tid = findDropTarget(e.clientX, e.clientY, d.id)
      dropTargetRef.current = tid
      setDropTargetId(tid)
    }

    const onUp = async (e: PointerEvent) => {
      release()
      const d = dragRef.current
      if (!d) return
      const z = zoomRef.current
      const x = d.originX + (e.clientX - d.startX) / z
      const y = d.originY + (e.clientY - d.startY) / z
      const tid = dropTargetRef.current ?? findDropTarget(e.clientX, e.clientY, d.id)
      const makeRoot = e.altKey

      setDrag(null)
      dragRef.current = null
      setDropTargetId(null)
      dropTargetRef.current = null

      if (tid) {
        const result = await moveMindMapNode(d.id, x, y, tid)
        if (result.ok) showToast('부모 노드로 연결했습니다')
        else showToast(result.reason ?? '위계 변경 실패')
      } else if (makeRoot) {
        const result = await moveMindMapNode(d.id, x, y, null)
        if (result.ok) showToast('루트 노드로 만들었습니다')
        else showToast(result.reason ?? '위계 변경 실패')
      } else {
        await updateMindMapNodePosition(d.id, x, y)
      }

      setLivePos((prev) => {
        const next = { ...prev }
        delete next[d.id]
        return next
      })
    }

    dragReleaseRef.current = release
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** 빈 곳을 끌어 캔버스를 옮긴다 */
  const trackPan = (startX: number, startY: number) => {
    const from = { x: pan.x, y: pan.y }
    const release = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      panReleaseRef.current = null
    }
    const onMove = (e: PointerEvent) =>
      setPan({ x: from.x + (e.clientX - startX), y: from.y + (e.clientY - startY) })
    const onUp = () => release()

    panReleaseRef.current = release
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  useEffect(
    () => () => {
      dragReleaseRef.current?.()
      panReleaseRef.current?.()
    },
    [],
  )

  const startNodeDrag = (
    e: ReactPointerEvent,
    id: string,
    x: number,
    y: number,
  ) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    e.stopPropagation()
    e.preventDefault()
    const origin = posOf(id, x, y)
    const next: DragState = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
    }
    dragRef.current = next
    setDrag(next)
    setLivePos((prev) => ({ ...prev, [id]: origin }))
    trackNodeDrag()
  }

  const detachParent = async (id: string) => {
    const result = await setMindMapParent(id, null)
    if (result.ok) showToast('루트로 올렸습니다')
    else showToast(result.reason ?? '실패')
  }

  const dragNode = drag ? (mmNodes ?? []).find((n) => n.id === drag.id) : null
  const dropNode = dropTargetId
    ? (mmNodes ?? []).find((n) => n.id === dropTargetId)
    : null

  /**
   * 연결선을 그릴 판의 범위. 카드는 캔버스 어디에나 놓일 수 있고 좌표가 음수일 수도 있어서,
   * 고정 크기로 잡아 두면 그 밖에 있는 선이 잘려 보이지 않는다.
   */
  const edgeArea = (() => {
    const boxes = (mmNodes ?? []).map(boxOf)
    if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 }
    const left = Math.min(...boxes.map((b) => b.x)) - EDGE_PAD
    const top = Math.min(...boxes.map((b) => b.y)) - EDGE_PAD
    const right = Math.max(...boxes.map((b) => b.x + b.w)) + EDGE_PAD
    const bottom = Math.max(...boxes.map((b) => b.y + b.h)) + EDGE_PAD
    return { x: left, y: top, w: right - left, h: bottom - top }
  })()

  return (
    <div className="mm-root">
      <div className="mm-hint">
        <button className="btn btn-sm" onClick={() => void addAtViewCenter()}>
          ＋ 노드 추가
        </button>
        <span>
          빈 곳을 두 번 누르거나(태블릿은 길게 누르기) 위 버튼으로 새 노드 · 노드를 두 번 누르면
          글 고치기 · 다른 노드 위에 놓으면 하위로 연결 · Alt+빈 곳에 놓기 또는「루트」로 상위 해제
        </span>
      </div>
      <div
        className="mm-viewport"
        ref={viewportRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('[data-mm]')) return
          if (editing) void commitEdit()
          trackPan(e.clientX, e.clientY)
          if (e.pointerType === 'mouse') return
          // 손가락·펜에는 두 번 누르기가 어렵다. 가만히 누르고 있으면 그 자리에 만든다
          const { clientX: x, clientY: y } = e
          holdRef.current = {
            x,
            y,
            timer: window.setTimeout(() => {
              holdRef.current = null
              // 노드를 만드는 쪽으로 넘어가니 캔버스 이동은 멈춘다
              panReleaseRef.current?.()
              const at = worldAt(x, y)
              void addNode(at.x - 110, at.y - 24)
            }, HOLD_MS),
          }
        }}
        onPointerMove={(e) => {
          const hold = holdRef.current
          if (!hold) return
          if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < HOLD_SLOP_PX) return
          window.clearTimeout(hold.timer)
          holdRef.current = null
        }}
        onPointerUp={() => {
          if (!holdRef.current) return
          window.clearTimeout(holdRef.current.timer)
          holdRef.current = null
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-mm]')) return
          const at = worldAt(e.clientX, e.clientY)
          void addNode(at.x - 110, at.y - 24)
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setZoom((z) => Math.min(2, Math.max(0.35, z - e.deltaY * 0.001)))
          }
        }}
      >
        <div
          className="mm-world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <svg
            className="mm-edges"
            style={{
              left: edgeArea.x,
              top: edgeArea.y,
              width: edgeArea.w,
              height: edgeArea.h,
            }}
            viewBox={`${edgeArea.x} ${edgeArea.y} ${edgeArea.w} ${edgeArea.h}`}
          >
            {(mmNodes ?? []).map((n) => {
              if (!n.parentId) return null
              const parent = (mmNodes ?? []).find((p) => p.id === n.parentId)
              if (!parent) return null
              const previewing = drag?.id === n.id && dropTargetId
              return (
                <line
                  key={`${n.parentId}-${n.id}`}
                  {...edgeBetween(boxOf(parent), boxOf(n))}
                  stroke={previewing ? 'rgba(196,165,116,0.2)' : 'rgba(196,165,116,0.55)'}
                  strokeWidth={2}
                  strokeDasharray={previewing ? '6 4' : undefined}
                />
              )
            })}
            {dragNode && dropNode && (
              <line
                {...edgeBetween(boxOf(dropNode), boxOf(dragNode))}
                stroke="var(--accent)"
                strokeWidth={2.5}
                strokeDasharray="8 5"
              />
            )}
          </svg>
          {(mmNodes ?? []).map((m) => {
            const node = m.nodeId ? nodeMap.get(m.nodeId) : null
            const isFolder = !m.nodeId
            const { x, y } = posOf(m.id, m.x, m.y)
            const isDragging = drag?.id === m.id
            const isDropTarget = dropTargetId === m.id
            return (
              <div
                key={m.id}
                ref={watchSize}
                data-mm={m.id}
                className={[
                  'mm-node',
                  isFolder ? 'mm-folder' : '',
                  isDragging ? 'mm-dragging' : '',
                  isDropTarget ? 'mm-drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: x,
                  top: y,
                  borderColor: isDropTarget
                    ? 'var(--accent)'
                    : node
                      ? HIGHLIGHT_COLORS[node.color]
                      : 'var(--accent)',
                  zIndex: isDragging ? 20 : isDropTarget ? 15 : 1,
                  pointerEvents: isDragging ? 'none' : undefined,
                }}
                onPointerDown={(e) => startNodeDrag(e, m.id, m.x, m.y)}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-no-drag]')) return
                  e.stopPropagation()
                  setEditing({ id: m.id, draft: m.label ?? '' })
                }}
              >
                <div className="mm-drag-handle" title="드래그하여 이동·위계 변경" />
                {isDropTarget && <span className="mm-drop-badge">하위로 연결</span>}
                {editing?.id === m.id ? (
                  <textarea
                    data-no-drag
                    className="input mm-edit"
                    autoFocus
                    rows={3}
                    placeholder={node ? '비우면 발췌문을 그대로 보여 줍니다' : '노드에 적을 글'}
                    value={editing.draft}
                    onChange={(e) => setEditing({ id: m.id, draft: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void commitEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        void cancelEdit()
                      }
                    }}
                    onBlur={() => void commitEdit()}
                  />
                ) : (
                  <p className="mm-label">{labelOf(m)}</p>
                )}
                <div className="mm-node-actions">
                  {editing?.id === m.id ? (
                    <span className="mm-edit-hint">Enter 저장 · Esc 취소</span>
                  ) : (
                    <>
                      <button
                        data-no-drag
                        className="btn btn-ghost btn-sm"
                        title="하위 노드 추가"
                        onClick={(e) => {
                          e.stopPropagation()
                          void addNode(m.x, m.y + 140, m.id)
                        }}
                      >
                        ＋
                      </button>
                      <button
                        data-no-drag
                        className="btn btn-ghost btn-sm"
                        title="글 고치기"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing({ id: m.id, draft: m.label ?? '' })
                        }}
                      >
                        ✎
                      </button>
                      <button
                        data-no-drag
                        className="btn btn-ghost btn-sm"
                        title="지도에서 빼기 (원문은 남습니다)"
                        onClick={(e) => {
                          e.stopPropagation()
                          askRemove(m.id)
                        }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                  {editing?.id !== m.id && m.parentId && (
                    <button
                      data-no-drag
                      className="btn btn-ghost btn-sm"
                      title="부모 연결 해제"
                      onClick={(e) => {
                        e.stopPropagation()
                        void detachParent(m.id)
                      }}
                    >
                      루트
                    </button>
                  )}
                  {editing?.id !== m.id && node && (
                    <button
                      data-no-drag
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingJump({
                          documentId: node.documentId,
                          highlightId: node.sourceHighlightId,
                        })
                        onOpenDocument?.(node.documentId, node.sourceHighlightId)
                      }}
                    >
                      원문 →
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mm-zoom">
        <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
          +
        </button>
      </div>
      {asking && (
        <div className="mm-ask">
          <p>하위 노드 {asking.count}개가 달려 있습니다. 어떻게 할까요?</p>
          <div className="mm-ask-actions">
            <button className="btn btn-sm" onClick={() => void removeNode(asking.id, 'promote')}>
              하위 노드는 위로 올리기
            </button>
            <button className="btn btn-sm" onClick={() => void removeNode(asking.id, 'subtree')}>
              가지 통째로 빼기
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAsking(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast mm-toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const undo = toast.undo
                setToast(null)
                if (undo) await restoreMindMapNodes(undo)
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
