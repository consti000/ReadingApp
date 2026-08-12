import { HIGHLIGHT_COLORS, isUnderlineColor, type HighlightColor } from '@/types'

const COLORS = Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]

const LABELS: Record<HighlightColor, string> = {
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  pink: '분홍',
  orange: '주황',
  red: '빨간 밑줄',
}

interface Props {
  value: HighlightColor
  onPick: (color: HighlightColor) => void
}

/** 하이라이트 범례 — 툴바·카드·편집 메뉴가 같은 모양을 쓴다 */
export function ColorPalette({ value, onPick }: Props) {
  return (
    <div className="color-row">
      {COLORS.map((c) => {
        const underline = isUnderlineColor(c)
        return (
          <button
            key={c}
            className={`color-dot ${underline ? 'underline' : ''} ${value === c ? 'active' : ''}`}
            // 밑줄 범례는 아래쪽 선으로만 보여 준다 (currentColor 를 CSS 가 쓴다)
            style={underline ? { color: HIGHLIGHT_COLORS[c] } : { background: HIGHLIGHT_COLORS[c] }}
            title={LABELS[c]}
            onClick={() => onPick(c)}
          />
        )
      })}
    </div>
  )
}
