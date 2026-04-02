import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import QuadrantChart from './QuadrantChart'
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
  const [exportMsg, setExportMsg] = useState('')
  const fileRef = useRef(null)

  const load = () => api.getDashboard(projectId).then(setData).finally(() => setLoading(false))
  useEffect(() => { load() }, [projectId])

  const handleExport = async (download = false) => {
    try {
      const md = await api.exportLlm(projectId)
      if (download) {
        const blob = new Blob([md], { type: 'text/markdown' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `topicdrift-${data?.project?.domain || 'export'}.md`
        a.click()
      } else {
        await navigator.clipboard.writeText(md)
        setExportMsg('Copied!')
        setTimeout(() => setExportMsg(''), 2000)
      }
    } catch (e) { alert('Export failed: ' + e.message) }
  }

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

  const { project, stats, distribution, pages, centroid_median, gsc_available, gsc_connected, anchor_keywords } = data
  const tOff = project.threshold_off_topic || 0.5
  const tOn = project.threshold_on_topic || 0.7
  const qc = stats.quadrant_counts || {}

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {anchor_keywords?.slice(0, 5).map((k, i) => (
              <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20">{k}</span>
            ))}
            {anchor_keywords?.length > 5 && <span className="text-slate-500 text-xs">+{anchor_keywords.length - 5}</span>}
          </div>
          <div className="relative">
            <button onClick={() => handleExport(false)} onContextMenu={(e) => { e.preventDefault(); handleExport(true) }}
              title="Click to copy, right-click to download .md"
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              {exportMsg || 'Export for LLM'}
            </button>
          </div>
        </div>
      </div>

      {/* ROW 1: Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Pages Analyzed" value={stats.total_pages_analyzed}
          sub={stats.structural_pages > 0 ? `${stats.structural_pages} structural excluded` : undefined} />
        <StatCard label="Avg Similarity" value={`${(stats.avg_anchor_similarity * 100).toFixed(0)}%`}
          color={stats.avg_anchor_similarity >= tOn ? '#22c55e' : stats.avg_anchor_similarity >= tOff ? '#f59e0b' : '#ef4444'} />
        <StatCard label="Dilution Ratio" value={`${(stats.dilution_ratio * 100).toFixed(0)}%`}
          sub={gsc_available ? `${(stats.dilution_ratio_weighted * 100).toFixed(0)}% weighted by traffic` : undefined}
          color={stats.dilution_ratio <= 0.2 ? '#22c55e' : stats.dilution_ratio <= 0.4 ? '#f59e0b' : '#ef4444'} />
        <StatCard label="Quadrants"
          value={
            <div className="text-sm leading-relaxed mt-1">
              <span style={{ color: '#22c55e' }}>{qc.top_right || 0}</span>
              <span className="text-slate-500"> core · </span>
              <span style={{ color: '#ef4444' }}>{qc.top_left || 0}</span>
              <span className="text-slate-500"> dilution</span>
              <br />
              <span style={{ color: '#3b82f6' }}>{qc.bottom_right || 0}</span>
              <span className="text-slate-500"> isolated · </span>
              <span style={{ color: '#64748b' }}>{qc.bottom_left || 0}</span>
              <span className="text-slate-500"> outlier</span>
            </div>
          }
        />
      </div>

      {/* ROW 2: Quadrant chart - full width */}
      <div className="mb-6">
        <QuadrantChart pages={pages} gscAvailable={gsc_available}
          thresholdOff={tOff} centroidMedian={centroid_median}
          onPageClick={setSelectedPage} />
      </div>

      {/* ROW 3: Distribution + GSC panel */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <DistributionChart distribution={distribution} thresholdOff={tOff} thresholdOn={tOn} />

        {/* GSC Panel */}
        <div className="bg-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-sm mb-2">Search Console Data</h3>
            <p className="text-xs text-slate-500 mb-4">
              {gsc_available
                ? 'GSC data loaded - bubble sizes reflect real traffic'
                : gsc_connected
                  ? 'OAuth connected - fetch data to enable traffic view'
                  : 'Import GSC data to weight bubbles by real clicks and unlock traffic-based dilution metrics'}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="px-4 py-2.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-sm transition cursor-pointer text-center font-medium">
              {gscLoading ? 'Uploading...' : gsc_available ? 'Re-import CSV' : 'Import GSC CSV'}
              <input ref={fileRef} type="file" accept=".csv" onChange={uploadCsv} className="hidden" />
            </label>
            {gsc_connected ? (
              <button onClick={fetchGsc} disabled={gscLoading}
                className="px-4 py-2.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-lg text-sm transition disabled:opacity-50 font-medium">
                {gscLoading ? 'Fetching...' : gsc_available ? 'Refresh via API' : 'Fetch GSC Data'}
              </button>
            ) : (
              <button onClick={connectGsc}
                className="px-4 py-2.5 bg-slate-700 text-slate-400 hover:bg-slate-600 rounded-lg text-sm transition font-medium">
                Connect OAuth
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ROW 4: Pages table - full width */}
      <PagesTable pages={pages} gscAvailable={gsc_available}
        thresholdOff={tOff} thresholdOn={tOn} centroidMedian={centroid_median}
        onPageClick={setSelectedPage} />

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
