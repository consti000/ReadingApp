import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/types'
import './HighlightEditMenu.css'

interface Props {
  /** 뷰포트 좌표 (position: fixed) */
  x: number
  y: number
  color: HighlightColor
  onPick: (color: HighlightColor) => void
  onDelete: () => void
  onClose: () => void
}

const COLORS = Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]

/** 본문 하이라이트를 탭했을 때 뜨는 색 변경·삭제 메뉴 */
export function HighlightEditMenu({ x, y, color, onPick, onDelete, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="hl-edit-menu"
      style={{
        left: Math.min(Math.max(x, 110), window.innerWidth - 110),
        top: Math.min(Math.max(y, 50), window.innerHeight - 60),
      }}
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
    >
      <div className="color-row">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`color-dot ${color === c ? 'active' : ''}`}
            style={{ background: HIGHLIGHT_COLORS[c] }}
            title={c}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
      <button className="btn btn-sm btn-danger" onClick={onDelete}>
        삭제
      </button>
      <button className="btn btn-sm btn-ghost" onClick={onClose}>
        닫기
      </button>
    </div>
  )
}
