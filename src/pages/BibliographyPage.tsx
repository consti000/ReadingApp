import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import {
  formatCitation,
  importBibliography,
  type CitationStyle,
} from '@/lib/bibtex'
import './BibliographyPage.css'

export function BibliographyPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const fileRef = useRef<HTMLInputElement>(null)
  const [style, setStyle] = useState<CitationStyle>('apa')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const entries = useLiveQuery(
    () =>
      projectId
        ? db.bibliography.where('projectId').equals(projectId).sortBy('citeKey')
        : [],
    [projectId],
  )
  const documents = useLiveQuery(
    () => (projectId ? db.documents.where('projectId').equals(projectId).toArray() : []),
    [projectId],
  )

  if (!projectId) return null
  if (project === undefined) return <div className="empty-state">불러오는 중…</div>
  if (!project) return <div className="empty-state">프로젝트를 찾을 수 없습니다</div>

  return (
    <div className="bib-page">
      <header className="bib-head">
        <div>
          <Link to={`/project/${projectId}`} className="back-link">
            ← {project.name}
          </Link>
          <h1>참고문헌</h1>
          <p className="meta">BibTeX / CSL-JSON 불러오기 · 인용 포맷 생성</p>
        </div>
        <div className="bib-actions">
          <select
            className="input"
            value={style}
            onChange={(e) => setStyle(e.target.value as CitationStyle)}
          >
            <option value="apa">APA</option>
            <option value="mla">MLA</option>
            <option value="chicago">Chicago</option>
          </select>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            파일 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".bib,.json,application/json,text/plain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setBusy(true)
              try {
                const n = await importBibliography(projectId, file)
                setToast(`${n}개 항목 추가 (중복은 갱신)`)
              } catch (err) {
                setToast(err instanceof Error ? err.message : '불러오기 실패')
              } finally {
                setBusy(false)
                setTimeout(() => setToast(null), 3000)
              }
            }}
          />
        </div>
      </header>

      <div className="bib-body">
        {!entries?.length ? (
          <div className="empty-state">
            Zotero 등에서보낸 .bib 또는 CSL-JSON을 불러오세요
          </div>
        ) : (
          <ul className="bib-list">
            {entries.map((e) => {
              const citation = formatCitation(e, style)
              return (
                <li key={e.id} className="bib-item">
                  <div className="bib-item-head">
                    <code className="cite-key">{e.citeKey}</code>
                    <span className="bib-type">{e.entryType}</span>
                  </div>
                  <p className="bib-title">{e.title}</p>
                  <p className="bib-authors">
                    {e.authors.join('; ') || '저자 미상'}
                    {e.year ? ` · ${e.year}` : ''}
                  </p>
                  <p className="bib-citation">{citation}</p>
                  <div className="bib-item-actions">
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(citation)
                        setCopied(e.id)
                        setTimeout(() => setCopied(null), 1500)
                      }}
                    >
                      {copied === e.id ? '복사됨' : '인용 복사'}
                    </button>
                    <select
                      className="input input-sm"
                      defaultValue=""
                      onChange={async (ev) => {
                        const docId = ev.target.value
                        if (!docId) return
                        await db.documents.update(docId, { citeKey: e.citeKey })
                        setToast(`문서에 ${e.citeKey} 연결`)
                        setTimeout(() => setToast(null), 2000)
                        ev.target.value = ''
                      }}
                    >
                      <option value="">문서에 연결…</option>
                      {(documents ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                          {d.citeKey === e.citeKey ? ' ✓' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
