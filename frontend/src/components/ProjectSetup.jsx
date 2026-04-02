import { useState } from 'react'
import { api } from '../api'

export default function ProjectSetup({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !domain.trim() || !keywords.trim()) {
      setError('All fields are required')
      return
    }

    const anchor_keywords = keywords.split('\n').map(k => k.trim()).filter(Boolean)
    if (anchor_keywords.length === 0) {
      setError('At least one anchor keyword is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const project = await api.createProject({ name: name.trim(), domain: domain.trim(), anchor_keywords })
      // Auto-start crawl
      await api.startCrawl(project.id)
      onCreated(project.id)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 mb-6 flex items-center gap-1 transition">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <h1 className="text-2xl font-bold mb-2">New Project</h1>
      <p className="text-slate-400 mb-8">Configure your semantic analysis</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Project Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. My Website Analysis"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Domain</label>
          <input
            type="text"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="e.g. example.com"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          />
          <p className="text-xs text-slate-500 mt-1">Without https:// - just the domain name</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Core Keywords (Anchor)</label>
          <textarea
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder={"One keyword per line, e.g.:\ncar insurance\nauto insurance quote\ninsurance coverage"}
            rows={6}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
          />
          <p className="text-xs text-slate-500 mt-1">
            These keywords define your core business topic. Pages will be scored by their semantic distance from this anchor.
          </p>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 rounded-lg p-3">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-slate-400 rounded-lg font-medium transition"
          >
            {loading ? 'Creating...' : 'Create & Start Crawl'}
          </button>
        </div>
      </form>
    </div>
  )
}
