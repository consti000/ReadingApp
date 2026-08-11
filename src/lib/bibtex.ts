import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db'
import type { BibliographyEntry } from '@/types'

/** 간단한 BibTeX 파서 (@type{key, field = {value}, ...}) */
export function parseBibTeX(text: string): Omit<BibliographyEntry, 'id' | 'projectId' | 'createdAt'>[] {
  const entries: Omit<BibliographyEntry, 'id' | 'projectId' | 'createdAt'>[] = []
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\s*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const entryType = m[1].toLowerCase()
    const citeKey = m[2].trim()
    const body = m[3]
    const fields: Record<string, string> = {}
    const fieldRe = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/g
    let fm: RegExpExecArray | null
    while ((fm = fieldRe.exec(body)) !== null) {
      fields[fm[1].toLowerCase()] = (fm[2] ?? fm[3] ?? fm[4] ?? '').trim()
    }
    const authorRaw = fields.author ?? fields.editor ?? ''
    const authors = authorRaw
      .split(/\s+and\s+/i)
      .map((a) => a.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    entries.push({
      citeKey,
      entryType,
      title: fields.title ?? citeKey,
      authors,
      year: fields.year,
      journal: fields.journal,
      booktitle: fields.booktitle,
      publisher: fields.publisher,
      doi: fields.doi,
      url: fields.url,
      raw: m[0],
    })
  }
  return entries
}

/** CSL-JSON 배열 파서 */
export function parseCslJson(text: string): Omit<BibliographyEntry, 'id' | 'projectId' | 'createdAt'>[] {
  const data = JSON.parse(text) as Array<Record<string, unknown>>
  if (!Array.isArray(data)) throw new Error('CSL-JSON은 배열이어야 합니다')
  return data.map((item) => {
    const authorsRaw = (item.author as Array<{ family?: string; given?: string }>) ?? []
    const authors = authorsRaw.map((a) =>
      [a.family, a.given].filter(Boolean).join(', '),
    )
    const issued = item.issued as { 'date-parts'?: number[][] } | undefined
    const year = issued?.['date-parts']?.[0]?.[0]?.toString()
    const citeKey =
      (item.id as string) ||
      `${authors[0]?.split(',')[0] ?? 'ref'}${year ?? ''}`.replace(/\s+/g, '')
    return {
      citeKey,
      entryType: (item.type as string) ?? 'article',
      title: (item.title as string) ?? citeKey,
      authors,
      year,
      journal: item['container-title'] as string | undefined,
      booktitle: item['container-title'] as string | undefined,
      publisher: item.publisher as string | undefined,
      doi: item.DOI as string | undefined,
      url: item.URL as string | undefined,
      raw: JSON.stringify(item),
    }
  })
}

export async function importBibliography(
  projectId: string,
  file: File,
): Promise<number> {
  const text = await file.text()
  const name = file.name.toLowerCase()
  const parsed =
    name.endsWith('.json') || text.trim().startsWith('[')
      ? parseCslJson(text)
      : parseBibTeX(text)

  const now = Date.now()
  let count = 0
  for (const e of parsed) {
    const existing = await db.bibliography
      .where('projectId')
      .equals(projectId)
      .filter((row) => row.citeKey === e.citeKey)
      .first()
    if (existing) {
      await db.bibliography.update(existing.id, { ...e })
    } else {
      await db.bibliography.add({
        id: uuid(),
        projectId,
        ...e,
        createdAt: now,
      })
      count++
    }
  }
  return count
}

export type CitationStyle = 'apa' | 'mla' | 'chicago'

export function formatCitation(
  entry: BibliographyEntry,
  style: CitationStyle = 'apa',
): string {
  const authors = entry.authors
  const year = entry.year ?? 'n.d.'
  const title = entry.title

  if (style === 'mla') {
    const a =
      authors.length === 0
        ? ''
        : authors.length === 1
          ? `${authors[0]}. `
          : `${authors[0]}, et al. `
    return `${a}"${title}." ${entry.journal || entry.booktitle || ''} ${year}.`
  }

  if (style === 'chicago') {
    const a = authors.join(', ')
    return `${a}. "${title}." ${entry.journal || entry.booktitle || ''} (${year}).`
  }

  // APA
  const apaAuthors =
    authors.length === 0
      ? ''
      : authors.length === 1
        ? `${authors[0]}. `
        : authors.length === 2
          ? `${authors[0]}, & ${authors[1]}. `
          : `${authors[0]}, et al. `
  const container = entry.journal || entry.booktitle
  return `${apaAuthors}(${year}). ${title}.${container ? ` ${container}.` : ''}${
    entry.doi ? ` https://doi.org/${entry.doi}` : ''
  }`
}

export async function getCitationForDocument(
  documentId: string,
  style: CitationStyle = 'apa',
): Promise<string | null> {
  const doc = await db.documents.get(documentId)
  if (!doc?.citeKey) return null
  const entry = await db.bibliography
    .where('projectId')
    .equals(doc.projectId)
    .filter((row) => row.citeKey === doc.citeKey)
    .first()
  if (!entry) return null
  return formatCitation(entry, style)
}
