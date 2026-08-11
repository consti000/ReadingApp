import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Contents, type NavItem, type Rendition } from 'epubjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { loadDocument } from '@/lib/opfs'
import { createHighlight, addNodeToWorkspace } from '@/lib/actions'
import { useUiStore } from '@/store/uiStore'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '@/types'
import './EpubViewer.css'

interface Props {
  documentId: string
  projectId: string
  workspaceId?: string
}

interface SelectionPayload {
  cfi: string
  text: string
  pageIndex: number
}

interface EpubDisplayed {
  index?: number
  cfi?: string
  displayed?: { page?: number; total?: number }
}

/** epubjs 타입 정의가 실제 relocated 페이로드와 달라 최소 형태로 좁혀 사용 */
interface EpubLocation {
  start?: EpubDisplayed
  end?: EpubDisplayed
  /** epubjs 기준: 첫/마지막 "섹션"에 있으면 true (페이지 경계가 아님) */
  atStart?: boolean
  atEnd?: boolean
}

const HL_CLASS = 'readlink-hl'

/** 탭/스와이프 판정 기준 — 드래그(텍스트 선택)와 구분하기 위한 값 */
const TAP_MAX_MOVE_PX = 10
const TAP_MAX_MS = 400
const SWIPE_MIN_PX = 60

/** 좌우 가장자리 탭 영역 폭 */
function edgeZoneWidth(viewportWidth: number): number {
  return viewportWidth < 640
    ? Math.min(72, viewportWidth * 0.18)
    : Math.min(88, viewportWidth * 0.12)
}

async function readLocation(rendition: Rendition): Promise<EpubLocation | null> {
  try {
    const loc = rendition.currentLocation() as unknown as
      | EpubLocation
      | Promise<EpubLocation>
    return await Promise.resolve(loc)
  } catch {
    return null
  }
}

async function waitForSize(el: HTMLElement, timeoutMs = 3000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (el.clientWidth < 1 || el.clientHeight < 1) {
    if (performance.now() > deadline) return
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
}

export function EpubViewer({ documentId, projectId, workspaceId }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const highlightsRef = useRef<Highlight[]>([])
  /** 이미 rendition에 붙인 하이라이트: cfi → color */
  const appliedRef = useRef<Map<string, HighlightColor>>(new Map())
  const initTokenRef = useRef(0)
  const fontScaleRef = useRef(100)
  const selectionRef = useRef<SelectionPayload | null>(null)

  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<NavItem[]>([])
  const [locationLabel, setLocationLabel] = useState('')
  const [progress, setProgress] = useState(0)
  const [atStart, setAtStart] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [selection, setSelection] = useState<SelectionPayload | null>(null)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null)
  const [fontScale, setFontScale] = useState(100)

  const highlightColor = useUiStore((s) => s.highlightColor)
  const setHighlightColor = useUiStore((s) => s.setHighlightColor)
  const pendingJump = useUiStore((s) => s.pendingJump)
  const setPendingJump = useUiStore((s) => s.setPendingJump)

  const highlights = useLiveQuery(
    () => db.highlights.where('documentId').equals(documentId).toArray(),
    [documentId],
  )

  fontScaleRef.current = fontScale
  selectionRef.current = selection

  /*
   * epubjs 의 displayed.total 은 마지막 섹션에서 한 페이지 더 많게 나오는 경우가 있어
   * atEnd 플래그만으로는 끝을 알 수 없다. 이동 후 위치가 그대로면 경계로 판단한다.
   */
  const goPrev = useCallback(async () => {
    const rendition = renditionRef.current
    if (!rendition) return
    const before = (await readLocation(rendition))?.start?.cfi
    await rendition.prev()
    const after = (await readLocation(rendition))?.start?.cfi
    if (before && after && before === after) setAtStart(true)
  }, [])

  const goNext = useCallback(async () => {
    const rendition = renditionRef.current
    if (!rendition) return
    const before = (await readLocation(rendition))?.start?.cfi
    await rendition.next()
    const after = (await readLocation(rendition))?.start?.cfi
    if (before && after && before === after) setAtEnd(true)
  }, [])

  const clearFrameSelection = useCallback(() => {
    try {
      const contents = renditionRef.current?.getContents()
      const list = (
        Array.isArray(contents) ? contents : contents ? [contents] : []
      ) as Contents[]
      for (const c of list) c.window?.getSelection()?.removeAllRanges()
    } catch {
      // ignore
    }
  }, [])

  /*
   * 페이지 넘김 제스처를 본문 문서 안에서 직접 처리한다.
   * 본문 위에 겹친 버튼으로 처리하면 그 영역에서 드래그를 시작할 수 없어
   * 가장자리 근처의 텍스트를 하이라이트할 수 없다.
   */
  const bindContentGestures = useCallback(
    (doc: Document) => {
      doc.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') void goNext()
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') void goPrev()
      })

      let from: { x: number; y: number; at: number; pointerId: number } | null = null

      doc.addEventListener('pointerdown', (e: PointerEvent) => {
        from =
          e.isPrimary && e.button === 0
            ? { x: e.clientX, y: e.clientY, at: performance.now(), pointerId: e.pointerId }
            : null
      })

      doc.addEventListener('pointercancel', () => {
        from = null
      })

      doc.addEventListener('pointerup', (e: PointerEvent) => {
        const origin = from
        from = null
        if (!origin || e.pointerId !== origin.pointerId) return

        // 본문 내부 링크는 epubjs 가 처리하도록 둔다
        if ((e.target as Element | null)?.closest?.('a')) return

        // 드래그로 텍스트를 선택했다면 페이지를 넘기지 않는다
        const selected = doc.defaultView?.getSelection()
        if (selected && !selected.isCollapsed && selected.toString().trim()) return

        const dx = e.clientX - origin.x
        const dy = e.clientY - origin.y

        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) void goNext()
          else void goPrev()
          return
        }

        const moved = Math.hypot(dx, dy)
        if (moved > TAP_MAX_MOVE_PX || performance.now() - origin.at > TAP_MAX_MS) return

        // 하이라이트 메뉴가 열려 있으면 첫 탭은 메뉴만 닫는다
        if (selectionRef.current) {
          setSelection(null)
          setSelMenu(null)
          return
        }

        /*
         * 페이지 방식에서 iframe 은 전체 컬럼을 담을 만큼 넓고 좌우로 스크롤되므로
         * iframe 기준 clientX 를 화면에 보이는 위치로 환산해야 한다.
         */
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        const mount = viewerRef.current
        if (!frame || !mount) return
        const mountRect = mount.getBoundingClientRect()
        if (mountRect.width < 1) return

        const visibleX = frame.getBoundingClientRect().left + e.clientX - mountRect.left
        const zone = edgeZoneWidth(mountRect.width)
        if (visibleX <= zone) void goPrev()
        else if (visibleX >= mountRect.width - zone) void goNext()
      })
    },
    [goNext, goPrev],
  )

  /** DB 상태와 rendition 주석을 동기화 (추가/삭제/색상 변경 반영) */
  const syncAnnotations = useCallback(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    const wanted = new Map<string, HighlightColor>()
    for (const h of highlightsRef.current) {
      if (h.cfi) wanted.set(h.cfi, h.color)
    }

    for (const [cfi, color] of [...appliedRef.current]) {
      if (wanted.get(cfi) === color) continue
      try {
        rendition.annotations.remove(cfi, 'highlight')
      } catch {
        // 이미 사라진 주석
      }
      appliedRef.current.delete(cfi)
    }

    for (const h of highlightsRef.current) {
      if (!h.cfi || appliedRef.current.has(h.cfi)) continue
      try {
        rendition.annotations.highlight(h.cfi, { id: h.id }, undefined, HL_CLASS, {
          fill: HIGHLIGHT_COLORS[h.color],
          'fill-opacity': '0.4',
        })
        appliedRef.current.set(h.cfi, h.color)
      } catch {
        // 잘못된 CFI는 건너뜀
      }
    }
  }, [])

  const updateLocation = useCallback((loc: EpubLocation | null | undefined) => {
    if (!loc?.start) return

    // atStart/atEnd 는 "첫/마지막 섹션" 표시라서 섹션 내 페이지 위치까지 함께 봐야 한다
    const startPage = loc.start.displayed?.page ?? 1
    const endPage = loc.end?.displayed?.page ?? startPage
    const endTotal = loc.end?.displayed?.total ?? endPage
    setAtStart(Boolean(loc.atStart) && startPage <= 1)
    setAtEnd(Boolean(loc.atEnd) && endPage >= endTotal)

    const spineIndex = (loc.start.index ?? 0) + 1
    const cfi = loc.start.cfi
    const locations = bookRef.current?.locations as unknown as
      | {
          total?: number
          locationFromCfi?: (cfi: string) => number
          percentageFromCfi?: (cfi: string) => number
        }
      | undefined

    const total = locations?.total ?? 0
    if (total > 0 && cfi) {
      try {
        const raw = Number(locations?.locationFromCfi?.(cfi) ?? 0) + 1
        const current = Math.min(total, Math.max(1, raw))
        const ratio = locations?.percentageFromCfi?.(cfi) ?? current / total
        setProgress(Math.min(100, Math.max(0, Math.round(ratio * 100))))
        setLocationLabel(`${current} / ${total}`)
        return
      } catch {
        // fall through to spine label
      }
    }

    setProgress(0)
    setLocationLabel(`섹션 ${spineIndex}`)
  }, [])

  const applyFontSize = useCallback(async (scale: number) => {
    const rendition = renditionRef.current
    if (!rendition) return

    let cfi: string | undefined
    try {
      const loc = rendition.currentLocation() as unknown as EpubLocation
      cfi = loc?.start?.cfi
    } catch {
      // ignore
    }

    // themes.fontSize()는 !important를 붙이지 않아 책 자체 CSS에 밀릴 수 있음
    rendition.themes.override('font-size', `${scale}%`, true)

    const mount = viewerRef.current
    if (mount && mount.clientWidth > 0 && mount.clientHeight > 0) {
      try {
        rendition.resize(mount.clientWidth, mount.clientHeight)
      } catch {
        // ignore
      }
    }

    if (cfi) {
      try {
        await rendition.display(cfi)
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    highlightsRef.current = highlights ?? []
    syncAnnotations()
  }, [highlights, syncAnnotations])

  useEffect(() => {
    const token = ++initTokenRef.current
    let disposed = false
    const alive = () => !disposed && initTokenRef.current === token

    let book: Book | null = null
    let rendition: Rendition | null = null
    let observer: ResizeObserver | null = null
    let rafId = 0
    const boundDocs = new WeakSet<Document>()

    const destroyLocal = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      observer?.disconnect()
      observer = null
      try {
        rendition?.destroy()
      } catch {
        // ignore
      }
      try {
        book?.destroy()
      } catch {
        // ignore
      }
    }

    setLoading(true)
    setReady(false)
    setError(null)
    setToc([])
    setProgress(0)
    setLocationLabel('')
    setAtStart(false)
    setAtEnd(false)
    appliedRef.current = new Map()

    void (async () => {
      try {
        const blob = await loadDocument(documentId, 'epub')
        if (!alive()) return destroyLocal()
        if (!blob) throw new Error('EPUB 파일을 찾을 수 없습니다 (OPFS)')

        const buf = await blob.arrayBuffer()
        if (!alive()) return destroyLocal()

        book = ePub(buf)
        await book.ready
        if (!alive()) return destroyLocal()

        const mount = viewerRef.current
        if (!mount) return destroyLocal()

        await waitForSize(mount)
        if (!alive()) return destroyLocal()

        // StrictMode 재실행 등으로 남은 이전 iframe 제거
        mount.replaceChildren()

        const width = Math.max(1, mount.clientWidth)
        const height = Math.max(1, mount.clientHeight)

        rendition = book.renderTo(mount, {
          width,
          height,
          flow: 'paginated',
          spread: 'none',
          allowScriptedContent: true,
        })

        rendition.themes.default({
          body: {
            'font-family': "'Source Sans 3', 'Segoe UI', sans-serif !important",
            'line-height': '1.7 !important',
            color: '#1a1a1a !important',
            background: '#f7f4ef !important',
            padding: '1.25rem 1.5rem !important',
          },
          a: { color: '#6b5428 !important' },
          'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
        })
        rendition.themes.override('font-size', `${fontScaleRef.current}%`, true)

        // display() 전에 등록해야 최초 위치(atStart/atEnd)를 놓치지 않음
        rendition.on('relocated', (loc: EpubLocation) => {
          if (!alive()) return
          updateLocation(loc)
          setSelection(null)
          setSelMenu(null)
        })

        rendition.on('selected', (cfiRange: string, contents: Contents) => {
          if (!alive()) return
          try {
            const range = contents.range(cfiRange)
            const text = range?.toString().trim() ?? ''
            if (!text) return

            const section = book?.spine?.get(cfiRange)
            const pageIndex = typeof section?.index === 'number' ? section.index : 0

            // range 좌표는 iframe 기준이므로 프레임 위치만큼 보정
            const frame = contents.document?.defaultView?.frameElement as HTMLElement | null
            const frameRect = frame?.getBoundingClientRect()
            const rect = range?.getBoundingClientRect()

            setSelection({ cfi: cfiRange, text, pageIndex })

            if (rect && frameRect) {
              const cx = frameRect.left + rect.left + rect.width / 2
              const cy = frameRect.top + rect.bottom + 10
              setSelMenu({
                x: Math.max(100, Math.min(window.innerWidth - 100, cx)),
                y: Math.max(60, Math.min(window.innerHeight - 60, cy)),
              })
            } else {
              setSelMenu({ x: window.innerWidth / 2, y: 140 })
            }
          } catch {
            // ignore
          }
        })

        // 새로 렌더된 본문마다 키보드·탭·스와이프 처리를 연결
        rendition.on('rendered', () => {
          if (!alive()) return
          try {
            const contents = renditionRef.current?.getContents()
            const list = (
              Array.isArray(contents) ? contents : contents ? [contents] : []
            ) as Contents[]
            for (const c of list) {
              const doc = c.document
              if (!doc || boundDocs.has(doc)) continue
              boundDocs.add(doc)
              bindContentGestures(doc)
            }
          } catch {
            // ignore
          }
        })

        bookRef.current = book
        renditionRef.current = rendition

        await rendition.display()
        if (!alive()) return destroyLocal()

        setLoading(false)
        setReady(true)
        syncAnnotations()
        updateLocation(rendition.currentLocation() as unknown as EpubLocation)

        let lastW = width
        let lastH = height
        observer = new ResizeObserver(() => {
          if (!alive()) return
          if (rafId) cancelAnimationFrame(rafId)
          rafId = requestAnimationFrame(() => {
            rafId = 0
            const el = viewerRef.current
            const r = renditionRef.current
            if (!el || !r) return
            const w = el.clientWidth
            const h = el.clientHeight
            if (w < 1 || h < 1) return
            if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return
            lastW = w
            lastH = h
            try {
              r.resize(w, h)
            } catch {
              // ignore
            }
          })
        })
        observer.observe(mount)

        const navigation = await book.loaded.navigation
        if (!alive()) return
        setToc(navigation.toc ?? [])

        // 페이지 수 계산 — 실패해도 섹션 기준으로 계속 동작
        try {
          await book.locations.generate(1600)
        } catch {
          // ignore
        }
        if (!alive()) return

        const spine = book.spine as unknown as { items?: unknown[]; length?: number }
        const spineLen = spine.items?.length ?? spine.length ?? 0
        const locTotal = (book.locations as unknown as { total?: number })?.total
        await db.documents.update(documentId, {
          pageCount: locTotal || spineLen || undefined,
        })
        if (!alive()) return

        updateLocation(rendition.currentLocation() as unknown as EpubLocation)
      } catch (e) {
        if (!alive()) return destroyLocal()
        setError(e instanceof Error ? e.message : 'EPUB 로드 실패')
        setLoading(false)
      }
    })()

    return () => {
      disposed = true
      destroyLocal()
      if (initTokenRef.current === token) {
        bookRef.current = null
        renditionRef.current = null
      }
    }
  }, [documentId, bindContentGestures, syncAnnotations, updateLocation])

  useEffect(() => {
    if (!ready) return
    void applyFontSize(fontScale)
  }, [fontScale, ready, applyFontSize])

  useEffect(() => {
    if (!pendingJump || pendingJump.documentId !== documentId || !highlights) return
    const target = highlights.find((x) => x.id === pendingJump.highlightId)
    setPendingJump(null)
    if (target?.cfi) void renditionRef.current?.display(target.cfi)
  }, [pendingJump, documentId, highlights, setPendingJump])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        void goNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        void goPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev])

  const applyHighlight = async () => {
    if (!selection) return
    const color = highlightColor
    const { nodeId } = await createHighlight({
      documentId,
      projectId,
      text: selection.text,
      color,
      rects: [],
      pageIndex: selection.pageIndex,
      cfi: selection.cfi,
    })
    if (workspaceId) {
      await addNodeToWorkspace(
        workspaceId,
        nodeId,
        60 + Math.random() * 120,
        60 + Math.random() * 80,
      )
    }
    clearFrameSelection()
    setSelection(null)
    setSelMenu(null)
    // 실제 렌더링은 highlights 구독 → syncAnnotations 에서 처리
  }

  return (
    <div className="epub-viewer">
      <div className="epub-toolbar">
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
          <button
            className="btn btn-sm"
            disabled={!ready}
            onClick={() => setFontScale((s) => Math.max(80, s - 10))}
          >
            A−
          </button>
          <span>{fontScale}%</span>
          <button
            className="btn btn-sm"
            disabled={!ready}
            onClick={() => setFontScale((s) => Math.min(180, s + 10))}
          >
            A+
          </button>
        </div>
        <div className="epub-nav">
          <button
            className="btn btn-sm"
            disabled={!ready || atStart}
            onClick={() => void goPrev()}
          >
            ← 이전 페이지
          </button>
          <span className="epub-loc">{locationLabel || 'EPUB'}</span>
          <button
            className="btn btn-sm"
            disabled={!ready || atEnd}
            onClick={() => void goNext()}
          >
            다음 페이지 →
          </button>
        </div>
        {toc.length > 0 && (
          <select
            className="input epub-toc"
            defaultValue=""
            onChange={(e) => {
              const href = e.target.value
              e.target.value = ''
              if (href) void renditionRef.current?.display(href)
            }}
          >
            <option value="">목차…</option>
            {flattenToc(toc).map((item) => (
              <option key={item.id} value={item.href}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <span className="epub-hint">←→ / 스와이프 / 좌우 가장자리 탭 · 드래그는 선택</span>
      </div>

      <div className="epub-progress" aria-hidden>
        <div className="epub-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {loading && <div className="epub-status">EPUB 불러오는 중…</div>}
      {error && <div className="epub-status error">{error}</div>}

      <div className="epub-stage">
        <div className="epub-frame" ref={viewerRef} />
      </div>

      {selMenu && selection && (
        <div className="sel-menu" style={{ left: selMenu.x, top: selMenu.y }}>
          <button className="btn btn-primary btn-sm" onClick={() => void applyHighlight()}>
            하이라이트{workspaceId ? ' + 카드' : ''}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              clearFrameSelection()
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

function flattenToc(
  items: NavItem[],
  depth = 0,
): { id: string; href: string; label: string }[] {
  const out: { id: string; href: string; label: string }[] = []
  items.forEach((item, i) => {
    const label = `${'— '.repeat(depth)}${item.label?.trim() ?? ''}`
    if (item.href) {
      out.push({ id: `${depth}-${i}-${item.href}`, href: item.href, label })
    }
    if (item.subitems?.length) {
      out.push(...flattenToc(item.subitems, depth + 1))
    }
  })
  return out
}
