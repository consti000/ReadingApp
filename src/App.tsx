import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LibraryPage } from '@/pages/LibraryPage'
import { ProjectPage } from '@/pages/ProjectPage'
import { ReadPage } from '@/pages/ReadPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { SplitPage } from '@/pages/SplitPage'
import { MindMapPage } from '@/pages/MindMapPage'
import { FlashcardPage } from '@/pages/FlashcardPage'
import { BibliographyPage } from '@/pages/BibliographyPage'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/project/:projectId" element={<ProjectPage />} />
          <Route path="/project/:projectId/read/:documentId" element={<ReadPage />} />
          <Route
            path="/project/:projectId/workspace/:workspaceId"
            element={<WorkspacePage />}
          />
          <Route
            path="/project/:projectId/split/:documentId/:workspaceId"
            element={<SplitPage />}
          />
          <Route path="/project/:projectId/mindmap/:mindMapId" element={<MindMapPage />} />
          <Route path="/project/:projectId/flashcards" element={<FlashcardPage />} />
          <Route path="/project/:projectId/bibliography" element={<BibliographyPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
