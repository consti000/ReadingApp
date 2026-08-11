import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { updateCardPosition, updateNodeMemo } from '@/lib/actions'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS } from '@/types'
import './WorkspaceCanvas.css'

interface Props {
  workspaceId: string
  projectId: string
  onOpenDocument?: (documentId: string, highlightId: string) => void
}

export function WorkspaceCanvas({ workspaceId, projectId, onOpenDocument }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState<{
    id: string
    ox: number
    oy: number
    sx: number
    sy: number
  } | null>(null)
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(
    null,
  )
  const [editing, setEditing] = useState<string | null>(null)

  const setPendingJump = useUiStore((s) => s.setPendingJump)

  const workspace = useLiveQuery(() => db.workspaces.get(workspaceId), [workspaceId])
  const placements = useLiveQuery(
    () => db.cardPlacements.where('workspaceId').equals(workspaceId).toArray(),
    [workspaceId],
  )
  const nodes = useLiveQuery(
    () => db.nodes.where('projectId').equals(projectId).toArray(),
    [projectId],
  )

  const nodeMap = new Map((nodes ?? []).map((n) => [n.id, n]))

  const onCardPointerDown = (e: ReactPointerEvent, id: string, x: number, y: number) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging({ id, ox: x, oy: y, sx: e.clientX, sy: e.clientY })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragging) {
      const dx = (e.clientX - dragging.sx) / zoom
      const dy = (e.clientY - dragging.sy) / zoom
      const el = viewportRef.current?.querySelector(
        `[data-placement="${dragging.id}"]`,
      ) as HTMLElement | null
      if (el) {
        el.style.left = `${dragging.ox + dx}px`
        el.style.top = `${dragging.oy + dy}px`
      }
    } else if (panning) {
      setPan({
        x: panning.px + (e.clientX - panning.sx),
        y: panning.py + (e.clientY - panning.sy),
      })
    }
  }

  const onPointerUp = async (e: ReactPointerEvent) => {
    if (dragging) {
      const dx = (e.clientX - dragging.sx) / zoom
      const dy = (e.clientY - dragging.sy) / zoom
      await updateCardPosition(dragging.id, dragging.ox + dx, dragging.oy + dy)
      setDragging(null)
    }
    setPanning(null)
  }

  return (
    <div className="ws-root">
      <div className="ws-toolbar">
        <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
          +
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setPan({ x: 40, y: 40 })
            setZoom(1)
          }}
        >
          리셋
        </button>
        <span className="ws-hint">빈 공간 드래그로 이동 · 카드 드래그로 배치</span>
      </div>

      <div
        className="ws-viewport"
        ref={viewportRef}
        style={{ background: workspace?.backgroundColor ?? '#1a1f26' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('[data-placement]')) return
          setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => void onPointerUp(e)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setZoom((z) => Math.min(2, Math.max(0.4, z - e.deltaY * 0.001)))
          }
        }}
      >
        <div
          className="ws-world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <div className="ws-grid" />
          {(placements ?? []).map((p) => {
            const node = nodeMap.get(p.nodeId)
            if (!node) return null
            return (
              <article
                key={p.id}
                className="ws-card"
                data-placement={p.id}
                style={{
                  left: p.x,
                  top: p.y,
                  width: p.width,
                  borderColor: HIGHLIGHT_COLORS[node.color],
                }}
                onPointerDown={(e) => onCardPointerDown(e, p.id, p.x, p.y)}
              >
                <header className="ws-card-head">
                  <span
                    className="ws-card-swatch"
                    style={{ background: HIGHLIGHT_COLORS[node.color] }}
                  />
                  <button
                    data-no-drag
                    className="btn btn-ghost btn-sm"
                    title="원문으로 이동"
                    onClick={() => {
                      setPendingJump({
                        documentId: node.documentId,
                        highlightId: node.sourceHighlightId,
                      })
                      onOpenDocument?.(node.documentId, node.sourceHighlightId)
                    }}
                  >
                    원문 →
                  </button>
                </header>
                <p className="ws-card-text">{node.text}</p>
                {editing === node.id ? (
                  <textarea
                    data-no-drag
                    className="input ws-memo"
                    autoFocus
                    defaultValue={node.memo ?? ''}
                    onBlur={(e) => {
                      void updateNodeMemo(node.id, e.target.value)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <button
                    data-no-drag
                    className="ws-memo-btn"
                    onClick={() => setEditing(node.id)}
                  >
                    {node.memo || '메모 추가…'}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
