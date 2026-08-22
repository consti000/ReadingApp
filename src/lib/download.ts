/**
 * 파일을 기기에 넘긴다.
 *
 * `<a download>` 로 blob 주소를 붙인 뒤 바로 지우면, Chrome 은 아직 읽는 중이어서
 * 다운로드가 끊기고 '확인되지 않음 ….crdownload' 로 남는다. 큰 백업 ZIP 에서 특히 그렇다.
 */

export function isSaveCanceled(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
  )
}

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

export interface SaveSession {
  filename: string
  handle?: FileSystemFileHandle
}

/** 클릭 직후(제스처가 살아 있을 때) 저장 자리를 먼저 잡는다 */
export async function beginSave(
  filename: string,
  type?: { description: string; accept: Record<string, string[]> },
): Promise<SaveSession> {
  const picker = (window as PickerWindow).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: type ? [type] : undefined,
      })
      return { filename, handle }
    } catch (error) {
      if (isSaveCanceled(error)) throw error
      // 대화상자를 열 수 없으면 아래 다운로드로 넘긴다
    }
  }
  return { filename }
}

export async function finishSave(session: SaveSession, blob: Blob): Promise<void> {
  if (session.handle) {
    const writable = await session.handle.createWritable()
    try {
      await writable.write(blob)
    } finally {
      await writable.close()
    }
    return
  }
  saveViaAnchor(blob, session.filename)
}

/** 이미 blob 이 있을 때 — 제스처가 끝났으면 대화상자 없이 다운로드로 둔다 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  saveViaAnchor(blob, filename)
}

function saveViaAnchor(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 용량이 클수록 디스크에 쓰는 시간이 길다. 그 전에 주소를 지우면 다운로드가 끊긴다.
  const waitMs = Math.min(180_000, Math.max(8_000, Math.ceil(blob.size / (256 * 1024)) * 1000))
  window.setTimeout(() => URL.revokeObjectURL(url), waitMs)
}
