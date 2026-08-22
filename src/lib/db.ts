import Dexie, { type EntityTable } from 'dexie'
import type {
  Project,
  DocumentMeta,
  Highlight,
  Node,
  Workspace,
  CardPlacement,
  InkLink,
  MindMap,
  MindMapNode,
  FlashcardDeck,
  Flashcard,
  BibliographyEntry,
  Bookmark,
  PenStroke,
} from '@/types'

class ReadLinkDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  documents!: EntityTable<DocumentMeta, 'id'>
  highlights!: EntityTable<Highlight, 'id'>
  nodes!: EntityTable<Node, 'id'>
  workspaces!: EntityTable<Workspace, 'id'>
  cardPlacements!: EntityTable<CardPlacement, 'id'>
  inkLinks!: EntityTable<InkLink, 'id'>
  mindMaps!: EntityTable<MindMap, 'id'>
  mindMapNodes!: EntityTable<MindMapNode, 'id'>
  flashcardDecks!: EntityTable<FlashcardDeck, 'id'>
  flashcards!: EntityTable<Flashcard, 'id'>
  bibliography!: EntityTable<BibliographyEntry, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>
  penStrokes!: EntityTable<PenStroke, 'id'>

  constructor() {
    super('readlink')
    this.version(1).stores({
      projects: 'id, name, updatedAt',
      documents: 'id, projectId, title, updatedAt',
      highlights: 'id, documentId, projectId, pageIndex, createdAt',
      nodes: 'id, projectId, documentId, sourceHighlightId, updatedAt',
      workspaces: 'id, projectId, updatedAt',
      cardPlacements: 'id, workspaceId, nodeId, [workspaceId+nodeId]',
      inkLinks: 'id, workspaceId, fromNodeId, toNodeId',
    })
    this.version(2).stores({
      projects: 'id, name, updatedAt',
      documents: 'id, projectId, title, citeKey, updatedAt',
      highlights: 'id, documentId, projectId, pageIndex, createdAt',
      nodes: 'id, projectId, documentId, sourceHighlightId, updatedAt',
      workspaces: 'id, projectId, updatedAt',
      cardPlacements: 'id, workspaceId, nodeId, [workspaceId+nodeId]',
      inkLinks: 'id, workspaceId, fromNodeId, toNodeId',
      mindMaps: 'id, projectId, updatedAt',
      mindMapNodes: 'id, mindMapId, nodeId, parentId',
      flashcardDecks: 'id, projectId, updatedAt',
      flashcards: 'id, deckId, projectId, nodeId, due',
      bibliography: 'id, projectId, citeKey',
      penStrokes: 'id, documentId, projectId, pageIndex',
    })
    this.version(3).stores({
      projects: 'id, name, updatedAt',
      documents: 'id, projectId, title, citeKey, updatedAt',
      highlights: 'id, documentId, projectId, pageIndex, createdAt',
      nodes: 'id, projectId, documentId, sourceHighlightId, updatedAt',
      workspaces: 'id, projectId, updatedAt',
      cardPlacements: 'id, workspaceId, nodeId, [workspaceId+nodeId]',
      inkLinks: 'id, workspaceId, fromNodeId, toNodeId',
      mindMaps: 'id, projectId, updatedAt',
      mindMapNodes: 'id, mindMapId, nodeId, parentId',
      flashcardDecks: 'id, projectId, updatedAt',
      flashcards: 'id, deckId, projectId, nodeId, due',
      bibliography: 'id, projectId, citeKey',
      bookmarks: 'id, documentId, projectId, createdAt',
      penStrokes: 'id, documentId, projectId, pageIndex',
    })
  }
}

export const db = new ReadLinkDB()

export const TABLES = [
  'projects',
  'documents',
  'highlights',
  'nodes',
  'workspaces',
  'cardPlacements',
  'inkLinks',
  'mindMaps',
  'mindMapNodes',
  'flashcardDecks',
  'flashcards',
  'bibliography',
  'bookmarks',
  'penStrokes',
] as const

export async function exportDbJson(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    out[t] = await db.table(t).toArray()
  }
  return out
}

export async function importDbJson(data: Record<string, unknown[]>): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
    }
    for (const t of TABLES) {
      const rows = data[t]
      if (rows?.length) await db.table(t).bulkAdd(rows)
    }
  })
}
