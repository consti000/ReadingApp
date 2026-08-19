import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { loadPdfDocument } from '@/lib/pdf'
import { loadDocument } from '@/lib/opfs'
import {
  createHighlight,
  addNodeToWorkspace,
  deleteLastPenStroke,
  updateHighlightColor,
  updateHighlightRegion,
  deleteHighlight,
} from '@/lib/actions'
import { isSameSpot, rectsArea, rectsOverlapArea } from '@/lib/highlightOverlap'
import { usePaneSize } from '@/lib/panes'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useUiStore } from '@/store/uiStore'
import { PenOverlay } from '@/components/PenOverlay'
import { HighlightEditMenu } from '@/components/HighlightEditMenu'
import type { AnchorPort, HighlightAnchor } from '@/lib/highlightAnchors'
import { caretAt, rangeBetween, scopeOf, type CaretPoint } from '@/lib/textRange'
import { ColorPalette } from '@/components/ColorPalette'
import { BookmarkControls } from '@/components/BookmarkPanel'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_OPACITY,
  isUnderlineColor,
  type Highlight,
  type HighlightColor,
  type Rect,
} from '@/types'
import './PdfViewer.css'

interface Props {
  documentId: string
  projectId: string
  workspaceId?: string
  /** 리더 화면이 연결선을 그릴 때 쓰는 좌표 통로 */
  anchorPort?: AnchorPort
}

interface SelectionPayload {
  text: string
  pageIndex: number
  rects: Rect[]
}

/** 필기 색(색상값)이 범례의 어느 칸인지 */
const penColorKey = (hex: string): HighlightColor =>
  (Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).find((c) => HIGHLIGHT_COLORS[c] === hex) ??
  'yellow'

const rectStyle = (r: Rect) => ({
  left: `${r.left * 100}%`,
  top: `${r.top * 100}%`,
  width: `${r.width * 100}%`,
  height: `${r.height * 100}%`,
})

/** 밑줄 범례는 칠하지 않고 아래 선 색만 정한다 */
const paintStyle = (color: HighlightColor) =>
  isUnderlineColor(color)
    ? { borderBottomColor: HIGHLIGHT_COLORS[color] }
    : { background: HIGHLIGHT_COLORS[color] }

const groupClass = (color: HighlightColor) =>
  `hl-group ${isUnderlineColor(color) ? 'underline' : ''}`

/** 진하기는 하이라이트 한 겹에서 한 번만 정한다 */
const groupOpacity = (color: HighlightColor, active: boolean) => {
  if (isUnderlineColor(color)) return active ? 1 : 0.9
  return active ? 0.75 : HIGHLIGHT_OPACITY
}

interface Band {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 한 줄에 놓인 조각들을 한 덩어리로 합친다.
 *
 * 글자 조각마다 사각형이 따로 나오고 조각끼리 조금씩 겹쳐 있어서, 그대로 칠하면
 * 이음매마다 색이 두 번 얹혀 진하게 보인다. 단 칸이 크게 벌어진 곳(다단 편집의 단 사이)은
 * 남겨 두어야 하므로 글자 높이만큼 이상 떨어진 조각은 합치지 않는다.
 */
function mergeLineRects(rects: DOMRect[]): { left: number; top: number; width: number; height: number }[] {
  const bands: Band[] = []
  for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const band = bands.find((b) => {
      const shared = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)
      const sameLine = shared > Math.min(b.bottom - b.top, r.height) * 0.5
      const gap = Math.max(b.left, r.left) - Math.min(b.right, r.right)
      return sameLine && gap <= r.height
    })
    if (band) {
      band.left = Math.min(band.left, r.left)
      band.top = Math.min(band.top, r.top)
      band.right = Math.max(band.right, r.right)
      band.bottom = Math.max(band.bottom, r.bottom)
    } else {
      bands.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
  }
  return bands.map((b) => ({
    left: b.left,
    top: b.top,
    width: b.right - b.left,
    height: b.bottom - b.top,
  }))
}

/** 그 위치가 놓인 페이지 */
function pageOf(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return (el?.closest('[data-page]') as HTMLElement | null) ?? null
}

/** 범위에서 그 요소 안에 든 부분만 남긴다 */
function clipToElement(range: Range, el: Element): Range | null {
  const bounds = range.cloneRange()
  bounds.selectNodeContents(el)
  const clipped = range.cloneRange()
  try {
    if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
      clipped.setStart(bounds.startContainer, bounds.startOffset)
    }
    if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
      clipped.setEnd(bounds.endContainer, bounds.endOffset)
    }
  } catch {
    return null
  }
  return clipped.collapsed ? null : clipped
}

/** 손가락이 주 입력인 기기 — 여기서는 브라우저 선택 대신 직접 칠한다 */
const COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

/**
 * 화면 위아래로 이만큼까지만 미리 그려 두고, 그 밖으로 나간 페이지는 지운다.
 * 모든 장을 한꺼번에 그리면 그림 한 장마다 수 MB 씩 쌓여 긴 문서에서 탭이 메모리 부족으로 죽는다.
 */
const KEEP_DRAWN_MARGIN_PX = 1200

/** 페이지로 옮겼을 때 위쪽에 남겨 두는 여백 */
const PAGE_TOP_GAP_PX = 8

/** 이만큼 제자리에서 누르고 있으면 넘기기가 아니라 색칠로 넘어간다 */
const HOLD_TO_MARK_MS = 380
const HOLD_MOVE_TOLERANCE_PX = 12

export function PdfViewer({ documentId, projectId, workspaceId, anchorPort }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  /** 배율 1 기준 첫 장 크기 — 아직 그리지 않은 페이지의 자리를 잡는 데 쓴다 */
  const [pageBox, setPageBox] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1.15)
  /** 켜 두면 문서 칸 폭에 배율을 맞춘다 (칸을 좁히거나 넓히면 따라간다) */
  const [fitFlag, , setFitFlag] = usePaneSize('pdf-fit-width', 0)
  const fitWidth = fitFlag === 1
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<SelectionPayload | null>(null)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 손끝을 따라 칠해질 자리를 미리 보여 준다 */
  const [preview, setPreview] = useState<SelectionPayload | null>(null)

  const highlightColor = useUiStore((s) => s.highlightColor)
  const setHighlightColor = useUiStore((s) => s.setHighlightColor)
  const penColor = useUiStore((s) => s.penColor)
  const setPenColor = useUiStore((s) => s.setPenColor)
  const readerTool = useUiStore((s) => s.readerTool)
  const setReaderTool = useUiStore((s) => s.setReaderTool)
  const pendingJump = useUiStore((s) => s.pendingJump)
  const setPendingJump = useUiStore((s) => s.setPendingJump)
  const activeHighlightId = useUiStore((s) => s.activeHighlightId)

  const highlights = useLiveQuery(
    () => db.highlights.where('documentId').equals(documentId).toArray(),
    [documentId],
  )

  // 제스처 처리는 이벤트 리스너 안에서 최신 값을 봐야 한다
  const colorRef = useRef(highlightColor)
  const toolRef = useRef(readerTool)
  const highlightsRef = useRef<Highlight[]>([])
  colorRef.current = highlightColor
  toolRef.current = readerTool
  highlightsRef.current = highlights ?? []

  /** 본문(.pdf-scroll)이 화면에 있는 상태 */
  const viewerReady = !loading && !error && Boolean(pdf)

  /*
   * 지금 그려 둘 페이지 구간.
   * 페이지는 위에서 아래로 차례로 놓이므로, 화면에 걸치는 첫 장과 마지막 장을
   * 이분 탐색으로 찾는다. 300 쪽짜리라도 스크롤 한 번에 열 번 남짓만 재면 된다.
   */
  const [drawRange, setDrawRange] = useState({ from: 0, to: 1 })
  /** 지금 읽고 있는 페이지 (0부터) — 화면 가운데에 놓인 장 */
  const [pageNow, setPageNow] = useState(0)
  const pageHosts = useRef(new Map<number, HTMLDivElement>())
  const rangeRafRef = useRef(0)

  const bindPageHost = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) pageHosts.current.set(index, el)
    else pageHosts.current.delete(index)
  }, [])

  const measureDrawRange = useCallback(() => {
    const scroll = containerRef.current
    const last = (pdf?.numPages ?? 0) - 1
    if (!scroll || last < 0) return

    const view = scroll.getBoundingClientRect()
    const top = view.top - KEEP_DRAWN_MARGIN_PX
    const bottom = view.bottom + KEEP_DRAWN_MARGIN_PX
    const rectOf = (i: number) => pageHosts.current.get(i)?.getBoundingClientRect() ?? null

    const search = (keep: (i: number) => boolean) => {
      let lo = 0
      let hi = last
      let found = last
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (keep(mid)) {
          found = mid
          hi = mid - 1
        } else lo = mid + 1
      }
      return found
    }

    // 아래쪽 끝이 화면 위 경계를 지난 첫 장 / 위쪽 끝이 아래 경계를 넘어선 첫 장
    const from = search((i) => (rectOf(i)?.bottom ?? Infinity) >= top)
    const after = search((i) => (rectOf(i)?.top ?? Infinity) > bottom)
    const to = Math.max(from, Math.min(last, after - 1))

    setDrawRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to }))
    // 화면 가운데를 지나는 장을 지금 읽는 페이지로 삼는다
    setPageNow(search((i) => (rectOf(i)?.bottom ?? Infinity) >= (view.top + view.bottom) / 2))
  }, [pdf])

  /** 그 페이지의 첫머리에 맞춘다 (창 전체가 아니라 본문만 움직인다) */
  const alignPage = useCallback((index: number) => {
    const scroll = containerRef.current
    const el = pageHosts.current.get(index)
    if (!scroll || !el) return
    const offset = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    // 한 장씩 건너뛰는 이동이라 곧바로 옮긴다 (부드러운 이동은 중간 페이지를 괜히 그린다)
    scroll.scrollTop = scroll.scrollTop + offset - PAGE_TOP_GAP_PX
  }, [])

  /**
   * 아직 그리지 않은 페이지는 첫 장 크기로 자리만 잡아 두므로, 크기가 다른 장이 있으면
   * 옮긴 뒤 실제 크기가 들어올 때 화면이 조금 밀린다. 그 장을 그린 뒤 한 번 더 맞춘다.
   */
  const jumpTargetRef = useRef<number | null>(null)

  const goToPage = useCallback(
    (index: number) => {
      const last = (pdf?.numPages ?? 0) - 1
      const target = Math.max(0, Math.min(last, index))
      jumpTargetRef.current = target
      setPageNow(target)
      alignPage(target)
    },
    [pdf, alignPage],
  )

  /** 지금 칸에 한 장이 꼭 들어가는 배율 */
  const widthScale = useCallback((): number | null => {
    const scroll = containerRef.current
    if (!scroll || !pageBox || pageBox.w < 1) return null
    const pad = getComputedStyle(scroll)
    const room =
      scroll.clientWidth -
      parseFloat(pad.paddingLeft || '0') -
      parseFloat(pad.paddingRight || '0') -
      // 그림 크기가 반올림되며 1~2px 넘치면 가로 스크롤이 생긴다
      2
    if (room < 80) return null
    // 올림하면 칸을 넘기므로 내림한다
    return Math.floor(Math.min(Math.max(room / pageBox.w, 0.6), 2.5) * 100) / 100
  }, [pageBox])

  // 칸 크기가 바뀔 때마다 다시 맞춘다
  useEffect(() => {
    const scroll = containerRef.current
    if (!viewerReady || !fitWidth || !scroll) return
    const apply = () => {
      const next = widthScale()
      if (next !== null) setScale((s) => (Math.abs(s - next) < 0.005 ? s : next))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [viewerReady, fitWidth, widthScale])

  const zoomBy = useCallback(
    (step: number) => {
      setFitFlag(0)
      setScale((s) => Math.round(Math.min(Math.max(s + step, 0.6), 2.5) * 100) / 100)
    },
    [setFitFlag],
  )

  const scheduleDrawRange = useCallback(() => {
    if (rangeRafRef.current) return
    rangeRafRef.current = requestAnimationFrame(() => {
      rangeRafRef.current = 0
      measureDrawRange()
    })
  }, [measureDrawRange])

  useEffect(() => {
    if (!viewerReady) return
    scheduleDrawRange()
    window.addEventListener('resize', scheduleDrawRange)
    // 분할선을 끌면 창 크기는 그대로고 이 칸만 바뀌므로 칸을 직접 지켜본다
    const observer = new ResizeObserver(() => {
      scheduleDrawRange()
      anchorPort?.invalidate()
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      window.removeEventListener('resize', scheduleDrawRange)
      observer.disconnect()
      if (rangeRafRef.current) cancelAnimationFrame(rangeRafRef.current)
      rangeRafRef.current = 0
    }
  }, [viewerReady, scale, scheduleDrawRange, anchorPort])

  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | null = null
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const blob = await loadDocument(documentId, 'pdf')
        if (!blob) throw new Error('PDF 파일을 찾을 수 없습니다 (OPFS)')
        const buf = await blob.arrayBuffer()
        const doc = await loadPdfDocument(new Uint8Array(buf))
        if (cancelled) {
          void doc.destroy()
          return
        }
        opened = doc

        // 아직 그리지 않은 페이지도 자리는 잡아 둬야 하므로 첫 장 크기를 재 둔다
        const first = await doc.getPage(1)
        const box = first.getViewport({ scale: 1 })
        if (cancelled) return

        setPageBox({ w: box.width, h: box.height })
        setPdf(doc)
        await db.documents.update(documentId, { pageCount: doc.numPages })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'PDF 로드 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      // 문서를 닫을 때 워커가 쥐고 있던 페이지·글꼴 자료까지 함께 놓아준다
      void opened?.destroy()
    }
  }, [documentId])

  useEffect(() => {
    if (!pendingJump || pendingJump.documentId !== documentId) return
    if (pendingJump.bookmarkId) {
      if (!pdf) return
      const id = pendingJump.bookmarkId
      setPendingJump(null)
      void db.bookmarks.get(id).then((bm) => {
        if (bm) goToPage(bm.pageIndex)
      })
      return
    }
    if (!pendingJump.highlightId || !highlights) return
    const h = highlights.find((x) => x.id === pendingJump.highlightId)
    if (!h) return
    const el = containerRef.current?.querySelector(`[data-page="${h.pageIndex}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPendingJump(null)
  }, [pendingJump, documentId, highlights, pdf, goToPage, setPendingJump])

  /*
   * 하이라이트 사각형은 텍스트 레이어 아래에 있어 클릭을 직접 받지 못한다.
   * 그래서 눌린 좌표를 페이지 비율로 바꿔 저장된 rect 와 맞춰본다.
   */
  const hitTestHighlight = useCallback(
    (target: Element, clientX: number, clientY: number): Highlight | null => {
      const pageEl = target.closest?.('[data-page]') as HTMLElement | null
      if (!pageEl) return null
      const pageRect = pageEl.getBoundingClientRect()
      if (pageRect.width < 1 || pageRect.height < 1) return null

      const pageIndex = Number(pageEl.dataset.page)
      const fx = (clientX - pageRect.left) / pageRect.width
      const fy = (clientY - pageRect.top) / pageRect.height

      // 겹친 하이라이트는 나중에 만든 것이 위에 그려지므로 뒤에서부터 찾는다
      const onPage = (highlights ?? [])
        .filter((h) => h.pageIndex === pageIndex)
        .sort((a, b) => a.createdAt - b.createdAt)

      for (let i = onPage.length - 1; i >= 0; i -= 1) {
        const h = onPage[i]
        const hit = h.rects.some(
          (r) => fx >= r.left && fx <= r.left + r.width && fy >= r.top && fy <= r.top + r.height,
        )
        if (hit) return h
      }
      return null
    },
    [highlights],
  )

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      // 드래그로 텍스트를 선택한 직후의 클릭은 선택 메뉴가 처리한다
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return

      const hit = hitTestHighlight(e.target as Element, e.clientX, e.clientY)
      setEditing(hit ? { id: hit.id, x: e.clientX, y: e.clientY + 16 } : null)
    },
    [hitTestHighlight],
  )

  useEffect(() => {
    if (!anchorPort) return
    anchorPort.register(() => {
      const scroll = containerRef.current
      if (!scroll) return null
      const clip = scroll.getBoundingClientRect()
      if (clip.width < 1 || clip.height < 1) return null

      const anchors = new Map<string, HighlightAnchor>()
      for (const el of scroll.querySelectorAll<HTMLElement>('[data-highlight]')) {
        const id = el.dataset.highlight
        if (!id) continue
        const r = el.getBoundingClientRect()
        const y = r.top + r.height / 2
        if (y < clip.top || y > clip.bottom) continue
        // 여러 줄에 걸친 하이라이트는 마지막 줄 끝에서 선을 뽑는다
        const prev = anchors.get(id)
        if (!prev || y > prev.y) anchors.set(id, { x: r.right, y })
      }
      return { clip, anchors }
    })
    return () => anchorPort.register(null)
  }, [anchorPort])

  useEffect(() => {
    anchorPort?.invalidate()
  }, [anchorPort, scale, highlights])

  // 삭제된 하이라이트의 메뉴는 닫는다
  useEffect(() => {
    if (editing && highlights && !highlights.some((h) => h.id === editing.id)) setEditing(null)
  }, [editing, highlights])

  /** 글자 범위를 페이지 비율 좌표로 옮긴다 (한 페이지 안에서만) */
  const readRange = useCallback((range: Range): SelectionPayload | null => {
    const pageEl = pageOf(range.startContainer) ?? pageOf(range.endContainer)
    if (!pageEl) return null

    /*
     * 마우스로 끌면 아래 페이지나 옆 목록까지 함께 잡히기 쉽다.
     * 그대로 두면 다른 페이지의 글자까지 한 페이지 좌표로 접혀 엉뚱한 자리가 칠해지므로,
     * 시작한 페이지 안쪽만 남기고 잘라 낸다.
     */
    const onPage = clipToElement(range, pageEl.querySelector('.text-layer') ?? pageEl)
    const text = onPage?.toString().trim()
    if (!onPage || !text) return null

    const pageRect = pageEl.getBoundingClientRect()
    if (pageRect.width < 1 || pageRect.height < 1) return null

    const clientRects = Array.from(onPage.getClientRects()).filter(
      (r) => r.width > 0.5 && r.height > 0.5,
    )
    if (!clientRects.length) return null

    const pageIndex = Number(pageEl.dataset.page)
    return {
      text,
      pageIndex,
      rects: mergeLineRects(clientRects).map((r) => ({
        pageIndex,
        left: (r.left - pageRect.left) / pageRect.width,
        top: (r.top - pageRect.top) / pageRect.height,
        width: r.width / pageRect.width,
        height: r.height / pageRect.height,
      })),
    }
  }, [])

  const commitHighlight = useCallback(
    async (payload: SelectionPayload, color: HighlightColor) => {
      // 이미 칠한 자리를 다시 그은 것이면 색을 덧칠하지 않고 그 하이라이트를 고쳐 쓴다
      const area = rectsArea(payload.rects)
      const again = highlightsRef.current.find((h) => {
        if (h.pageIndex !== payload.pageIndex || !h.rects.length) return false
        const shared = rectsOverlapArea(h.rects, payload.rects)
        return isSameSpot(shared, rectsArea(h.rects), area)
      })
      if (again) {
        await updateHighlightRegion(again.id, {
          text: payload.text,
          color,
          rects: payload.rects,
          pageIndex: payload.pageIndex,
        })
        return
      }

      const { nodeId } = await createHighlight({
        documentId,
        projectId,
        text: payload.text,
        color,
        rects: payload.rects,
        pageIndex: payload.pageIndex,
      })
      if (workspaceId) {
        await addNodeToWorkspace(
          workspaceId,
          nodeId,
          60 + Math.random() * 120,
          60 + Math.random() * 80,
        )
      }
    },
    [documentId, projectId, workspaceId],
  )

  const captureSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null)
      setSelMenu(null)
      return
    }
    const range = sel.getRangeAt(0)
    const payload = readRange(range)
    if (!payload) return

    const clientRects = Array.from(range.getClientRects())
    const last = clientRects[clientRects.length - 1]
    setSelection(payload)
    setSelMenu({ x: last.right, y: last.bottom + 8 })
    // 새로 고른 텍스트가 있으면 열려 있던 편집 메뉴는 비켜준다
    setEditing(null)
  }, [readRange])

  /** 필기 오버레이가 대신 잡아 준 범위 (펜 버튼·길게 누르기) */
  const markRef = useRef<SelectionPayload | null>(null)

  const handleMarkChange = useCallback(
    (range: Range | null) => {
      const payload = range ? readRange(range) : null
      markRef.current = payload
      setPreview(payload)
    },
    [readRange],
  )

  const handleMarkCommit = useCallback(() => {
    const payload = markRef.current
    markRef.current = null
    setPreview(null)
    if (payload) void commitHighlight(payload, colorRef.current)
  }, [commitHighlight])

  /*
   * 태블릿에서 브라우저 선택은 OS 선택 핸들과 복사·공유 메뉴를 함께 불러오고,
   * 조각조각 얹어 둔 PDF 글자 위에서는 범위도 잘 잡히지 않는다.
   * 그래서 제자리에서 잠깐 누른 뒤(펜은 곧바로) 그은 구간을 읽어 바로 칠한다.
   */
  useEffect(() => {
    const scroll = containerRef.current
    if (!scroll) return

    let hold = 0
    let origin: { x: number; y: number; pointerId: number } | null = null
    let from: CaretPoint | null = null
    let scopeEl: Element | null = null
    let marking = false
    let pending: SelectionPayload | null = null

    const reset = () => {
      if (hold) window.clearTimeout(hold)
      hold = 0
      origin = null
      from = null
      scopeEl = null
      marking = false
      pending = null
      setPreview(null)
    }

    const beginMark = (x: number, y: number) => {
      from = caretAt(document, x, y)
      // 시작한 페이지 안에서만 범위를 잡는다
      scopeEl = from ? scopeOf(from, '.text-layer') : null
      if (from) marking = true
      else reset()
    }

    const onDown = (e: PointerEvent) => {
      // 마우스는 브라우저 선택이 잘 듣기 때문에 그대로 둔다
      if (toolRef.current !== 'highlight' || e.pointerType === 'mouse' || !e.isPrimary) return
      reset()
      origin = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      if (e.pointerType === 'pen') beginMark(e.clientX, e.clientY)
      else
        hold = window.setTimeout(() => {
          hold = 0
          if (origin) beginMark(origin.x, origin.y)
        }, HOLD_TO_MARK_MS)
    }

    const onMove = (e: PointerEvent) => {
      if (!origin || e.pointerId !== origin.pointerId) return
      if (!marking) {
        // 누르고 있는 사이에 움직였다면 페이지를 넘기려는 손짓이다
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > HOLD_MOVE_TOLERANCE_PX) reset()
        return
      }
      const to = caretAt(document, e.clientX, e.clientY, scopeEl)
      const range = from && to ? rangeBetween(document, from, to) : null
      const next = range ? readRange(range) : null
      // 그림·여백을 지나가는 동안에는 직전까지 잡아 둔 범위를 지킨다
      if (!next) return
      pending = next
      setPreview(next)
    }

    const onUp = () => {
      const payload = marking ? pending : null
      reset()
      if (!payload) return
      // 펜 드래그가 브라우저 선택까지 남겼다면 함께 지운다
      window.getSelection()?.removeAllRanges()
      void commitHighlight(payload, colorRef.current)
    }

    // 칠하기가 시작된 뒤에는 화면이 따라 흐르지 않아야 한다
    const onTouchMove = (e: TouchEvent) => {
      if (marking) e.preventDefault()
    }

    scroll.addEventListener('pointerdown', onDown)
    scroll.addEventListener('pointermove', onMove)
    scroll.addEventListener('pointerup', onUp)
    scroll.addEventListener('pointercancel', reset)
    scroll.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      scroll.removeEventListener('pointerdown', onDown)
      scroll.removeEventListener('pointermove', onMove)
      scroll.removeEventListener('pointerup', onUp)
      scroll.removeEventListener('pointercancel', reset)
      scroll.removeEventListener('touchmove', onTouchMove)
      if (hold) window.clearTimeout(hold)
    }
    // 본문 영역은 로딩이 끝난 뒤에야 생기므로 그 시점에 붙어야 한다
  }, [readRange, commitHighlight, viewerReady])

  const applyHighlight = async () => {
    if (!selection) return
    await commitHighlight(selection, highlightColor)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    setSelMenu(null)
  }

  if (loading) return <div className="pdf-status">PDF 불러오는 중…</div>
  if (error) return <div className="pdf-status error">{error}</div>
  if (!pdf) return null

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="tool-row">
          <button
            className={`btn btn-sm ${readerTool === 'highlight' ? 'btn-primary' : ''}`}
            onClick={() => setReaderTool('highlight')}
          >
            하이라이트
          </button>
          <button
            className={`btn btn-sm ${readerTool === 'pen' ? 'btn-primary' : ''}`}
            onClick={() => setReaderTool('pen')}
          >
            필기(펜)
          </button>
        </div>
        {readerTool === 'highlight' ? (
          <ColorPalette value={highlightColor} onPick={setHighlightColor} />
        ) : (
          /* 필기 범례도 하이라이트와 같은 모양을 쓴다 */
          <ColorPalette
            value={penColorKey(penColor)}
            onPick={(c) => setPenColor(HIGHLIGHT_COLORS[c])}
          />
        )}
        <div className="zoom-row">
          <button className="btn btn-sm" onClick={() => zoomBy(-0.1)}>
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button className="btn btn-sm" onClick={() => zoomBy(0.1)}>
            +
          </button>
          <button
            className={`btn btn-sm ${fitWidth ? 'btn-primary' : ''}`}
            title="문서 칸 폭에 맞춰 배율을 따라가게 합니다"
            onClick={() => setFitFlag(fitWidth ? 0 : 1)}
          >
            폭 맞춤
          </button>
        </div>
        {readerTool === 'pen' && (
          <button className="btn btn-sm" onClick={() => void deleteLastPenStroke(documentId)}>
            필기 되돌리기
          </button>
        )}
        <div className="pdf-nav">
          <button
            className="btn btn-sm"
            disabled={pageNow <= 0}
            onClick={() => goToPage(pageNow - 1)}
          >
            ← 이전 페이지
          </button>
          <span className="pdf-loc">
            {pageNow + 1} / {pdf.numPages}
          </span>
          <button
            className="btn btn-sm"
            disabled={pageNow >= pdf.numPages - 1}
            onClick={() => goToPage(pageNow + 1)}
          >
            다음 페이지 →
          </button>
        </div>
        <BookmarkControls
          projectId={projectId}
          documentId={documentId}
          getPlace={() => ({ pageIndex: pageNow, label: `${pageNow + 1}쪽` })}
          onJump={(bm) => goToPage(bm.pageIndex)}
        />
        <span className="pdf-hint">
          {readerTool === 'pen'
            ? 'S펜 압력 필기 · 손가락으로 넘기기 · 펜 버튼 누르고 긋거나 손가락 길게 누르면 하이라이트'
            : COARSE_POINTER
              ? '글자를 잠깐 누른 뒤 그으면 하이라이트 · S펜은 바로 긋기'
              : '텍스트 드래그 → 하이라이트'}
        </span>
      </div>

      <div
        className={`pdf-scroll ${COARSE_POINTER ? 'touch-marking' : ''}`}
        ref={containerRef}
        onMouseUp={captureSelection}
        onTouchEnd={() => setTimeout(captureSelection, 50)}
        onClick={handleClick}
        onScroll={() => {
          anchorPort?.invalidate()
          scheduleDrawRange()
        }}
      >
        {Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage
            key={i}
            pdf={pdf}
            pageIndex={i}
            scale={scale}
            pageBox={pageBox}
            near={i >= drawRange.from && i <= drawRange.to}
            onHost={(el) => bindPageHost(i, el)}
            documentId={documentId}
            projectId={projectId}
            penEnabled={readerTool === 'pen'}
            penColor={penColor}
            scrollRef={containerRef}
            onMarkChange={handleMarkChange}
            onMarkCommit={handleMarkCommit}
            highlights={(highlights ?? []).filter((h) => h.pageIndex === i)}
            previewRects={preview?.pageIndex === i ? preview.rects : null}
            previewColor={highlightColor}
            activeHighlightId={activeHighlightId}
            onRendered={() => {
              anchorPort?.invalidate()
              // 옮겨 온 장이 그려졌으면 실제 크기에 맞춰 첫머리를 한 번 더 잡는다
              if (jumpTargetRef.current === i) {
                jumpTargetRef.current = null
                alignPage(i)
              }
              // 실제 크기가 자리표시보다 크거나 작았다면 그릴 구간도 달라진다
              scheduleDrawRange()
            }}
          />
        ))}
      </div>

      {selMenu && selection && (
        <div
          className="sel-menu"
          style={{ left: selMenu.x, top: selMenu.y }}
          onPointerDown={(e: ReactPointerEvent) => e.preventDefault()}
        >
          <button className="btn btn-primary btn-sm" onClick={() => void applyHighlight()}>
            하이라이트
            {workspaceId ? ' + 카드' : ''}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              window.getSelection()?.removeAllRanges()
              setSelection(null)
              setSelMenu(null)
            }}
          >
            취소
          </button>
        </div>
      )}

      {editing && (
        <HighlightEditMenu
          x={editing.x}
          y={editing.y}
          color={highlights?.find((h) => h.id === editing.id)?.color ?? 'yellow'}
          onPick={(c) => void updateHighlightColor(editing.id, c)}
          onDelete={() => {
            void deleteHighlight(editing.id)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PdfPage({
  pdf,
  pageIndex,
  scale,
  pageBox,
  near,
  onHost,
  highlights,
  documentId,
  projectId,
  penEnabled,
  penColor,
  scrollRef,
  onMarkChange,
  onMarkCommit,
  previewRects,
  previewColor,
  activeHighlightId,
  onRendered,
}: {
  pdf: PDFDocumentProxy
  pageIndex: number
  scale: number
  pageBox: { w: number; h: number } | null
  /** 화면 가까이 있어 그려 둘 페이지인지 */
  near: boolean
  onHost: (el: HTMLDivElement | null) => void
  highlights: Highlight[]
  documentId: string
  projectId: string
  penEnabled: boolean
  penColor: string
  scrollRef: RefObject<HTMLDivElement | null>
  onMarkChange: (range: Range | null) => void
  onMarkCommit: () => void
  previewRects: Rect[] | null
  previewColor: HighlightColor
  activeHighlightId: string | null
  onRendered: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let drawing: RenderTask | null = null
    let writing: TextLayer | null = null
    let opened: PDFPageProxy | null = null
    ;(async () => {
      const page = await pdf.getPage(pageIndex + 1)
      opened = page
      const viewport = page.getViewport({ scale })
      if (cancelled) return
      setSize({ w: viewport.width, h: viewport.height, scale })

      const canvas = canvasRef.current
      const textLayer = textRef.current
      if (!canvas || !textLayer) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // 화면 배율이 높은 기기에서 그림 한 장이 지나치게 커지지 않게 막는다
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      drawing = page.render({ canvasContext: ctx, viewport })
      try {
        await drawing.promise
      } catch {
        // 화면 밖으로 나가 그리기를 멈춘 경우
        return
      }
      if (cancelled) return

      const content = await page.getTextContent()
      if (cancelled) return

      /*
       * 글자를 짚는 투명한 층은 pdf.js 것을 그대로 쓴다.
       * 직접 깔면 글자가 그림보다 글꼴 높이의 20% 남짓 위에 놓여, 눈에 보이는 줄을 짚어도
       * 윗줄이 잡히곤 한다. pdf.js 는 화면 글꼴의 실제 윗선(ascent)을 재서 높이를 맞추고,
       * 원본 글꼴 종류(고딕·명조·고정폭)와 조각별 가로 배율까지 반영한다.
       */
      textLayer.replaceChildren()
      textLayer.style.setProperty('--scale-factor', String(scale))
      const words = new TextLayer({ textContentSource: content, container: textLayer, viewport })
      writing = words
      try {
        await words.render()
      } catch {
        // 화면 밖으로 나가 멈춘 경우
        return
      }
      onRenderedRef.current()
    })()
    return () => {
      cancelled = true
      drawing?.cancel()
      writing?.cancel()
      // 그림 자료를 쥔 채로 두면 긴 문서에서 메모리가 계속 쌓인다
      opened?.cleanup()
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [pdf, pageIndex, scale, near])

  // 배율을 바꾼 뒤에는 지난번에 잰 크기를 쓸 수 없으므로 첫 장 크기로 자리를 잡는다
  const measured = size?.scale === scale ? size : null
  const box = {
    width: measured?.w ?? (pageBox ? pageBox.w * scale : undefined),
    height: measured?.h ?? (pageBox ? pageBox.h * scale : undefined),
  }

  // 멀리 있는 페이지는 자리만 남긴다 — 그림을 들고 있으면 메모리가 계속 쌓인다
  if (!near) {
    return <div className="pdf-page" data-page={pageIndex} ref={onHost} style={box} />
  }

  return (
    <div className="pdf-page" data-page={pageIndex} ref={onHost} style={box}>
      <canvas ref={canvasRef} />
      <div className="hl-layer">
        {/* 한 하이라이트의 조각들은 한 겹으로 묶어 칠한다 — 이음매에서 색이 두 번 얹히지 않게 */}
        {highlights.map((h) => (
          <div
            key={h.id}
            className={groupClass(h.color)}
            style={{ opacity: groupOpacity(h.color, activeHighlightId === h.id) }}
          >
            {h.rects.map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className={`hl-rect ${isUnderlineColor(h.color) ? 'underline' : ''}`}
                data-highlight={h.id}
                style={{ ...rectStyle(r), ...paintStyle(h.color) }}
                title={h.text.slice(0, 120)}
              />
            ))}
          </div>
        ))}
        {previewRects?.length ? (
          <div
            className={groupClass(previewColor)}
            style={{ opacity: groupOpacity(previewColor, true) }}
          >
            {previewRects.map((r, i) => (
              <div
                key={`preview-${i}`}
                className={`hl-rect preview ${isUnderlineColor(previewColor) ? 'underline' : ''}`}
                style={{ ...rectStyle(r), ...paintStyle(previewColor) }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="text-layer" ref={textRef} />
      <PenOverlay
        documentId={documentId}
        projectId={projectId}
        pageIndex={pageIndex}
        enabled={penEnabled}
        color={penColor}
        scrollRef={scrollRef}
        onMarkChange={onMarkChange}
        onMarkCommit={onMarkCommit}
      />
    </div>
  )
}
