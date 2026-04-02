import { useState, useEffect } from 'react'
import { api } from '../api'

const statusColors = {
  created: 'bg-slate-500',
  crawling: 'bg-yellow-500 animate-pulse',
  crawled: 'bg-blue-500',
  analyzing: 'bg-purple-500 animate-pulse',
  done: 'bg-green-500',
}

export default function ProjectList({ onSelect, onNew }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listProjects().then(setProjects).finally(() => setLoading(false))
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Delete this project and all its data?')) return
    await api.deleteProject(id)
    setProjects(projects.filter(p => p.id !== id))
  }

  if (loading) return <div className="text-center py-20 text-slate-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-slate-400 mt-1">Semantic proximity analysis for your websites</p>
        </div>
        <button onClick={onNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition">
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg">No projects yet</p>
          <p className="mt-2">Create your first project to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map(p => (
            <div key={p.id} onClick={() => onSelect(p.id)}
              className="bg-slate-800 rounded-xl p-5 cursor-pointer hover:ring-1 hover:ring-slate-600 transition group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-2.5 h-2.5 rounded-full ${statusColors[p.status] || 'bg-slate-500'}`} />
                  <div>
                    <h3 className="font-semibold text-lg">{p.name}</h3>
                    <p className="text-slate-400 text-sm">{p.domain}{p.lang_filter ? ` (${p.lang_filter.toUpperCase()})` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  {p.page_count > 0 && (
                    <div className="text-right">
                      <div className="text-sm text-slate-400">{p.page_count} pages</div>
                      {p.avg_score !== null && (
                        <div className="text-sm font-medium" style={{
                          color: p.avg_score >= 0.7 ? '#22c55e' : p.avg_score >= 0.5 ? '#f59e0b' : '#ef4444'
                        }}>
                          {(p.avg_score * 100).toFixed(0)}% avg
                        </div>
                      )}
                      {p.dilution_ratio > 0 && (
                        <div className="text-xs" style={{ color: p.dilution_ratio <= 0.2 ? '#22c55e' : p.dilution_ratio <= 0.4 ? '#f59e0b' : '#ef4444' }}>
                          {(p.dilution_ratio * 100).toFixed(0)}% dilution
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={(e) => handleDelete(e, p.id)}
                    className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1" title="Delete">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
