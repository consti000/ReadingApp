import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfDocument, getPageTextBoxes } from '@/lib/pdf'
import { loadDocument } from '@/lib/opfs'
import {
  createHighlight,
  addNodeToWorkspace,
  deleteLastPenStroke,
  updateHighlightColor,
  deleteHighlight,
} from '@/lib/actions'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useUiStore } from '@/store/uiStore'
import { PenOverlay } from '@/components/PenOverlay'
import { HighlightEditMenu } from '@/components/HighlightEditMenu'
import type { AnchorPort, HighlightAnchor } from '@/lib/highlightAnchors'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor, type Rect } from '@/types'
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

const PEN_COLORS = ['#e8c547', '#7dcea0', '#85c1e9', '#f5b7b1', '#1a2332']

export function PdfViewer({ documentId, projectId, workspaceId, anchorPort }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [scale, setScale] = useState(1.15)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<SelectionPayload | null>(null)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null)

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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const blob = await loadDocument(documentId, 'pdf')
        if (!blob) throw new Error('PDF 파일을 찾을 수 없습니다 (OPFS)')
        const buf = await blob.arrayBuffer()
        const doc = await loadPdfDocument(new Uint8Array(buf))
        if (!cancelled) {
          setPdf(doc)
          await db.documents.update(documentId, { pageCount: doc.numPages })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'PDF 로드 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId])

  useEffect(() => {
    if (!pendingJump || pendingJump.documentId !== documentId || !highlights) return
    const h = highlights.find((x) => x.id === pendingJump.highlightId)
    if (!h) return
    const el = containerRef.current?.querySelector(`[data-page="${h.pageIndex}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPendingJump(null)
  }, [pendingJump, documentId, highlights, setPendingJump])

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
      if (readerTool === 'pen') return
      // 드래그로 텍스트를 선택한 직후의 클릭은 선택 메뉴가 처리한다
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return

      const hit = hitTestHighlight(e.target as Element, e.clientX, e.clientY)
      setEditing(hit ? { id: hit.id, x: e.clientX, y: e.clientY + 16 } : null)
    },
    [hitTestHighlight, readerTool],
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

  const captureSelection = useCallback(() => {
    if (readerTool === 'pen') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null)
      setSelMenu(null)
      return
    }
    const range = sel.getRangeAt(0)
    const text = sel.toString().trim()
    if (!text) return

    const pageEl = (range.commonAncestorContainer as Element).parentElement?.closest(
      '[data-page]',
    ) as HTMLElement | null
    if (!pageEl) return
    const pageIndex = Number(pageEl.dataset.page)
    const pageRect = pageEl.getBoundingClientRect()
    const clientRects = Array.from(range.getClientRects())
    if (!clientRects.length) return

    const rects: Rect[] = clientRects.map((r) => ({
      pageIndex,
      left: (r.left - pageRect.left) / pageRect.width,
      top: (r.top - pageRect.top) / pageRect.height,
      width: r.width / pageRect.width,
      height: r.height / pageRect.height,
    }))

    const last = clientRects[clientRects.length - 1]
    setSelection({ text, pageIndex, rects })
    setSelMenu({ x: last.right, y: last.bottom + 8 })
  }, [readerTool])

  const applyHighlight = async () => {
    if (!selection) return
    const { highlightId, nodeId } = await createHighlight({
      documentId,
      projectId,
      text: selection.text,
      color: highlightColor,
      rects: selection.rects,
      pageIndex: selection.pageIndex,
    })
    if (workspaceId) {
      await addNodeToWorkspace(workspaceId, nodeId, 60 + Math.random() * 120, 60 + Math.random() * 80)
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    setSelMenu(null)
    void highlightId
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
          <div className="color-row">
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
              <button
                key={c}
                className={`color-dot ${highlightColor === c ? 'active' : ''}`}
                style={{ background: HIGHLIGHT_COLORS[c] }}
                title={c}
                onClick={() => setHighlightColor(c)}
              />
            ))}
          </div>
        ) : (
          <div className="color-row">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`color-dot ${penColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setPenColor(c)}
              />
            ))}
            <button
              className="btn btn-sm"
              onClick={() => void deleteLastPenStroke(documentId)}
            >
              필기 되돌리기
            </button>
          </div>
        )}
        <div className="zoom-row">
          <button className="btn btn-sm" onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}>
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button className="btn btn-sm" onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}>
            +
          </button>
        </div>
        <span className="pdf-hint">
          {readerTool === 'pen'
            ? 'S펜/스타일러스 압력 반영 · 손가락은 스크롤'
            : '텍스트 드래그 → 하이라이트'}
        </span>
      </div>

      <div
        className="pdf-scroll"
        ref={containerRef}
        onMouseUp={captureSelection}
        onTouchEnd={() => setTimeout(captureSelection, 50)}
        onClick={handleClick}
        onScroll={() => anchorPort?.invalidate()}
      >
        {Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage
            key={i}
            pdf={pdf}
            pageIndex={i}
            scale={scale}
            documentId={documentId}
            projectId={projectId}
            penEnabled={readerTool === 'pen'}
            penColor={penColor}
            highlights={(highlights ?? []).filter((h) => h.pageIndex === i)}
            activeHighlightId={activeHighlightId}
            onRendered={() => anchorPort?.invalidate()}
          />
        ))}
      </div>

      {selMenu && selection && readerTool === 'highlight' && (
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
  highlights,
  documentId,
  projectId,
  penEnabled,
  penColor,
  activeHighlightId,
  onRendered,
}: {
  pdf: PDFDocumentProxy
  pageIndex: number
  scale: number
  highlights: Highlight[]
  documentId: string
  projectId: string
  penEnabled: boolean
  penColor: string
  activeHighlightId: string | null
  onRendered: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale })
      if (cancelled) return
      setSize({ w: viewport.width, h: viewport.height })

      const canvas = canvasRef.current
      const textLayer = textRef.current
      if (!canvas || !textLayer) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      await page.render({ canvasContext: ctx, viewport }).promise

      const boxes = await getPageTextBoxes(page, scale)
      textLayer.innerHTML = ''
      textLayer.style.width = `${viewport.width}px`
      textLayer.style.height = `${viewport.height}px`
      for (const box of boxes) {
        const span = document.createElement('span')
        span.textContent = box.text
        span.style.left = `${box.left}px`
        span.style.top = `${box.top}px`
        span.style.fontSize = `${box.height}px`
        span.style.width = `${box.width}px`
        span.style.height = `${box.height}px`
        textLayer.appendChild(span)
      }
      onRenderedRef.current()
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, pageIndex, scale])

  return (
    <div
      className="pdf-page"
      data-page={pageIndex}
      style={{ width: size.w || undefined, height: size.h || undefined }}
    >
      <canvas ref={canvasRef} />
      <div className="hl-layer">
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className={`hl-rect ${activeHighlightId === h.id ? 'active' : ''}`}
              data-highlight={h.id}
              style={{
                left: `${r.left * 100}%`,
                top: `${r.top * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
                background: HIGHLIGHT_COLORS[h.color],
              }}
              title={h.text.slice(0, 120)}
            />
          )),
        )}
      </div>
      <div className="text-layer" ref={textRef} style={{ pointerEvents: penEnabled ? 'none' : undefined }} />
      <PenOverlay
        documentId={documentId}
        projectId={projectId}
        pageIndex={pageIndex}
        enabled={penEnabled}
        color={penColor}
      />
    </div>
  )
}
