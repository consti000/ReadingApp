import JSZip from 'jszip'
import { exportDbJson, importDbJson, db } from '@/lib/db'
import { beginSave, finishSave } from '@/lib/download'
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
    { compression: 'DEFLATE' },
  )
  zip.file('db.json', JSON.stringify(data), { compression: 'DEFLATE' })

  const files = await readAllDocuments()
  const folder = zip.folder('documents')
  if (folder) {
    for (const [, { blob, filename }] of files) {
      // PDF·EPUB 은 이미 압축돼 있어 다시 줄이면 시간만 늘고 용량은 거의 그대로다
      folder.file(filename, blob, { compression: 'STORE' })
    }
  }

  return zip.generateAsync({ type: 'blob' })
}

export async function downloadBackup(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const filename = `readlink-backup-${date}.zip`
  // ZIP 을 만들기 전에 저장 자리를 잡는다. 오래 걸리면 클릭 제스처가 사라져
  // 저장 대화상자가 막히고, 예전처럼 끊긴 다운로드만 남을 수 있다.
  const session = await beginSave(filename, {
    description: 'ReadLink 백업',
    accept: { 'application/zip': ['.zip'] },
  })
  const blob = await exportBackup()
  await finishSave(session, blob)
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
