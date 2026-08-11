import { create } from 'zustand'
import type { HighlightColor } from '@/types'

interface UiState {
  highlightColor: HighlightColor
  setHighlightColor: (c: HighlightColor) => void
  /** 워크스페이스에서 원본으로 점프할 때 */
  pendingJump: { documentId: string; highlightId: string } | null
  setPendingJump: (j: { documentId: string; highlightId: string } | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  activeTool: 'select' | 'highlight' | 'note'
  setActiveTool: (t: 'select' | 'highlight' | 'note') => void
}

export const useUiStore = create<UiState>((set) => ({
  highlightColor: 'yellow',
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  pendingJump: null,
  setPendingJump: (pendingJump) => set({ pendingJump }),
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  activeTool: 'highlight',
  setActiveTool: (activeTool) => set({ activeTool }),
}))
