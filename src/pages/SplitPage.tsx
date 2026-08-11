import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { PdfViewer } from '@/components/PdfViewer'
import { EpubViewer } from '@/components/EpubViewer'
import { WorkspaceCanvas } from '@/components/WorkspaceCanvas'
import './SplitPage.css'

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

      <div className="split-body">
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
          <div className="split-pane">
            <WorkspaceCanvas workspaceId={wsId} projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  )
}
