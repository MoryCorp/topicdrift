import { useState } from 'react'
import { api } from '../api'

const LANGUAGES = [
  { value: '', label: 'All languages' },
  { value: 'fr', label: 'French (FR)' },
  { value: 'en', label: 'English (EN)' },
  { value: 'es', label: 'Spanish (ES)' },
  { value: 'de', label: 'German (DE)' },
  { value: 'it', label: 'Italian (IT)' },
  { value: 'pt', label: 'Portuguese (PT)' },
  { value: 'nl', label: 'Dutch (NL)' },
]

export default function ProjectSetup({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [keywords, setKeywords] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [thresholdOff, setThresholdOff] = useState(0.5)
  const [thresholdOn, setThresholdOn] = useState(0.7)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set())
  const [error, setError] = useState('')

  const handleSuggest = async () => {
    if (!domain.trim()) { setError('Enter a domain first'); return }
    setSuggesting(true)
    setError('')
    try {
      const res = await api.suggestKeywords(domain.trim())
      setSuggestions(res.keywords || [])
      setSelectedSuggestions(new Set(res.keywords || []))
    } catch (e) {
      setError('Suggestion failed: ' + e.message)
    }
    setSuggesting(false)
  }

  const toggleSuggestion = (kw) => {
    const next = new Set(selectedSuggestions)
    if (next.has(kw)) next.delete(kw); else next.add(kw)
    setSelectedSuggestions(next)
  }

  const applySuggestions = () => {
    const existing = keywords.split('\n').map(k => k.trim()).filter(Boolean)
    const merged = [...new Set([...existing, ...selectedSuggestions])]
    setKeywords(merged.join('\n'))
    setSuggestions([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !domain.trim() || !keywords.trim()) {
      setError('Name, domain and at least one keyword are required')
      return
    }
    const anchor_keywords = keywords.split('\n').map(k => k.trim()).filter(Boolean)
    if (anchor_keywords.length === 0) { setError('At least one keyword required'); return }

    setLoading(true)
    setError('')
    try {
      const project = await api.createProject({
        name: name.trim(),
        domain: domain.trim(),
        anchor_keywords,
        lang_filter: langFilter || null,
        threshold_off_topic: thresholdOff,
        threshold_on_topic: thresholdOn,
      })
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
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. My Website Analysis"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Domain</label>
          <div className="flex gap-2">
            <input type="text" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="e.g. example.com"
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition" />
            <button type="button" onClick={handleSuggest} disabled={suggesting}
              className="px-4 py-3 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 rounded-lg text-sm font-medium transition whitespace-nowrap">
              {suggesting ? 'Analyzing...' : 'Suggest Keywords'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Without https:// - just the domain name</p>
        </div>

        {/* Keyword suggestions */}
        {suggestions.length > 0 && (
          <div className="bg-slate-800/50 border border-purple-500/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-purple-300">Suggested Keywords</h4>
              <button type="button" onClick={applySuggestions}
                className="text-xs px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded-md transition">
                Apply Selected ({selectedSuggestions.size})
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((kw, i) => (
                <button key={i} type="button" onClick={() => toggleSuggestion(kw)}
                  className={`px-3 py-1.5 rounded-full text-sm transition border ${
                    selectedSuggestions.has(kw)
                      ? 'bg-purple-600/30 border-purple-500/50 text-purple-200'
                      : 'bg-slate-700/50 border-slate-600/50 text-slate-400'
                  }`}>
                  {kw}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Core Keywords (Anchor)</label>
          <textarea value={keywords} onChange={e => setKeywords(e.target.value)}
            placeholder={"One keyword per line, e.g.:\ncar insurance\nauto insurance quote\ninsurance coverage"}
            rows={6}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none" />
          <p className="text-xs text-slate-500 mt-1">
            These define your core business topic. Pages are scored by semantic distance from this anchor.
          </p>
        </div>

        {/* Advanced settings */}
        <div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-slate-400 hover:text-slate-200 flex items-center gap-1 transition">
            <svg className={`w-4 h-4 transition ${showAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Advanced Settings
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4 bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Language Filter</label>
                <select value={langFilter} onChange={e => setLangFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm outline-none">
                  {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Off-topic threshold: <span className="text-red-400 font-mono">{thresholdOff}</span>
                </label>
                <input type="range" min="0.1" max="0.9" step="0.05" value={thresholdOff}
                  onChange={e => setThresholdOff(parseFloat(e.target.value))}
                  className="w-full accent-red-500" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  On-topic threshold: <span className="text-green-400 font-mono">{thresholdOn}</span>
                </label>
                <input type="range" min="0.2" max="1.0" step="0.05" value={thresholdOn}
                  onChange={e => setThresholdOn(parseFloat(e.target.value))}
                  className="w-full accent-green-500" />
              </div>
            </div>
          )}
        </div>

        {error && <div className="text-red-400 text-sm bg-red-400/10 rounded-lg p-3">{error}</div>}

        <div className="flex gap-3">
          <button type="button" onClick={onCancel}
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition">Cancel</button>
          <button type="submit" disabled={loading}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-slate-400 rounded-lg font-medium transition">
            {loading ? 'Creating...' : 'Create & Start Crawl'}
          </button>
        </div>
      </form>
    </div>
  )
}
