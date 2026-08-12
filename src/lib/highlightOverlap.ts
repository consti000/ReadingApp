import type { Rect } from '@/types'

/**
 * 같은 자리를 다시 그었는지 가늠하는 계산.
 *
 * 손으로 그은 범위는 늘 조금씩 다르게 잡히므로, 이미 칠한 곳을 다시 칠하면
 * 색이 겹쳐 진해지고 카드도 둘로 늘어난다. 서로 이만큼씩 덮으면 새 하이라이트를
 * 만들지 않고 원래 것을 고쳐 쓴다. 문장 안에 다른 색을 겹쳐 넣는 표시는 그대로 남는다.
 */
const REMARK_OVERLAP = 0.6

/** 두 영역이 서로를 충분히 덮는지 (겹친 양, 각각의 크기) */
export function isSameSpot(shared: number, a: number, b: number) {
  return a > 0 && b > 0 && shared / a >= REMARK_OVERLAP && shared / b >= REMARK_OVERLAP
}

export function rectsArea(rects: Rect[]) {
  return rects.reduce((sum, r) => sum + r.width * r.height, 0)
}

/** 페이지 비율 좌표끼리 겹친 면적 */
export function rectsOverlapArea(a: Rect[], b: Rect[]) {
  let shared = 0
  for (const p of a) {
    for (const q of b) {
      const w = Math.min(p.left + p.width, q.left + q.width) - Math.max(p.left, q.left)
      const h = Math.min(p.top + p.height, q.top + q.height) - Math.max(p.top, q.top)
      if (w > 0 && h > 0) shared += w * h
    }
  }
  return shared
}
