import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '@/lib/db'
import { createProject, deleteProject } from '@/lib/actions'
import { downloadBackup, importBackup } from '@/lib/backup'
import { isSaveCanceled } from '@/lib/download'
import { estimateStorage } from '@/lib/opfs'
import type { Project } from '@/types'
import './LibraryPage.css'

export function LibraryPage() {
  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), [])
  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const [showNew, setShowNew] = useState(false)
  const [exportPick, setExportPick] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const docCount = (projectId: string) =>
    docs?.filter((d) => d.projectId === projectId).length ?? 0

  const refreshStorage = async () => {
    setStorage(await estimateStorage())
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await createProject(name.trim())
      setName('')
      setShowNew(false)
    } finally {
      setBusy(false)
    }
  }

  const runExport = async (project: Project) => {
    setExportPick(false)
    setBusy(true)
    try {
      await downloadBackup(project.id, project.name)
      setToast(`「${project.name}」백업을 저장했습니다`)
    } catch (e) {
      if (isSaveCanceled(e)) return
      setToast(e instanceof Error ? e.message : '백업 실패')
    } finally {
      setBusy(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  const handleExport = () => {
    if (!projects?.length) {
      setToast('내보낼 프로젝트가 없습니다')
      setTimeout(() => setToast(null), 3000)
      return
    }
    if (projects.length === 1) {
      void runExport(projects[0])
      return
    }
    setExportPick(true)
  }

  const handleImport = async (file: File) => {
    if (
      !confirm(
        '같은 이름 프로젝트는 그 내용만 바꾸고, 없는 프로젝트는 새로 넣습니다. 다른 프로젝트는 그대로 둡니다. 계속할까요?',
      )
    )
      return
    setBusy(true)
    try {
      const r = await importBackup(file)
      const bits = [
        r.updated ? `갱신 ${r.updated}개` : '',
        r.added ? `추가 ${r.added}개` : '',
      ].filter(Boolean)
      setToast(`복원 완료: ${bits.join(', ') || '변화 없음'} (문서 ${r.documents}개)`)
      await refreshStorage()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '복원 실패')
    } finally {
      setBusy(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  return (
    <div className="library">
      <aside className="library-aside">
        <div className="library-hero">
          <p className="eyebrow">로컬 논문 리딩</p>
          <h1 className="library-title">ReadLink</h1>
          <p className="library-lead">
            하이라이트에서 워크스페이스 카드까지, 모든 발췌가 하나의 노드로 연결됩니다.
            데이터는 이 기기에만 저장됩니다.
          </p>
        </div>

        <div className="library-tools">
          <button className="btn btn-primary" onClick={() => setShowNew(true)} disabled={busy}>
            새 프로젝트
          </button>
          <button className="btn" onClick={handleExport} disabled={busy}>
            백업 내보내기
          </button>
          <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            백업 복원
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleImport(f)
                e.target.value = ''
              }}
            />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => void refreshStorage()}>
            저장 용량 확인
          </button>
          {storage && (
            <p className="storage-hint">
              {(storage.usage / 1024 / 1024).toFixed(1)} MB /{' '}
              {(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB
            </p>
          )}
        </div>
      </aside>

      <main className="library-main">
        {!projects?.length ? (
          <div className="empty-state">
            <h2>프로젝트를 만들어 시작하세요</h2>
            <p>PDF·EPUB을 올리고 하이라이트하면, 발췌가 워크스페이스 카드로 바로 이어집니다.</p>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              첫 프로젝트 만들기
            </button>
          </div>
        ) : (
          <ul className="project-grid">
            {projects.map((p) => (
              <li key={p.id} className="project-card">
                <Link to={`/project/${p.id}`} className="project-card-link">
                  <span className="project-accent" style={{ background: p.color ?? '#c4a574' }} />
                  <h2>{p.name}</h2>
                  <p>
                    문서 {docCount(p.id)}개 ·{' '}
                    {new Date(p.updatedAt).toLocaleDateString('ko-KR')}
                  </p>
                </Link>
                <button
                  className="btn btn-ghost btn-sm project-delete"
                  title="삭제"
                  onClick={() => {
                    if (confirm(`「${p.name}」프로젝트를 삭제할까요?`)) void deleteProject(p.id)
                  }}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>새 프로젝트</h3>
            <input
              className="input"
              placeholder="예: 인지과학 세미나"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowNew(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void handleCreate()} disabled={busy}>
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {exportPick && (
        <div className="modal-backdrop" onClick={() => setExportPick(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>내보낼 프로젝트</h3>
            <p className="export-pick-hint">선택한 프로젝트만 ZIP 으로 저장합니다.</p>
            <ul className="export-pick-list">
              {(projects ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    className="btn export-pick-item"
                    disabled={busy}
                    onClick={() => void runExport(p)}
                  >
                    <span>{p.name}</span>
                    <span className="export-pick-meta">문서 {docCount(p.id)}개</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setExportPick(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
