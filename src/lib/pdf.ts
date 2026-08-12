import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Vite worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjs }

export async function loadPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjs.getDocument({ data })
  return loadingTask.promise
}
