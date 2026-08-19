import { create } from 'zustand'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/types'

export type ReaderTool = 'highlight' | 'pen'

interface UiState {
  highlightColor: HighlightColor
  setHighlightColor: (c: HighlightColor) => void
  penColor: string
  setPenColor: (c: string) => void
  readerTool: ReaderTool
  setReaderTool: (t: ReaderTool) => void
  pendingJump: {
    documentId: string
    highlightId?: string
    bookmarkId?: string
  } | null
  setPendingJump: (
    j: { documentId: string; highlightId?: string; bookmarkId?: string } | null,
  ) => void
  /** 카드↔본문 연결선을 강조할 대상 */
  activeHighlightId: string | null
  setActiveHighlightId: (id: string | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  highlightColor: 'yellow',
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  penColor: HIGHLIGHT_COLORS.yellow,
  setPenColor: (penColor) => set({ penColor }),
  readerTool: 'highlight',
  setReaderTool: (readerTool) => set({ readerTool }),
  pendingJump: null,
  setPendingJump: (pendingJump) => set({ pendingJump }),
  activeHighlightId: null,
  setActiveHighlightId: (activeHighlightId) => set({ activeHighlightId }),
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}))
