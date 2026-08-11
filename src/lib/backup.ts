import JSZip from 'jszip'
import { exportDbJson, importDbJson, db } from '@/lib/db'
import {
  readAllDocuments,
  writeAllDocuments,
  clearAllDocuments,
} from '@/lib/opfs'

const META_VERSION = 2

export async function exportBackup(): Promise<Blob> {
  const zip = new JSZip()
  const data = await exportDbJson()
  zip.file(
    'meta.json',
    JSON.stringify({ version: META_VERSION, exportedAt: Date.now(), app: 'readlink' }, null, 2),
  )
  zip.file('db.json', JSON.stringify(data))

  const files = await readAllDocuments()
  const folder = zip.folder('documents')
  if (folder) {
    for (const [, { blob, filename }] of files) {
      folder.file(filename, blob)
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

  const fileMap = new Map<string, { blob: Blob; filename: string }>()
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
          fileMap.set(id, { blob, filename })
        }),
      )
    }
  })
  await Promise.all(tasks)

  await clearAllDocuments()
  await importDbJson(data)
  await writeAllDocuments(fileMap)

  return {
    documents: (data.documents?.length as number) ?? 0,
    projects: (data.projects?.length as number) ?? 0,
  }
}

export async function wipeAllData(): Promise<void> {
  await clearAllDocuments()
  await db.delete()
  await db.open()
}
