import { EpubCFI } from 'epubjs'
import type { Highlight } from '@/types'

const cfiTool = new EpubCFI()

/** 페이지 안에서 발췌가 시작하는 자리 (0~1 비율) */
function startOf(hl: Highlight): { top: number; left: number } {
  let top = Infinity
  let left = Infinity
  for (const r of hl.rects) {
    if (r.top < top - 0.004) {
      top = r.top
      left = r.left
    } else if (Math.abs(r.top - top) <= 0.004 && r.left < left) {
      left = r.left
    }
  }
  return { top: top === Infinity ? 0 : top, left: left === Infinity ? 0 : left }
}

/** 한 문서 안에서 어느 발췌가 앞에 오는지 */
export function compareHighlightPlace(a: Highlight, b: Highlight, epub: boolean): number {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
  if (epub && a.cfi && b.cfi) {
    try {
      const c = cfiTool.compare(a.cfi, b.cfi)
      if (c) return c
    } catch {
      // 형식이 깨진 CFI 는 아래 좌표·시각 비교로 넘긴다
    }
  }
  const pa = startOf(a)
  const pb = startOf(b)
  if (Math.abs(pa.top - pb.top) > 0.004) return pa.top - pb.top
  if (Math.abs(pa.left - pb.left) > 0.004) return pa.left - pb.left
  return a.createdAt - b.createdAt
}

/** 원문에 나오는 순서대로 늘어놓는다 */
export function sortHighlightsByPlace(list: Highlight[], epub: boolean): Highlight[] {
  return [...list].sort((a, b) => compareHighlightPlace(a, b, epub))
}
