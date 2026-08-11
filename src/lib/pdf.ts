import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

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

export interface TextSpanBox {
  text: string
  left: number
  top: number
  width: number
  height: number
}

export async function getPageTextBoxes(
  page: PDFPageProxy,
  scale: number,
): Promise<TextSpanBox[]> {
  const content = await page.getTextContent()
  const viewport = page.getViewport({ scale })
  const boxes: TextSpanBox[] = []

  for (const item of content.items) {
    if (!('str' in item)) continue
    const textItem = item as TextItem
    if (!textItem.str) continue

    const tx = pdfjs.Util.transform(viewport.transform, textItem.transform)
    const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3])
    const width = textItem.width * scale
    const left = tx[4]
    const top = tx[5] - fontHeight

    boxes.push({
      text: textItem.str,
      left,
      top,
      width: Math.max(width, 1),
      height: Math.max(fontHeight, 1),
    })
  }
  return boxes
}
