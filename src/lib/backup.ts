import JSZip from 'jszip'
import { exportDbJson, importDbJson, db } from '@/lib/db'
import {
  readAllPdfs,
  writeAllPdfs,
  clearAllPdfs,
} from '@/lib/opfs'

const META_VERSION = 1

export async function exportBackup(): Promise<Blob> {
  const zip = new JSZip()
  const data = await exportDbJson()
  zip.file(
    'meta.json',
    JSON.stringify({ version: META_VERSION, exportedAt: Date.now(), app: 'readlink' }, null, 2),
  )
  zip.file('db.json', JSON.stringify(data))

  const pdfs = await readAllPdfs()
  const folder = zip.folder('documents')
  if (folder) {
    for (const [id, blob] of pdfs) {
      folder.file(`${id}.pdf`, blob)
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function downloadBackup(): Promise<void> {
  const blob = await exportBackup()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `readlink-backup-${date}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file: File): Promise<{ documents: number; projects: number }> {
  const zip = await JSZip.loadAsync(file)
  const dbFile = zip.file('db.json')
  if (!dbFile) throw new Error('유효한 ReadLink 백업이 아닙니다 (db.json 없음)')

  const data = JSON.parse(await dbFile.async('string')) as Record<string, unknown[]>

  const pdfMap = new Map<string, Blob>()
  const docsFolder = zip.folder('documents')
  if (docsFolder) {
    const tasks: Promise<void>[] = []
    zip.forEach((relativePath, entry) => {
      if (relativePath.startsWith('documents/') && relativePath.endsWith('.pdf') && !entry.dir) {
        const id = relativePath.replace(/^documents\//, '').replace(/\.pdf$/, '')
        tasks.push(
          entry.async('blob').then((blob) => {
            pdfMap.set(id, blob)
          }),
        )
      }
    })
    await Promise.all(tasks)
  }

  await clearAllPdfs()
  await importDbJson(data)
  await writeAllPdfs(pdfMap)

  return {
    documents: (data.documents?.length as number) ?? 0,
    projects: (data.projects?.length as number) ?? 0,
  }
}

export async function wipeAllData(): Promise<void> {
  await clearAllPdfs()
  await db.delete()
  await db.open()
}
