import { useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { addDocument, deleteDocument, createWorkspace } from '@/lib/actions'
import './ProjectPage.css'

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const documents = useLiveQuery(
    () =>
      projectId
        ? db.documents.where('projectId').equals(projectId).reverse().sortBy('updatedAt')
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
  const highlightCount = useLiveQuery(
    () =>
      projectId
        ? db.highlights.where('projectId').equals(projectId).count()
        : 0,
    [projectId],
  )

  if (!projectId) return null
  if (project === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!project) return <div className="empty-state">프로젝트를 찾을 수 없습니다</div>

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      let lastId = ''
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.pdf')) continue
        lastId = await addDocument(projectId, file)
      }
      if (lastId) navigate(`/project/${projectId}/read/${lastId}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="project-page">
      <header className="project-head">
        <div>
          <Link to="/" className="back-link">
            ← 라이브러리
          </Link>
          <h1>{project.name}</h1>
          <p className="meta">
            문서 {documents?.length ?? 0} · 하이라이트 {highlightCount ?? 0}
          </p>
        </div>
        <div className="project-actions">
          <button
            className="btn btn-primary"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '업로드 중…' : 'PDF 추가'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => void handleUpload(e.target.files)}
          />
          {workspaces?.[0] && (
            <Link className="btn" to={`/project/${projectId}/workspace/${workspaces[0].id}`}>
              워크스페이스
            </Link>
          )}
        </div>
      </header>

      <section className="project-section">
        <div className="section-head">
          <h2>문서</h2>
        </div>
        {!documents?.length ? (
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void handleUpload(e.dataTransfer.files)
            }}
            onClick={() => fileRef.current?.click()}
          >
            <p>PDF를 끌어다 놓거나 클릭해서 추가</p>
          </div>
        ) : (
          <ul className="doc-list">
            {documents.map((d) => (
              <li key={d.id}>
                <Link to={`/project/${projectId}/read/${d.id}`} className="doc-item">
                  <span className="doc-icon">PDF</span>
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-date">
                    {new Date(d.updatedAt).toLocaleDateString('ko-KR')}
                  </span>
                </Link>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (confirm(`「${d.title}」을 삭제할까요?`)) void deleteDocument(d.id)
                  }}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-section">
        <div className="section-head">
          <h2>워크스페이스</h2>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const name = prompt('워크스페이스 이름', '새 워크스페이스')
              if (!name?.trim()) return
              const id = await createWorkspace(projectId, name.trim())
              navigate(`/project/${projectId}/workspace/${id}`)
            }}
          >
            추가
          </button>
        </div>
        <ul className="ws-list">
          {workspaces?.map((w) => (
            <li key={w.id}>
              <Link to={`/project/${projectId}/workspace/${w.id}`} className="ws-item">
                {w.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
