/** OPFS — PDF 원본 파일 저장 (PC/안드로이드 공통) */

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

export function documentOpfsPath(documentId: string): string {
  return `${DOCS_DIR}/${documentId}.pdf`
}

export async function savePdf(documentId: string, file: File | Blob): Promise<string> {
  const docs = await getDocsDir()
  const handle = await docs.getFileHandle(`${documentId}.pdf`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return documentOpfsPath(documentId)
}

export async function loadPdf(documentId: string): Promise<Blob | null> {
  try {
    const docs = await getDocsDir()
    const handle = await docs.getFileHandle(`${documentId}.pdf`)
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function deletePdf(documentId: string): Promise<void> {
  try {
    const docs = await getDocsDir()
    await docs.removeEntry(`${documentId}.pdf`)
  } catch {
    // ignore missing
  }
}

export async function listPdfIds(): Promise<string[]> {
  const docs = await getDocsDir()
  const ids: string[] = []
  for await (const [name] of docs.entries()) {
    if (name.endsWith('.pdf')) ids.push(name.replace(/\.pdf$/, ''))
  }
  return ids
}

export async function readAllPdfs(): Promise<Map<string, Blob>> {
  const docs = await getDocsDir()
  const map = new Map<string, Blob>()
  for await (const [name, handle] of docs.entries()) {
    if (name.endsWith('.pdf') && handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      map.set(name.replace(/\.pdf$/, ''), file)
    }
  }
  return map
}

export async function writeAllPdfs(files: Map<string, Blob>): Promise<void> {
  const docs = await getDocsDir()
  for (const [id, blob] of files) {
    const handle = await docs.getFileHandle(`${id}.pdf`, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
  }
}

export async function clearAllPdfs(): Promise<void> {
  const docs = await getDocsDir()
  const names: string[] = []
  for await (const [name] of docs.entries()) {
    names.push(name)
  }
  for (const name of names) {
    await docs.removeEntry(name)
  }
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}
