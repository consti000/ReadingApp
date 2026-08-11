import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LibraryPage } from '@/pages/LibraryPage'
import { ProjectPage } from '@/pages/ProjectPage'
import { ReadPage } from '@/pages/ReadPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { SplitPage } from '@/pages/SplitPage'

export default function App() {
  return (
    <BrowserRouter>
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
        </Routes>
      </div>
    </BrowserRouter>
  )
}
