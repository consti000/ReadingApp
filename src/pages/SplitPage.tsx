import { useCallback, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { PdfViewer } from '@/components/PdfViewer'
import { EpubViewer } from '@/components/EpubViewer'
import { PaneDivider } from '@/components/PaneDivider'
import { WorkspaceCanvas } from '@/components/WorkspaceCanvas'
import { clamp, useMediaQuery, usePaneSize } from '@/lib/panes'
import './SplitPage.css'

/** 문서 칸이 차지하는 비율 (0.5 = 반반) */
const SPLIT_DEFAULT = 0.5
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.8

export function SplitPage() {
  const navigate = useNavigate()
  const { projectId, documentId, workspaceId } = useParams<{
    projectId: string
    documentId: string
    workspaceId: string
  }>()

  const doc = useLiveQuery(
    () => (documentId ? db.documents.get(documentId) : undefined),
    [documentId],
  )
  const documents = useLiveQuery(
    () =>
      projectId
        ? db.documents.where('projectId').equals(projectId).toArray()
        : [],
    [projectId],
  )
  const workspaces = useLiveQuery(
    () =>
      projectId
        ? db.workspaces.where('projectId').equals(projectId).toArray()
        : [],
    [projectId],
  )

  const stacked = useMediaQuery('(max-width: 900px)')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio, commitRatio] = usePaneSize('split-doc', SPLIT_DEFAULT)
  const ratioRef = useRef(ratio)
  const dragBaseRef = useRef(ratio)

  const applyRatio = useCallback(
    (value: number) => {
      const next = clamp(value, SPLIT_MIN, SPLIT_MAX)
      ratioRef.current = next
      setRatio(next)
    },
    [setRatio],
  )

  /** 끈 거리(px)를 칸 비율로 바꾼다 */
  const ratioFromDelta = useCallback(
    (delta: number) => {
      const body = bodyRef.current
      const span = stacked ? body?.clientHeight ?? 0 : body?.clientWidth ?? 0
      if (span < 1) return dragBaseRef.current
      return dragBaseRef.current + delta / span
    },
    [stacked],
  )

  if (!projectId || !documentId) return null

  const wsId =
    workspaceId && workspaceId !== 'none'
      ? workspaceId
      : workspaces?.[0]?.id

  const isEpub = (doc?.format ?? 'pdf') === 'epub'

  return (
    <div className="split-page">
      <header className="split-header">
        <Link to={`/project/${projectId}`} className="back-link">
          ← 프로젝트
        </Link>
        <div className="split-selects">
          <label>
            문서
            <select
              className="input"
              value={documentId}
              onChange={(e) => {
                if (wsId) {
                  navigate(`/project/${projectId}/split/${e.target.value}/${wsId}`)
                }
              }}
            >
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          {doc && <span className="split-title">{doc.title}</span>}
        </div>
        <Link className="btn btn-sm" to={`/project/${projectId}/read/${documentId}`}>
          읽기만
        </Link>
      </header>

      <div
        className={`split-body${wsId ? '' : ' solo'}`}
        ref={bodyRef}
        style={
          wsId
            ? stacked
              ? { gridTemplateColumns: '1fr', gridTemplateRows: `${ratio}fr auto ${1 - ratio}fr` }
              : { gridTemplateColumns: `${ratio}fr auto ${1 - ratio}fr`, gridTemplateRows: '1fr' }
            : undefined
        }
      >
        <div className="split-pane">
          {isEpub ? (
            <EpubViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={wsId}
            />
          ) : (
            <PdfViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={wsId}
            />
          )}
        </div>
        {wsId && (
          <>
            <PaneDivider
              orientation={stacked ? 'horizontal' : 'vertical'}
              label="문서 칸 크기"
              onStart={() => {
                dragBaseRef.current = ratioRef.current
              }}
              onMove={(delta) => applyRatio(ratioFromDelta(delta))}
              onEnd={() => commitRatio(ratioRef.current)}
              onReset={() => {
                applyRatio(SPLIT_DEFAULT)
                commitRatio(ratioRef.current)
              }}
            />
            <div className="split-pane">
              <WorkspaceCanvas workspaceId={wsId} projectId={projectId} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
