/** OPFS — 원본 문서 파일 저장 (PDF/EPUB, PC/안드로이드 공통) */

import type { DocumentFormat } from '@/types'

const ROOT_DIR = 'readlink'
const DOCS_DIR = 'documents'

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

async function getRoot(): Promise<DirHandle> {
  const root = await navigator.storage.getDirectory()
  return (await root.getDirectoryHandle(ROOT_DIR, { create: true })) as DirHandle
}

async function getDocsDir(): Promise<DirHandle> {
  const root = await getRoot()
  return (await root.getDirectoryHandle(DOCS_DIR, { create: true })) as DirHandle
}

export function extForFormat(format: DocumentFormat): string {
  return format === 'epub' ? 'epub' : 'pdf'
}

export function documentOpfsPath(documentId: string, format: DocumentFormat = 'pdf'): string {
  return `${DOCS_DIR}/${documentId}.${extForFormat(format)}`
}

export async function saveDocument(
  documentId: string,
  file: File | Blob,
  format: DocumentFormat,
): Promise<string> {
  const docs = await getDocsDir()
  const name = `${documentId}.${extForFormat(format)}`
  const handle = await docs.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return documentOpfsPath(documentId, format)
}

/** @deprecated use saveDocument */
export async function savePdf(documentId: string, file: File | Blob): Promise<string> {
  return saveDocument(documentId, file, 'pdf')
}

export async function loadDocument(
  documentId: string,
  format: DocumentFormat = 'pdf',
): Promise<Blob | null> {
  const docs = await getDocsDir()
  const tryNames = [
    `${documentId}.${extForFormat(format)}`,
    `${documentId}.pdf`,
    `${documentId}.epub`,
  ]
  const unique = [...new Set(tryNames)]
  for (const name of unique) {
    try {
      const handle = await docs.getFileHandle(name)
      return await handle.getFile()
    } catch {
      // try next
    }
  }
  return null
}

/** @deprecated use loadDocument */
export async function loadPdf(documentId: string): Promise<Blob | null> {
  return loadDocument(documentId, 'pdf')
}

export async function deleteDocumentFile(
  documentId: string,
  format?: DocumentFormat,
): Promise<void> {
  const docs = await getDocsDir()
  const names = format
    ? [`${documentId}.${extForFormat(format)}`]
    : [`${documentId}.pdf`, `${documentId}.epub`]
  for (const name of names) {
    try {
      await docs.removeEntry(name)
    } catch {
      // ignore
    }
  }
}

/** @deprecated use deleteDocumentFile */
export async function deletePdf(documentId: string): Promise<void> {
  await deleteDocumentFile(documentId)
}

export async function readAllDocuments(): Promise<Map<string, { blob: Blob; filename: string }>> {
  const docs = await getDocsDir()
  const map = new Map<string, { blob: Blob; filename: string }>()
  for await (const [name, handle] of docs.entries()) {
    if (handle.kind !== 'file') continue
    if (!name.endsWith('.pdf') && !name.endsWith('.epub')) continue
    const file = await (handle as FileSystemFileHandle).getFile()
    const id = name.replace(/\.(pdf|epub)$/i, '')
    map.set(id, { blob: file, filename: name })
  }
  return map
}

/** @deprecated */
export async function readAllPdfs(): Promise<Map<string, Blob>> {
  const all = await readAllDocuments()
  const map = new Map<string, Blob>()
  for (const [id, { blob }] of all) map.set(id, blob)
  return map
}

export async function writeAllDocuments(
  files: Map<string, { blob: Blob; filename: string } | Blob>,
): Promise<void> {
  const docs = await getDocsDir()
  for (const [id, value] of files) {
    const filename =
      value instanceof Blob
        ? `${id}.pdf`
        : value.filename || `${id}.pdf`
    const blob = value instanceof Blob ? value : value.blob
    const handle = await docs.getFileHandle(filename, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
  }
}

/** @deprecated */
export async function writeAllPdfs(files: Map<string, Blob>): Promise<void> {
  const mapped = new Map<string, { blob: Blob; filename: string }>()
  for (const [id, blob] of files) mapped.set(id, { blob, filename: `${id}.pdf` })
  await writeAllDocuments(mapped)
}

export async function clearAllDocuments(): Promise<void> {
  const docs = await getDocsDir()
  const names: string[] = []
  for await (const [name] of docs.entries()) {
    names.push(name)
  }
  for (const name of names) {
    await docs.removeEntry(name)
  }
}

/** @deprecated */
export async function clearAllPdfs(): Promise<void> {
  await clearAllDocuments()
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

export function detectFormat(file: File): DocumentFormat | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (
    name.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/epub'
  ) {
    return 'epub'
  }
  return null
}
