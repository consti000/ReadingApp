import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { savePenStroke } from '@/lib/actions'
import { caretAt, rangeBetween, type CaretPoint } from '@/lib/textRange'
import './PenOverlay.css'

interface Props {
  documentId: string
  projectId: string
  pageIndex: number
  /** 페이지 요소 기준 정규화 좌표 (0~1) 저장 */
  enabled: boolean
  color?: string
  /** 필기 중 손가락으로 밀어 넘길 스크롤 영역 */
  scrollRef?: RefObject<HTMLElement | null>
  /** 필기 중에도 글자를 그어 하이라이트할 때, 칠해질 범위가 바뀔 때마다 */
  onMarkChange?: (range: Range | null) => void
  /** 손을 떼어 그 범위를 확정할 때 */
  onMarkCommit?: () => void
}

interface Point {
  x: number
  y: number
  pressure: number
}

/**
 * 필기 중에는 오버레이가 touch-action: none 이라 브라우저 스크롤이 일어나지 않는다.
 * 그래서 손가락 이동은 여기서 직접 스크롤로 옮기고, 놓은 뒤 관성 스크롤까지 이어준다.
 */
const TAP_MOVE_PX = 10
/** 손가락을 이만큼 제자리에서 누르고 있으면 스크롤 대신 하이라이트로 넘어간다 */
const SELECT_HOLD_MS = 400
/** Pointer Events 규격: 펜 사이드(barrel) 버튼은 buttons 비트 2 */
const PEN_BARREL_BUTTON = 2
const FLICK_DECAY = 0.93
const FLICK_MIN_PX = 2

/** 포인터를 잡아 두면 페이지 밖으로 나가도 제스처가 이어진다 (실패해도 진행) */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // 이미 사라진 포인터
  }
}

export function PenOverlay({
  documentId,
  projectId,
  pageIndex,
  enabled,
  color = '#e8c547',
  scrollRef,
  onMarkChange,
  onMarkCommit,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Point[]>([])
  const drawing = useRef(false)
  const panRef = useRef<{
    pointerId: number
    x: number
    y: number
    startX: number
    startY: number
    velocity: number
  } | null>(null)
  const markFromRef = useRef<CaretPoint | null>(null)
  const holdTimerRef = useRef(0)
  const flickRef = useRef(0)
  const onMarkChangeRef = useRef(onMarkChange)
  const onMarkCommitRef = useRef(onMarkCommit)
  onMarkChangeRef.current = onMarkChange
  onMarkCommitRef.current = onMarkCommit

  const strokes = useLiveQuery(
    () =>
      db.penStrokes
        .where('documentId')
        .equals(documentId)
        .filter((s) => s.pageIndex === pageIndex)
        .toArray(),
    [documentId, pageIndex],
  )

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = 0
  }, [])

  const stopFlick = useCallback(() => {
    if (flickRef.current) cancelAnimationFrame(flickRef.current)
    flickRef.current = 0
  }, [])

  const markMove = useCallback((e: PointerEvent) => {
    const from = markFromRef.current
    if (!from) return
    const to = caretAt(document, e.clientX, e.clientY)
    onMarkChangeRef.current?.(to ? rangeBetween(document, from, to) : null)
  }, [])

  const markEnd = useCallback(() => {
    window.removeEventListener('pointermove', markMove)
    window.removeEventListener('pointerup', markEnd)
    window.removeEventListener('pointercancel', markEnd)
    markFromRef.current = null
    // CSS 가 정하는 값으로 되돌린다 (필기 모드면 auto)
    if (svgRef.current) svgRef.current.style.pointerEvents = ''
    onMarkCommitRef.current?.()
  }, [markMove])

  /*
   * 칠하기는 오버레이 위에서 시작하지만, 글자 위치를 알아내려면
   * 히트 테스트가 본문 텍스트 레이어까지 닿아야 해서 오버레이를 잠시 비켜준다.
   * 제스처가 시작될 때 touch-action 은 이미 결정됐으므로 화면은 여전히 흐르지 않는다.
   */
  const markBegin = useCallback(
    (x: number, y: number) => {
      const svg = svgRef.current
      if (!svg) return
      svg.style.pointerEvents = 'none'
      markFromRef.current = caretAt(document, x, y)
      window.addEventListener('pointermove', markMove)
      window.addEventListener('pointerup', markEnd)
      window.addEventListener('pointercancel', markEnd)
    },
    [markEnd, markMove],
  )

  useEffect(() => {
    if (enabled) return
    drawing.current = false
    panRef.current = null
    clearHold()
    stopFlick()
    setDraft([])
  }, [enabled, clearHold, stopFlick])

  useEffect(
    () => () => {
      clearHold()
      stopFlick()
      if (markFromRef.current) markEnd()
    },
    [clearHold, stopFlick, markEnd],
  )

  const toNorm = (e: ReactPointerEvent): Point => {
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

  const pathFrom = (pts: Point[]) => {
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
    stopFlick()

    // 펜 사이드 버튼을 누른 채 그으면 필기 대신 텍스트를 고른다
    if (e.pointerType === 'pen' && (e.buttons & PEN_BARREL_BUTTON) !== 0) {
      e.preventDefault()
      markBegin(e.clientX, e.clientY)
      return
    }

    /*
     * 손가락은 화면을 밀어 읽는 용도로 남긴다.
     * preventDefault 를 하면 뒤이은 click 이 사라져 하이라이트 탭 편집이 막히므로 그대로 흘린다.
     */
    if (e.pointerType === 'touch') {
      capture(e.currentTarget as Element, e.pointerId)
      panRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        velocity: 0,
      }
      clearHold()
      holdTimerRef.current = window.setTimeout(() => {
        const pan = panRef.current
        if (!pan) return
        panRef.current = null
        try {
          svgRef.current?.releasePointerCapture(pan.pointerId)
        } catch {
          // 이미 놓친 포인터
        }
        markBegin(pan.x, pan.y)
      }, SELECT_HOLD_MS)
      return
    }

    e.preventDefault()
    e.stopPropagation()
    capture(e.currentTarget as Element, e.pointerId)
    drawing.current = true
    setDraft([toNorm(e)])
  }

  const onMove = (e: ReactPointerEvent) => {
    const pan = panRef.current
    if (pan && e.pointerId === pan.pointerId) {
      const el = scrollRef?.current
      const dx = e.clientX - pan.x
      const dy = e.clientY - pan.y
      pan.x = e.clientX
      pan.y = e.clientY
      pan.velocity = dy
      if (el) {
        el.scrollTop -= dy
        el.scrollLeft -= dx
      }
      if (Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) > TAP_MOVE_PX) clearHold()
      return
    }

    if (!drawing.current) return
    e.preventDefault()
    setDraft((prev) => [...prev, toNorm(e)])
  }

  const endPan = () => {
    const pan = panRef.current
    panRef.current = null
    clearHold()

    const el = scrollRef?.current
    if (!pan || !el || Math.abs(pan.velocity) < FLICK_MIN_PX) return

    let velocity = pan.velocity
    const step = () => {
      velocity *= FLICK_DECAY
      el.scrollTop -= velocity
      flickRef.current = Math.abs(velocity) > 0.5 ? requestAnimationFrame(step) : 0
    }
    stopFlick()
    flickRef.current = requestAnimationFrame(step)
  }

  const onUp = async (e: ReactPointerEvent) => {
    if (panRef.current) {
      endPan()
      return
    }
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
        panRef.current = null
        clearHold()
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
