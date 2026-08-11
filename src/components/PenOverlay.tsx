import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { savePenStroke } from '@/lib/actions'
import './PenOverlay.css'

interface Props {
  documentId: string
  projectId: string
  pageIndex: number
  /** 페이지 요소 기준 정규화 좌표 (0~1) 저장 */
  enabled: boolean
  color?: string
}

export function PenOverlay({
  documentId,
  projectId,
  pageIndex,
  enabled,
  color = '#e8c547',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; pressure: number }[]>([])
  const drawing = useRef(false)

  const strokes = useLiveQuery(
    () =>
      db.penStrokes
        .where('documentId')
        .equals(documentId)
        .filter((s) => s.pageIndex === pageIndex)
        .toArray(),
    [documentId, pageIndex],
  )

  useEffect(() => {
    if (!enabled) {
      drawing.current = false
      setDraft([])
    }
  }, [enabled])

  const toNorm = (e: ReactPointerEvent) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0, pressure: 0.5 }
    const rect = svg.getBoundingClientRect()
    const pressure =
      e.pointerType === 'pen'
        ? Math.max(0.05, Math.min(1, e.pressure || 0.5))
        : e.buttons === 1
          ? 0.45
          : 0.3
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      pressure,
    }
  }

  const pathFrom = (pts: { x: number; y: number; pressure: number }[]) => {
    if (pts.length < 2) return ''
    const w = 1000
    const h = 1000
    let d = `M ${pts[0].x * w} ${pts[0].y * h}`
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x * w} ${pts[i].y * h}`
    }
    return d
  }

  const avgPressure = (pts: { pressure: number }[]) =>
    pts.reduce((s, p) => s + p.pressure, 0) / Math.max(1, pts.length)

  const onDown = (e: ReactPointerEvent) => {
    if (!enabled) return
    // 손가락 터치는 스크롤용으로 남기고, 펜/마우스만 필기
    if (e.pointerType === 'touch') return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drawing.current = true
    setDraft([toNorm(e)])
  }

  const onMove = (e: ReactPointerEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    setDraft((prev) => [...prev, toNorm(e)])
  }

  const onUp = async (e: ReactPointerEvent) => {
    if (!drawing.current) return
    drawing.current = false
    const pts = [...draft, toNorm(e)]
    setDraft([])
    await savePenStroke({
      documentId,
      projectId,
      pageIndex,
      color,
      points: pts,
    })
  }

  return (
    <svg
      ref={svgRef}
      className={`pen-overlay ${enabled ? 'pen-active' : ''}`}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => void onUp(e)}
      onPointerCancel={() => {
        drawing.current = false
        setDraft([])
      }}
    >
      {(strokes ?? []).map((s) => (
        <path
          key={s.id}
          d={pathFrom(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={1.5 + avgPressure(s.points) * 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.9}
        />
      ))}
      {draft.length > 1 && (
        <path
          d={pathFrom(draft)}
          fill="none"
          stroke={color}
          strokeWidth={1.5 + avgPressure(draft) * 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
        />
      )}
    </svg>
  )
}
