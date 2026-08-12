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

/** 그 좌표에 글자가 있을 때만 인정한다 (그림·여백에서 잡힌 위치는 범위로 못 쓴다) */
function probeCaret(doc: Document, x: number, y: number): CaretPoint | null {
  const target = doc as unknown as CaretLookup
  const range = target.caretRangeFromPoint?.(x, y)
  const point = range
    ? { node: range.startContainer, offset: range.startOffset }
    : (() => {
        const pos = target.caretPositionFromPoint?.(x, y)
        return pos ? { node: pos.offsetNode, offset: pos.offset } : null
      })()
  return point?.node.nodeType === Node.TEXT_NODE ? point : null
}

/** 여백을 건너 글자를 찾아볼 거리 — 줄 끝을 넘겨 그어도 그 줄 끝까지 잡히게 한다 */
const REACH_STEP_PX = 12
const REACH_MAX_PX = 480

/**
 * 화면 좌표(문서 기준)에 놓인 글자 위치. 여백이면 같은 줄에서 가장 가까운 글자를 준다.
 * `scope` 를 주면 그 안의 글자만 인정한다 — 본문 밖(사이드바 등)으로 범위가 새지 않게.
 */
export function caretAt(
  doc: Document,
  x: number,
  y: number,
  scope?: Element | null,
): CaretPoint | null {
  const inScope = (point: CaretPoint | null) =>
    point && (!scope || scope.contains(point.node)) ? point : null

  const direct = inScope(probeCaret(doc, x, y))
  if (direct) return direct

  // 여백을 짚었을 때는 빈칸 조각을 건너뛰고 실제 글자에 붙어야 줄 끝까지 잡힌다
  const nearby = (at: number) => {
    const point = inScope(probeCaret(doc, at, y))
    return point && (point.node.textContent ?? '').trim() ? point : null
  }

  for (let away = REACH_STEP_PX; away <= REACH_MAX_PX; away += REACH_STEP_PX) {
    const before = nearby(x - away)
    if (before) return snapToEdge(before, x)
    const after = nearby(x + away)
    if (after) return snapToEdge(after, x)
  }
  return null
}

/** 여백에서 찾은 글자는 손끝이 있는 쪽 끝에 붙인다 — 줄 끝을 넘겨 그으면 그 줄 끝까지 */
function snapToEdge(point: CaretPoint, x: number): CaretPoint {
  const doc = point.node.ownerDocument
  if (!doc) return point
  const whole = doc.createRange()
  whole.selectNodeContents(point.node)
  const box = whole.getBoundingClientRect()
  if (x > box.right) return { node: point.node, offset: point.node.textContent?.length ?? point.offset }
  if (x < box.left) return { node: point.node, offset: 0 }
  return point
}

/** 그 글자가 속한 본문 조각 — 범위가 이 밖으로 새지 않게 가둘 때 쓴다 */
export function scopeOf(point: CaretPoint, selector: string): Element | null {
  const el = point.node.nodeType === Node.ELEMENT_NODE ? (point.node as Element) : point.node.parentElement
  return el?.closest(selector) ?? null
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

/** 두 범위가 겹치는 부분 — 같은 자리를 다시 그었는지 가늠할 때 쓴다 */
export function intersectRanges(a: Range, b: Range): Range | null {
  try {
    const later = a.compareBoundaryPoints(Range.START_TO_START, b) >= 0 ? a : b
    const earlier = a.compareBoundaryPoints(Range.END_TO_END, b) <= 0 ? a : b
    const shared = a.cloneRange()
    shared.setStart(later.startContainer, later.startOffset)
    shared.setEnd(earlier.endContainer, earlier.endOffset)
    return shared.collapsed ? null : shared
  } catch {
    // 서로 만나지 않는 범위
    return null
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
