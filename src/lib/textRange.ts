/**
 * 손끝으로 그은 구간을 글자 범위로 바꾸는 계산.
 *
 * 태블릿에서 브라우저 기본 선택에 기대면 OS 선택 핸들과 복사·공유 메뉴가 함께 뜨고,
 * PDF 처럼 글자를 조각조각 얹어 둔 본문에서는 범위 잡기도 잘 듣지 않는다.
 * 그래서 선택 기능을 쓰지 않고 눌렀다 뗀 두 지점만으로 범위를 직접 만든다.
 */

export interface CaretPoint {
  node: Node
  offset: number
}

/** 브라우저마다 이름이 갈리고 아직 없는 곳도 있어 있는 쪽을 골라 쓴다 */
interface CaretLookup {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
}

/** 화면 좌표(문서 기준)에 놓인 글자 위치 */
export function caretAt(doc: Document, x: number, y: number): CaretPoint | null {
  const target = doc as unknown as CaretLookup
  const range = target.caretRangeFromPoint?.(x, y)
  if (range) return { node: range.startContainer, offset: range.startOffset }
  const pos = target.caretPositionFromPoint?.(x, y)
  return pos ? { node: pos.offsetNode, offset: pos.offset } : null
}

/** 글자 중간에서 끊긴 양끝을 단어 경계까지 늘려 준다 */
function expandToWords(range: Range) {
  const start = range.startContainer
  if (start.nodeType === Node.TEXT_NODE) {
    const text = start.textContent ?? ''
    let i = range.startOffset
    while (i > 0 && !/\s/.test(text[i - 1])) i -= 1
    range.setStart(start, i)
  }

  const end = range.endContainer
  if (end.nodeType === Node.TEXT_NODE) {
    const text = end.textContent ?? ''
    let j = range.endOffset
    while (j < text.length && !/\s/.test(text[j])) j += 1
    range.setEnd(end, j)
  }
}

/**
 * 두 지점 사이의 범위. 어느 쪽을 먼저 눌렀는지와 무관하게 문서 순서로 맞춘다.
 * 범위가 비어 있으면(같은 글자 안에서 멈춤) null.
 */
export function rangeBetween(doc: Document, from: CaretPoint, to: CaretPoint): Range | null {
  try {
    const range = doc.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(from.node, from.offset)

    if (range.comparePoint(to.node, to.offset) < 0) range.setStart(to.node, to.offset)
    else range.setEnd(to.node, to.offset)

    expandToWords(range)
    return range.collapsed ? null : range
  } catch {
    // 두 지점이 서로 다른 문서·조각에 있으면 범위를 만들 수 없다
    return null
  }
}
