/** 화면·본문에서 쓰는 사각형 */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Band {
  left: number
  top: number
  right: number
  bottom: number
}

function rightOf(r: { left: number; width: number; right?: number }) {
  return typeof r.right === 'number' ? r.right : r.left + r.width
}

function bottomOf(r: { top: number; height: number; bottom?: number }) {
  return typeof r.bottom === 'number' ? r.bottom : r.top + r.height
}

/**
 * 한 줄에 놓인 조각들을 한 덩어리로 합친다.
 *
 * 글자 조각마다 사각형이 따로 나오고 조각끼리 조금씩 겹쳐 있어서, 그대로 칠하면
 * 이음매마다 색이 두 번 얹혀 진하게 보인다. 단 칸이 크게 벌어진 곳(다단의 단 사이)은
 * 남겨 두어야 하므로 글자 높이만큼 이상 떨어진 조각은 합치지 않는다.
 */
export function mergeLineRects(
  rects: ArrayLike<{
    left: number
    top: number
    width: number
    height: number
    right?: number
    bottom?: number
  }>,
): Box[] {
  const bands: Band[] = []
  const list = Array.from(rects).sort((a, b) => a.top - b.top || a.left - b.left)
  for (const r of list) {
    const right = rightOf(r)
    const bottom = bottomOf(r)
    const band = bands.find((b) => {
      const shared = Math.min(b.bottom, bottom) - Math.max(b.top, r.top)
      const sameLine = shared > Math.min(b.bottom - b.top, r.height) * 0.5
      const gap = Math.max(b.left, r.left) - Math.min(b.right, right)
      return sameLine && gap <= r.height
    })
    if (band) {
      band.left = Math.min(band.left, r.left)
      band.top = Math.min(band.top, r.top)
      band.right = Math.max(band.right, right)
      band.bottom = Math.max(band.bottom, bottom)
    } else {
      bands.push({ left: r.left, top: r.top, right, bottom })
    }
  }
  return bands.map((b) => ({
    left: b.left,
    top: b.top,
    width: b.right - b.left,
    height: b.bottom - b.top,
  }))
}

/**
 * 줄 상자(line box)가 글자보다 많이 크면 위아래를 줄여 글자에 붙인다.
 * 이미 글자 높이에 가까운 상자는 그대로 둔다 — 줄이면 글자에서 떨어진다.
 */
export function tightenLineBox(r: Box, fontSize: number): Box {
  if (!(fontSize > 0) || r.height <= fontSize * 1.28) return r
  const extra = r.height - fontSize
  const pad = extra * 0.42
  return {
    left: r.left,
    top: r.top + pad,
    width: r.width,
    height: Math.max(fontSize * 0.85, r.height - pad * 2),
  }
}

/** 다른 상자 안에 드는 부분만 남긴다. 거의 없으면 null. */
export function clipBox(r: Box, clip: Box): Box | null {
  const left = Math.max(r.left, clip.left)
  const top = Math.max(r.top, clip.top)
  const right = Math.min(r.left + r.width, clip.left + clip.width)
  const bottom = Math.min(r.top + r.height, clip.top + clip.height)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null
  return { left, top, width, height }
}

/** 범위가 놓인 글자의 크기 — 줄 상자를 글자에 맞출 때 쓴다 */
export function fontSizeOfRange(range: Range): number {
  const node = range.startContainer
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const view = el?.ownerDocument.defaultView
  if (!el || !view) return 16
  const size = parseFloat(view.getComputedStyle(el).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

/** 범위에서 칠할 줄 상자를 만든다 (이음매 합치기 + 글자 높이에 맞춤) */
export function lineBoxesOfRange(range: Range): Box[] {
  const fontSize = fontSizeOfRange(range)
  const raw = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5)
  return mergeLineRects(raw).map((r) => tightenLineBox(r, fontSize))
}
