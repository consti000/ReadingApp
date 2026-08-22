import JSZip from 'jszip'
import { v4 as uuid } from 'uuid'
import { db, TABLES } from '@/lib/db'
import { wipeProjectContents } from '@/lib/actions'
import { beginSave, finishSave } from '@/lib/download'
import {
  documentOpfsPath,
  extForFormat,
  loadDocument,
  writeAllDocuments,
  clearAllDocuments,
} from '@/lib/opfs'
import type { DocumentFormat, Project } from '@/types'

const META_VERSION = 3

type Dump = Record<string, unknown[]>
type Row = Record<string, unknown>

function rowsOf(data: Dump, key: string): Row[] {
  const rows = data[key]
  return Array.isArray(rows) ? (rows as Row[]) : []
}

function sameTitle(a: string, b: string) {
  return a.trim() === b.trim()
}

function fileSafeName(name: string) {
  const s = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 40)
  return s || 'project'
}

function remapId(map: Map<string, string>, id: unknown): string {
  if (typeof id !== 'string' || !id) return uuid()
  const had = map.get(id)
  if (had) return had
  const next = uuid()
  map.set(id, next)
  return next
}

function remapOptional(map: Map<string, string>, id: unknown): string | null {
  if (id == null || id === '') return null
  return remapId(map, id)
}

/** 백업 ZIP 안의 한 프로젝트만 골라 낸다 */
function sliceProject(data: Dump, projectId: string): Dump {
  const projects = rowsOf(data, 'projects').filter((p) => p.id === projectId)
  const documents = rowsOf(data, 'documents').filter((d) => d.projectId === projectId)
  const highlights = rowsOf(data, 'highlights').filter((h) => h.projectId === projectId)
  const nodes = rowsOf(data, 'nodes').filter((n) => n.projectId === projectId)
  const workspaces = rowsOf(data, 'workspaces').filter((w) => w.projectId === projectId)
  const wsIds = new Set(workspaces.map((w) => w.id as string))
  const cardPlacements = rowsOf(data, 'cardPlacements').filter((c) =>
    wsIds.has(c.workspaceId as string),
  )
  const inkLinks = rowsOf(data, 'inkLinks').filter((l) => wsIds.has(l.workspaceId as string))
  const mindMaps = rowsOf(data, 'mindMaps').filter((m) => m.projectId === projectId)
  const mmIds = new Set(mindMaps.map((m) => m.id as string))
  const mindMapNodes = rowsOf(data, 'mindMapNodes').filter((n) => mmIds.has(n.mindMapId as string))
  const flashcardDecks = rowsOf(data, 'flashcardDecks').filter((d) => d.projectId === projectId)
  const flashcards = rowsOf(data, 'flashcards').filter((f) => f.projectId === projectId)
  const bibliography = rowsOf(data, 'bibliography').filter((b) => b.projectId === projectId)
  const bookmarks = rowsOf(data, 'bookmarks').filter((b) => b.projectId === projectId)
  const penStrokes = rowsOf(data, 'penStrokes').filter((s) => s.projectId === projectId)
  return {
    projects,
    documents,
    highlights,
    nodes,
    workspaces,
    cardPlacements,
    inkLinks,
    mindMaps,
    mindMapNodes,
    flashcardDecks,
    flashcards,
    bibliography,
    bookmarks,
    penStrokes,
  }
}

/** 지금 기기의 한 프로젝트만 모은다 */
async function collectProject(projectId: string): Promise<Dump> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다')
  const workspaces = await db.workspaces.where('projectId').equals(projectId).toArray()
  const mindMaps = await db.mindMaps.where('projectId').equals(projectId).toArray()
  const cardPlacements = (
    await Promise.all(
      workspaces.map((w) => db.cardPlacements.where('workspaceId').equals(w.id).toArray()),
    )
  ).flat()
  const inkLinks = (
    await Promise.all(workspaces.map((w) => db.inkLinks.where('workspaceId').equals(w.id).toArray()))
  ).flat()
  const mindMapNodes = (
    await Promise.all(mindMaps.map((m) => db.mindMapNodes.where('mindMapId').equals(m.id).toArray()))
  ).flat()
  return {
    projects: [project],
    documents: await db.documents.where('projectId').equals(projectId).toArray(),
    highlights: await db.highlights.where('projectId').equals(projectId).toArray(),
    nodes: await db.nodes.where('projectId').equals(projectId).toArray(),
    workspaces,
    cardPlacements,
    inkLinks,
    mindMaps,
    mindMapNodes,
    flashcardDecks: await db.flashcardDecks.where('projectId').equals(projectId).toArray(),
    flashcards: await db.flashcards.where('projectId').equals(projectId).toArray(),
    bibliography: await db.bibliography.where('projectId').equals(projectId).toArray(),
    bookmarks: await db.bookmarks.where('projectId').equals(projectId).toArray(),
    penStrokes: await db.penStrokes.where('projectId').equals(projectId).toArray(),
  }
}

function zipDump(data: Dump, extraMeta: Record<string, unknown>, files: Map<string, { blob: Blob; filename: string }>) {
  const zip = new JSZip()
  zip.file(
    'meta.json',
    JSON.stringify(
      { version: META_VERSION, exportedAt: Date.now(), app: 'readlink', ...extraMeta },
      null,
      2,
    ),
    { compression: 'DEFLATE' },
  )
  zip.file('db.json', JSON.stringify(data), { compression: 'DEFLATE' })
  const folder = zip.folder('documents')
  if (folder) {
    for (const [, { blob, filename }] of files) {
      folder.file(filename, blob, { compression: 'STORE' })
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function exportBackup(projectId: string): Promise<Blob> {
  const data = await collectProject(projectId)
  const documents = rowsOf(data, 'documents')
  const files = new Map<string, { blob: Blob; filename: string }>()
  for (const doc of documents) {
    const id = String(doc.id)
    const format = (doc.format as DocumentFormat | undefined) ?? 'pdf'
    const blob = await loadDocument(id, format)
    if (!blob) continue
    files.set(id, { blob, filename: `${id}.${extForFormat(format)}` })
  }
  const name = String(rowsOf(data, 'projects')[0]?.name ?? '')
  return zipDump(data, { scope: 'project', projectName: name }, files)
}

export async function downloadBackup(projectId: string, projectName: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const filename = `readlink-${fileSafeName(projectName)}-${date}.zip`
  // ZIP 을 만들기 전에 저장 자리를 잡는다. 오래 걸리면 클릭 제스처가 사라져
  // 저장 대화상자가 막히고, 예전처럼 끊긴 다운로드만 남을 수 있다.
  const session = await beginSave(filename, {
    description: 'ReadLink 백업',
    accept: { 'application/zip': ['.zip'] },
  })
  const blob = await exportBackup(projectId)
  await finishSave(session, blob)
}

/**
 * 다른 프로젝트의 아이디와 겹치지 않게 새로 붙인다.
 * 같은 이름 프로젝트를 갱신할 때는 그 칸의 아이디만 그대로 둔다.
 */
function remapProjectDump(dump: Dump, keepProjectId?: string): { dump: Dump; idMap: Map<string, string> } {
  const map = new Map<string, string>()
  const oldProject = rowsOf(dump, 'projects')[0]
  if (!oldProject?.id || typeof oldProject.id !== 'string') {
    throw new Error('백업에 프로젝트가 없습니다')
  }
  const projectId = keepProjectId ?? uuid()
  map.set(oldProject.id, projectId)
  const now = Date.now()

  const projects = [
    {
      ...oldProject,
      id: projectId,
      updatedAt: now,
    },
  ]

  const documents = rowsOf(dump, 'documents').map((d) => {
    const id = remapId(map, d.id)
    const format = (d.format as DocumentFormat | undefined) ?? 'pdf'
    return { ...d, id, projectId, opfsPath: documentOpfsPath(id, format) }
  })
  const highlights = rowsOf(dump, 'highlights').map((h) => ({
    ...h,
    id: remapId(map, h.id),
    documentId: remapId(map, h.documentId),
    projectId,
  }))
  const nodes = rowsOf(dump, 'nodes').map((n) => ({
    ...n,
    id: remapId(map, n.id),
    documentId: remapId(map, n.documentId),
    sourceHighlightId: remapId(map, n.sourceHighlightId),
    projectId,
  }))
  const workspaces = rowsOf(dump, 'workspaces').map((w) => ({
    ...w,
    id: remapId(map, w.id),
    projectId,
  }))
  const cardPlacements = rowsOf(dump, 'cardPlacements').map((c) => ({
    ...c,
    id: remapId(map, c.id),
    workspaceId: remapId(map, c.workspaceId),
    nodeId: remapId(map, c.nodeId),
  }))
  const inkLinks = rowsOf(dump, 'inkLinks').map((l) => ({
    ...l,
    id: remapId(map, l.id),
    workspaceId: remapId(map, l.workspaceId),
    fromNodeId: remapId(map, l.fromNodeId),
    toNodeId: remapId(map, l.toNodeId),
  }))
  const mindMaps = rowsOf(dump, 'mindMaps').map((m) => ({
    ...m,
    id: remapId(map, m.id),
    projectId,
  }))
  const mindMapNodes = rowsOf(dump, 'mindMapNodes').map((n) => ({
    ...n,
    id: remapId(map, n.id),
    mindMapId: remapId(map, n.mindMapId),
    nodeId: remapOptional(map, n.nodeId),
    parentId: remapOptional(map, n.parentId),
  }))
  const flashcardDecks = rowsOf(dump, 'flashcardDecks').map((d) => ({
    ...d,
    id: remapId(map, d.id),
    projectId,
  }))
  const flashcards = rowsOf(dump, 'flashcards').map((f) => ({
    ...f,
    id: remapId(map, f.id),
    deckId: remapId(map, f.deckId),
    nodeId: remapId(map, f.nodeId),
    projectId,
  }))
  const bibliography = rowsOf(dump, 'bibliography').map((b) => ({
    ...b,
    id: remapId(map, b.id),
    projectId,
  }))
  const bookmarks = rowsOf(dump, 'bookmarks').map((b) => ({
    ...b,
    id: remapId(map, b.id),
    documentId: remapId(map, b.documentId),
    projectId,
  }))
  const penStrokes = rowsOf(dump, 'penStrokes').map((s) => ({
    ...s,
    id: remapId(map, s.id),
    documentId: remapId(map, s.documentId),
    projectId,
  }))

  return {
    idMap: map,
    dump: {
      projects,
      documents,
      highlights,
      nodes,
      workspaces,
      cardPlacements,
      inkLinks,
      mindMaps,
      mindMapNodes,
      flashcardDecks,
      flashcards,
      bibliography,
      bookmarks,
      penStrokes,
    },
  }
}

async function insertDump(dump: Dump) {
  await db.transaction(
    'rw',
    TABLES.map((t) => db.table(t)),
    async () => {
      for (const t of TABLES) {
        const rows = dump[t]
        if (rows?.length) await db.table(t).bulkAdd(rows)
      }
    },
  )
}

export async function importBackup(file: File): Promise<{
  added: number
  updated: number
  documents: number
  projects: number
}> {
  const zip = await JSZip.loadAsync(file)
  const dbFile = zip.file('db.json')
  if (!dbFile) throw new Error('유효한 ReadLink 백업이 아닙니다 (db.json 없음)')

  const data = JSON.parse(await dbFile.async('string')) as Dump
  const backupProjects = rowsOf(data, 'projects')
  if (!backupProjects.length) throw new Error('백업에 프로젝트가 없습니다')

  const fileByOldId = new Map<string, { blob: Blob; filename: string }>()
  const tasks: Promise<void>[] = []
  zip.forEach((relativePath, entry) => {
    if (
      relativePath.startsWith('documents/') &&
      !entry.dir &&
      (relativePath.endsWith('.pdf') || relativePath.endsWith('.epub'))
    ) {
      const filename = relativePath.replace(/^documents\//, '')
      const id = filename.replace(/\.(pdf|epub)$/i, '')
      tasks.push(
        entry.async('blob').then((blob) => {
          fileByOldId.set(id, { blob, filename })
        }),
      )
    }
  })
  await Promise.all(tasks)

  const locals = await db.projects.toArray()
  let added = 0
  let updated = 0
  let documents = 0

  for (const raw of backupProjects) {
    const oldId = String(raw.id ?? '')
    const name = String(raw.name ?? '')
    const sliced = sliceProject(data, oldId)
    const match = locals
      .filter((p) => sameTitle(p.name, name))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]

    const { dump, idMap } = remapProjectDump(sliced, match?.id)
    const files = new Map<string, { blob: Blob; filename: string }>()
    for (const doc of rowsOf(sliced, 'documents')) {
      const oldId = String(doc.id)
      const newId = idMap.get(oldId)
      const packed = fileByOldId.get(oldId)
      if (!newId || !packed) continue
      const format = (doc.format as DocumentFormat | undefined) ?? 'pdf'
      files.set(newId, { blob: packed.blob, filename: `${newId}.${extForFormat(format)}` })
    }
    const newDocs = rowsOf(dump, 'documents')

    if (match) {
      await wipeProjectContents(match.id)
      const incoming = dump.projects[0] as unknown as Project
      await db.projects.update(match.id, {
        description: incoming.description,
        color: incoming.color,
        updatedAt: Date.now(),
      })
      dump.projects = []
      updated += 1
      match.updatedAt = Date.now()
    } else {
      added += 1
      locals.push(dump.projects[0] as unknown as Project)
    }

    await insertDump(dump)
    await writeAllDocuments(files)
    documents += newDocs.length
  }

  return { added, updated, documents, projects: added + updated }
}

export async function wipeAllData(): Promise<void> {
  await clearAllDocuments()
  await db.delete()
  await db.open()
}
