import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { WorkspaceCanvas } from '@/components/WorkspaceCanvas'
import './WorkspacePage.css'

export function WorkspacePage() {
  const { projectId, workspaceId } = useParams<{
    projectId: string
    workspaceId: string
  }>()
  const navigate = useNavigate()

  const workspace = useLiveQuery(
    () => (workspaceId ? db.workspaces.get(workspaceId) : undefined),
    [workspaceId],
  )
  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const documents = useLiveQuery(
    () =>
      projectId
        ? db.documents.where('projectId').equals(projectId).toArray()
        : [],
    [projectId],
  )

  if (!projectId || !workspaceId) return null
  if (workspace === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!workspace) return <div className="empty-state">워크스페이스를 찾을 수 없습니다</div>

  return (
    <div className="workspace-page">
      <header className="ws-page-header">
        <div>
          <Link to={`/project/${projectId}`} className="back-link">
            ← {project?.name ?? '프로젝트'}
          </Link>
          <h1>{workspace.name}</h1>
        </div>
        <div className="ws-page-actions">
          {documents?.[0] && (
            <Link
              className="btn btn-sm"
              to={`/project/${projectId}/split/${documents[0].id}/${workspaceId}`}
            >
              문서와 나란히
            </Link>
          )}
        </div>
      </header>
      <WorkspaceCanvas
        workspaceId={workspaceId}
        projectId={projectId}
        onOpenDocument={(documentId) => {
          navigate(`/project/${projectId}/split/${documentId}/${workspaceId}`)
        }}
      />
    </div>
  )
}
