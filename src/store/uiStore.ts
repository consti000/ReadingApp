import { create } from 'zustand'
import type { HighlightColor } from '@/types'

export type ReaderTool = 'highlight' | 'pen'

interface UiState {
  highlightColor: HighlightColor
  setHighlightColor: (c: HighlightColor) => void
  penColor: string
  setPenColor: (c: string) => void
  readerTool: ReaderTool
  setReaderTool: (t: ReaderTool) => void
  pendingJump: { documentId: string; highlightId: string } | null
  setPendingJump: (j: { documentId: string; highlightId: string } | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  highlightColor: 'yellow',
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  penColor: '#e8c547',
  setPenColor: (penColor) => set({ penColor }),
  readerTool: 'highlight',
  setReaderTool: (readerTool) => set({ readerTool }),
  pendingJump: null,
  setPendingJump: (pendingJump) => set({ pendingJump }),
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}))
