import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import {
  isDescendantOf,
  moveMindMapNode,
  setMindMapParent,
  updateMindMapNodePosition,
} from '@/lib/mindmap'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS } from '@/types'
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

export function MindMapCanvas({ mindMapId, projectId, onOpenDocument }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 20, y: 20 })
  const [zoom, setZoom] = useState(0.9)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [livePos, setLivePos] = useState<PosMap>({})
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [panning, setPanning] = useState<{
    sx: number
    sy: number
    px: number
    py: number
  } | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const dropTargetRef = useRef<string | null>(null)
  const zoomRef = useRef(zoom)
  const mmNodesRef = useRef<{ id: string; parentId: string | null }[]>([])
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

  const labelOf = (m: { id: string; label?: string; nodeId: string | null }) => {
    if (m.label) return m.label
    if (m.nodeId) return nodeMap.get(m.nodeId)?.text.slice(0, 100) ?? '…'
    return '…'
  }

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
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

  useEffect(() => {
    if (!drag) return

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

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag])

  useEffect(() => {
    if (!panning) return
    const onMove = (e: PointerEvent) => {
      setPan({
        x: panning.px + (e.clientX - panning.sx),
        y: panning.py + (e.clientY - panning.sy),
      })
    }
    const onUp = () => setPanning(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [panning])

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
  }

  const detachParent = async (id: string) => {
    const result = await setMindMapParent(id, null)
    if (result.ok) showToast('루트로 올렸습니다')
    else showToast(result.reason ?? '실패')
  }

  const dragNode = drag ? (mmNodes ?? []).find((n) => n.id === drag.id) : null
  const dragPos = drag && dragNode ? posOf(drag.id, dragNode.x, dragNode.y) : null
  const dropNode = dropTargetId
    ? (mmNodes ?? []).find((n) => n.id === dropTargetId)
    : null
  const dropPos =
    dropNode && dropTargetId ? posOf(dropTargetId, dropNode.x, dropNode.y) : null

  return (
    <div className="mm-root">
      <div className="mm-hint">
        다른 노드 위에 놓으면 하위로 연결 · Alt+빈 곳에 놓기 또는「루트」로 상위 해제 · 빈 공간
        드래그로 캔버스 이동
      </div>
      <div
        className="mm-viewport"
        ref={viewportRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('[data-mm]')) return
          setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
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
          <svg className="mm-edges" width="5000" height="4000">
            {(mmNodes ?? []).map((n) => {
              if (!n.parentId) return null
              const parent = (mmNodes ?? []).find((p) => p.id === n.parentId)
              if (!parent) return null
              const a = posOf(parent.id, parent.x, parent.y)
              const b = posOf(n.id, n.x, n.y)
              const previewing = drag?.id === n.id && dropTargetId
              return (
                <line
                  key={`${n.parentId}-${n.id}`}
                  x1={a.x + 110}
                  y1={a.y + 28}
                  x2={b.x + 110}
                  y2={b.y + 28}
                  stroke={previewing ? 'rgba(196,165,116,0.2)' : 'rgba(196,165,116,0.45)'}
                  strokeWidth={2}
                  strokeDasharray={previewing ? '6 4' : undefined}
                />
              )
            })}
            {dragPos && dropPos && (
              <line
                x1={dropPos.x + 110}
                y1={dropPos.y + 28}
                x2={dragPos.x + 110}
                y2={dragPos.y + 28}
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
              >
                <div className="mm-drag-handle" title="드래그하여 이동·위계 변경" />
                {isDropTarget && <span className="mm-drop-badge">하위로 연결</span>}
                <p className="mm-label">{labelOf(m)}</p>
                <div className="mm-node-actions">
                  {m.parentId && (
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
                  {node && (
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
