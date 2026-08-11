import Dexie, { type EntityTable } from 'dexie'
import type {
  Project,
  DocumentMeta,
  Highlight,
  Node,
  Workspace,
  CardPlacement,
  InkLink,
} from '@/types'

class ReadLinkDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  documents!: EntityTable<DocumentMeta, 'id'>
  highlights!: EntityTable<Highlight, 'id'>
  nodes!: EntityTable<Node, 'id'>
  workspaces!: EntityTable<Workspace, 'id'>
  cardPlacements!: EntityTable<CardPlacement, 'id'>
  inkLinks!: EntityTable<InkLink, 'id'>

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
  }
}

export const db = new ReadLinkDB()

export async function exportDbJson(): Promise<Record<string, unknown[]>> {
  return {
    projects: await db.projects.toArray(),
    documents: await db.documents.toArray(),
    highlights: await db.highlights.toArray(),
    nodes: await db.nodes.toArray(),
    workspaces: await db.workspaces.toArray(),
    cardPlacements: await db.cardPlacements.toArray(),
    inkLinks: await db.inkLinks.toArray(),
  }
}

export async function importDbJson(data: Record<string, unknown[]>): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.projects,
      db.documents,
      db.highlights,
      db.nodes,
      db.workspaces,
      db.cardPlacements,
      db.inkLinks,
    ],
    async () => {
      await Promise.all([
        db.projects.clear(),
        db.documents.clear(),
        db.highlights.clear(),
        db.nodes.clear(),
        db.workspaces.clear(),
        db.cardPlacements.clear(),
        db.inkLinks.clear(),
      ])
      if (data.projects?.length) await db.projects.bulkAdd(data.projects as Project[])
      if (data.documents?.length) await db.documents.bulkAdd(data.documents as DocumentMeta[])
      if (data.highlights?.length) await db.highlights.bulkAdd(data.highlights as Highlight[])
      if (data.nodes?.length) await db.nodes.bulkAdd(data.nodes as Node[])
      if (data.workspaces?.length) await db.workspaces.bulkAdd(data.workspaces as Workspace[])
      if (data.cardPlacements?.length)
        await db.cardPlacements.bulkAdd(data.cardPlacements as CardPlacement[])
      if (data.inkLinks?.length) await db.inkLinks.bulkAdd(data.inkLinks as InkLink[])
    },
  )
}
