import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import BubbleChart from './BubbleChart'
import ClusterBubble from './ClusterBubble'
import DistributionChart from './DistributionChart'
import PagesTable from './PagesTable'
import PageDetail from './PageDetail'

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="text-slate-400 text-sm mb-1">{label}</div>
      <div className="text-2xl font-bold" style={color ? { color } : {}}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default function Dashboard({ projectId, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [gscLoading, setGscLoading] = useState(false)
  const [selectedPage, setSelectedPage] = useState(null)
  const fileRef = useRef(null)

  const load = () => api.getDashboard(projectId).then(setData).finally(() => setLoading(false))
  useEffect(() => { load() }, [projectId])

  const connectGsc = async () => {
    try {
      const { url } = await api.getGscAuthUrl(projectId)
      window.location.href = url
    } catch (e) { alert('GSC not configured: ' + e.message) }
  }

  const fetchGsc = async () => {
    setGscLoading(true)
    try { await api.fetchGscData(projectId); await load() }
    catch (e) { alert('Error: ' + e.message) }
    setGscLoading(false)
  }

  const uploadCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setGscLoading(true)
    try {
      const result = await api.uploadGscCsv(projectId, file)
      await load()
      if (result.rows_imported === 0) alert('No data imported. Check CSV format.')
    } catch (err) { alert('Error: ' + err.message) }
    setGscLoading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (loading) return <div className="text-center py-20 text-slate-400">Loading dashboard...</div>
  if (!data) return <div className="text-center py-20 text-red-400">Failed to load data</div>

  const { project, stats, distribution, pages, cluster_bubbles, gsc_available, anchor_keywords } = data
  const tOff = project.threshold_off_topic || 0.5
  const tOn = project.threshold_on_topic || 0.7

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <button onClick={onBack} className="text-slate-400 hover:text-slate-200 mb-2 flex items-center gap-1 transition text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Projects
          </button>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-slate-400 text-sm">{project.domain}{project.lang_filter ? ` (${project.lang_filter.toUpperCase()})` : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {anchor_keywords?.slice(0, 5).map((k, i) => (
            <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20">{k}</span>
          ))}
          {anchor_keywords?.length > 5 && <span className="text-slate-500 text-xs">+{anchor_keywords.length - 5}</span>}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Pages Analyzed" value={stats.total_pages_analyzed}
          sub={stats.structural_pages > 0 ? `${stats.structural_pages} structural excluded` : undefined} />
        <StatCard label="Avg Similarity" value={`${(stats.avg_similarity * 100).toFixed(0)}%`}
          color={stats.avg_similarity >= tOn ? '#22c55e' : stats.avg_similarity >= tOff ? '#f59e0b' : '#ef4444'} />
        <StatCard label="Dilution Ratio" value={`${(stats.dilution_ratio * 100).toFixed(0)}%`}
          sub={gsc_available ? `${(stats.dilution_ratio_weighted * 100).toFixed(0)}% weighted by traffic` : undefined}
          color={stats.dilution_ratio <= 0.2 ? '#22c55e' : stats.dilution_ratio <= 0.4 ? '#f59e0b' : '#ef4444'} />
        <StatCard label="Off-Topic Pages" value={stats.pages_off_topic} color="#ef4444"
          sub={`${stats.pages_borderline} borderline, ${stats.pages_on_topic} on-topic`} />
      </div>

      {/* GSC panel */}
      <div className="bg-slate-800 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-sm">Search Console Data</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {gsc_available ? 'GSC data loaded - traffic metrics active' : 'Import a CSV from GSC for traffic-weighted analysis'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-sm transition cursor-pointer">
              {gscLoading ? 'Uploading...' : gsc_available ? 'Re-import CSV' : 'Import GSC CSV'}
              <input ref={fileRef} type="file" accept=".csv" onChange={uploadCsv} className="hidden" />
            </label>
            {gsc_available && (
              <button onClick={fetchGsc} disabled={gscLoading}
                className="px-3 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-lg text-sm transition disabled:opacity-50">
                Refresh via API
              </button>
            )}
            {!gsc_available && (
              <button onClick={connectGsc}
                className="px-3 py-1.5 bg-slate-700 text-slate-400 hover:bg-slate-600 rounded-lg text-sm transition">
                Connect OAuth
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <BubbleChart pages={pages} gscAvailable={gsc_available}
          thresholdOff={tOff} thresholdOn={tOn} onPageClick={setSelectedPage} />
        <div className="space-y-6">
          <ClusterBubble clusters={cluster_bubbles} gscAvailable={gsc_available} />
          <DistributionChart distribution={distribution} thresholdOff={tOff} thresholdOn={tOn} />
        </div>
      </div>

      {/* Pages table */}
      <PagesTable pages={pages} gscAvailable={gsc_available}
        thresholdOff={tOff} thresholdOn={tOn} onPageClick={setSelectedPage} />

      {/* Page detail slide-over */}
      {selectedPage && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelectedPage(null)} />
          <PageDetail projectId={projectId} pageId={selectedPage}
            thresholdOff={tOff} thresholdOn={tOn} onClose={() => setSelectedPage(null)} />
        </>
      )}
    </div>
  )
}
