import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfDocument, getPageTextBoxes } from '@/lib/pdf'
import { loadPdf } from '@/lib/opfs'
import { createHighlight, addNodeToWorkspace } from '@/lib/actions'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor, type Rect } from '@/types'
import './PdfViewer.css'

interface Props {
  documentId: string
  projectId: string
  workspaceId?: string
}

interface SelectionPayload {
  text: string
  pageIndex: number
  rects: Rect[]
}

export function PdfViewer({ documentId, projectId, workspaceId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [scale, setScale] = useState(1.15)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<SelectionPayload | null>(null)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null)

  const highlightColor = useUiStore((s) => s.highlightColor)
  const setHighlightColor = useUiStore((s) => s.setHighlightColor)
  const pendingJump = useUiStore((s) => s.pendingJump)
  const setPendingJump = useUiStore((s) => s.setPendingJump)

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
        const blob = await loadPdf(documentId)
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

  const captureSelection = useCallback(() => {
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
  }, [])

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
        <div className="zoom-row">
          <button className="btn btn-sm" onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}>
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button className="btn btn-sm" onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}>
            +
          </button>
        </div>
        <span className="pdf-hint">텍스트 드래그 → 하이라이트</span>
      </div>

      <div
        className="pdf-scroll"
        ref={containerRef}
        onMouseUp={captureSelection}
        onTouchEnd={() => setTimeout(captureSelection, 50)}
      >
        {Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage
            key={i}
            pdf={pdf}
            pageIndex={i}
            scale={scale}
            highlights={(highlights ?? []).filter((h) => h.pageIndex === i)}
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
    </div>
  )
}

function PdfPage({
  pdf,
  pageIndex,
  scale,
  highlights,
}: {
  pdf: PDFDocumentProxy
  pageIndex: number
  scale: number
  highlights: Highlight[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

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
              className="hl-rect"
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
      <div className="text-layer" ref={textRef} />
    </div>
  )
}
