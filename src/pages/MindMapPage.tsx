import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { MindMapCanvas } from '@/components/MindMapCanvas'
import {
  autoBuildMindMap,
  createMindMap,
  ensureDefaultMindMap,
  exportMindMapOpml,
} from '@/lib/mindmap'
import './MindMapPage.css'

export function MindMapPage() {
  const { projectId, mindMapId } = useParams<{ projectId: string; mindMapId: string }>()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const mindMap = useLiveQuery(
    () => (mindMapId ? db.mindMaps.get(mindMapId) : undefined),
    [mindMapId],
  )
  const maps = useLiveQuery(
    () => (projectId ? db.mindMaps.where('projectId').equals(projectId).toArray() : []),
    [projectId],
  )

  if (!projectId || !mindMapId) return null
  if (mindMap === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!mindMap) return <div className="empty-state">마인드맵을 찾을 수 없습니다</div>

  return (
    <div className="mm-page">
      <header className="mm-page-head">
        <div>
          <Link to={`/project/${projectId}`} className="back-link">
            ← 프로젝트
          </Link>
          <h1>{mindMap.name}</h1>
        </div>
        <div className="mm-page-actions">
          <select
            className="input"
            value={mindMapId}
            onChange={(e) => navigate(`/project/${projectId}/mindmap/${e.target.value}`)}
          >
            {(maps ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              const name = prompt('마인드맵 이름', '새 마인드맵')
              if (!name?.trim()) return
              const id = await createMindMap(projectId, name.trim())
              navigate(`/project/${projectId}/mindmap/${id}`)
            }}
          >
            새 맵
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await autoBuildMindMap(mindMapId, projectId)
                setToast(`자동 생성 완료 (${n}개 노드)`)
              } finally {
                setBusy(false)
                setTimeout(() => setToast(null), 2500)
              }
            }}
          >
            문서·발췌로 자동 생성
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const blob = await exportMindMapOpml(mindMapId)
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${mindMap.name}.opml`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            OPML 내보내기
          </button>
        </div>
      </header>
      <div className="mm-page-body">
        <MindMapCanvas
          mindMapId={mindMapId}
          projectId={projectId}
          onOpenDocument={(docId) => navigate(`/project/${projectId}/read/${docId}`)}
        />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export async function openOrCreateMindMap(projectId: string): Promise<string> {
  return ensureDefaultMindMap(projectId)
}
