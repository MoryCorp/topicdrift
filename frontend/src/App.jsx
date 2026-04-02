import { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList'
import ProjectSetup from './components/ProjectSetup'
import Dashboard from './components/Dashboard'
import CrawlStatus from './components/CrawlStatus'
import { api } from './api'

export default function App() {
  const [view, setView] = useState('list')
  const [projectId, setProjectId] = useState(null)
  const [project, setProject] = useState(null)

  // Handle URL params (GSC callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pid = params.get('project')
    if (pid) {
      setProjectId(parseInt(pid))
      setView('dashboard')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  const openProject = async (id) => {
    try {
      const p = await api.getProject(id)
      setProject(p)
      setProjectId(id)
      if (p.status === 'crawling') {
        setView('crawling')
      } else if (p.status === 'analyzing') {
        setView('crawling')
      } else if (p.status === 'done') {
        setView('dashboard')
      } else if (p.status === 'crawled') {
        setView('crawling')
      } else {
        setView('crawling')
      }
    } catch (e) {
      console.error(e)
    }
  }

  const onProjectCreated = (id) => {
    setProjectId(id)
    openProject(id)
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => setView('list')} className="flex items-center gap-3 hover:opacity-80 transition">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="4"/>
              </svg>
            </div>
            <span className="text-lg font-semibold text-slate-100">TopicDrift</span>
          </button>
          {view !== 'list' && view !== 'setup' && (
            <button
              onClick={() => setView('list')}
              className="text-sm text-slate-400 hover:text-slate-200 transition"
            >
              All Projects
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {view === 'list' && (
          <ProjectList
            onSelect={openProject}
            onNew={() => setView('setup')}
          />
        )}
        {view === 'setup' && (
          <ProjectSetup
            onCreated={onProjectCreated}
            onCancel={() => setView('list')}
          />
        )}
        {view === 'crawling' && projectId && (
          <CrawlStatus
            projectId={projectId}
            onDone={() => { setView('dashboard') }}
            onBack={() => setView('list')}
          />
        )}
        {view === 'dashboard' && projectId && (
          <Dashboard
            projectId={projectId}
            onBack={() => setView('list')}
          />
        )}
      </main>
    </div>
  )
}
