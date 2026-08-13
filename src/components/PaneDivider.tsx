import { useEffect, useRef, useState } from 'react'
import './PaneDivider.css'

/** 화살표 키로 한 번에 움직이는 거리 */
const KEY_STEP = 24

interface PaneDividerProps {
  /** vertical = 세로로 선 하나, 좌우 두 칸을 나눈다 */
  orientation: 'vertical' | 'horizontal'
  label: string
  /** 끌기 시작 — 부모는 이때의 크기를 기억해 둔다 */
  onStart: () => void
  /** 시작 지점에서 얼마나 움직였는지(px). 오른쪽·아래가 양수 */
  onMove: (delta: number) => void
  /** 손을 뗌 — 부모는 이때 값을 저장한다 */
  onEnd: () => void
  /** 두 번 누르면 기본 크기로 */
  onReset: () => void
}

export function PaneDivider({
  orientation,
  label,
  onStart,
  onMove,
  onEnd,
  onReset,
}: PaneDividerProps) {
  const [dragging, setDragging] = useState(false)
  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => () => releaseRef.current?.(), [])

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    releaseRef.current?.()

    const startX = event.clientX
    const startY = event.clientY
    const id = event.pointerId
    onStart()
    setDragging(true)

    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      onMove(orientation === 'vertical' ? e.clientX - startX : e.clientY - startY)
    }
    const stop = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      release()
    }
    // 빠르게 끌면 상태 반영을 기다릴 틈이 없어 누르는 즉시 창에 붙인다
    const release = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      releaseRef.current = null
      setDragging(false)
      onEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    releaseRef.current = release
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const forth = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forth && event.key !== 'Home') return
    event.preventDefault()
    if (event.key === 'Home') {
      onReset()
      return
    }
    onStart()
    onMove(event.key === back ? -KEY_STEP : KEY_STEP)
    onEnd()
  }

  return (
    <div
      className={`pane-divider ${orientation}${dragging ? ' dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      title={`${label} — 끌어서 조절, 두 번 누르면 기본값`}
      onPointerDown={track}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
