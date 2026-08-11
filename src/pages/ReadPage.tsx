import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { PdfViewer } from '@/components/PdfViewer'
import { EpubViewer } from '@/components/EpubViewer'
import { addNodeToWorkspace } from '@/lib/actions'
import './ReadPage.css'

export function ReadPage() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const navigate = useNavigate()

  const doc = useLiveQuery(
    () => (documentId ? db.documents.get(documentId) : undefined),
    [documentId],
  )
  const workspace = useLiveQuery(
    async () => {
      if (!projectId) return undefined
      const list = await db.workspaces.where('projectId').equals(projectId).toArray()
      return list[0]
    },
    [projectId],
  )
  const highlights = useLiveQuery(
    () =>
      documentId
        ? db.highlights.where('documentId').equals(documentId).reverse().sortBy('createdAt')
        : [],
    [documentId],
  )
  const nodes = useLiveQuery(
    () =>
      documentId ? db.nodes.where('documentId').equals(documentId).toArray() : [],
    [documentId],
  )

  if (!projectId || !documentId) return null
  if (doc === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!doc) return <div className="empty-state">문서를 찾을 수 없습니다</div>

  const nodeByHighlight = new Map((nodes ?? []).map((n) => [n.sourceHighlightId, n]))
  const format = doc.format ?? 'pdf'
  const isEpub = format === 'epub'

  return (
    <div className="read-page">
      <header className="read-header">
        <div className="read-nav">
          <Link to={`/project/${projectId}`} className="back-link">
            ← {doc.title}
          </Link>
        </div>
        <div className="read-actions">
          {workspace && (
            <Link className="btn btn-sm" to={`/project/${projectId}/workspace/${workspace.id}`}>
              워크스페이스
            </Link>
          )}
          <Link
            className="btn btn-sm"
            to={`/project/${projectId}/split/${documentId}/${workspace?.id ?? 'none'}`}
          >
            분할 보기
          </Link>
          <Link className="btn btn-sm" to={`/project/${projectId}/flashcards`}>
            플래시카드
          </Link>
          <Link className="btn btn-sm" to={`/project/${projectId}/bibliography`}>
            참고문헌
          </Link>
        </div>
      </header>

      <div className="read-body">
        <div className="read-pdf">
          {isEpub ? (
            <EpubViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={workspace?.id}
            />
          ) : (
            <PdfViewer
              documentId={documentId}
              projectId={projectId}
              workspaceId={workspace?.id}
            />
          )}
        </div>
        <aside className="read-sidebar">
          <h3>하이라이트</h3>
          {!highlights?.length ? (
            <p className="muted">텍스트를 드래그해 하이라이트하세요</p>
          ) : (
            <ul className="hl-list">
              {highlights.map((h) => {
                const node = nodeByHighlight.get(h.id)
                return (
                  <li key={h.id} className="hl-item">
                    <p>{h.text}</p>
                    <div className="hl-item-actions">
                      <span className="page-badge">
                        {isEpub ? `§${h.pageIndex + 1}` : `p.${h.pageIndex + 1}`}
                      </span>
                      {node && workspace && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            void addNodeToWorkspace(workspace.id, node.id).then(() =>
                              navigate(`/project/${projectId}/workspace/${workspace.id}`),
                            )
                          }
                        >
                          카드로
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
