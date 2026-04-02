import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import ScatterPlotChart from './ScatterPlot'
import DistributionChart from './DistributionChart'
import PagesTable from './PagesTable'

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
  const fileRef = useRef(null)

  useEffect(() => {
    api.getDashboard(projectId)
      .then(setData)
      .finally(() => setLoading(false))
  }, [projectId])

  const connectGsc = async () => {
    try {
      const { url } = await api.getGscAuthUrl(projectId)
      window.location.href = url
    } catch (e) {
      alert('GSC not configured: ' + e.message)
    }
  }

  const fetchGsc = async () => {
    setGscLoading(true)
    try {
      await api.fetchGscData(projectId)
      const d = await api.getDashboard(projectId)
      setData(d)
    } catch (e) {
      alert('Error: ' + e.message)
    }
    setGscLoading(false)
  }

  const uploadCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setGscLoading(true)
    try {
      await api.uploadGscCsv(projectId, file)
      const d = await api.getDashboard(projectId)
      setData(d)
    } catch (err) {
      alert('Error: ' + err.message)
    }
    setGscLoading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (loading) return <div className="text-center py-20 text-slate-400">Loading dashboard...</div>
  if (!data) return <div className="text-center py-20 text-red-400">Failed to load data</div>

  const { project, stats, distribution, pages, gsc_available, anchor_keywords } = data

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <button onClick={onBack} className="text-slate-400 hover:text-slate-200 mb-2 flex items-center gap-1 transition text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Projects
          </button>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-slate-400 text-sm">{project.domain}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {anchor_keywords?.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {anchor_keywords.slice(0, 5).map((k, i) => (
                <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20">{k}</span>
              ))}
              {anchor_keywords.length > 5 && (
                <span className="px-2 py-0.5 text-slate-500 text-xs">+{anchor_keywords.length - 5}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Pages" value={stats.total_pages} />
        <StatCard
          label="Avg Similarity"
          value={`${(stats.avg_similarity * 100).toFixed(0)}%`}
          color={stats.avg_similarity >= 0.7 ? '#22c55e' : stats.avg_similarity >= 0.5 ? '#f59e0b' : '#ef4444'}
        />
        <StatCard
          label="Dilution Ratio"
          value={`${(stats.dilution_ratio * 100).toFixed(0)}%`}
          sub={gsc_available ? `${(stats.dilution_ratio_weighted * 100).toFixed(0)}% weighted by traffic` : undefined}
          color={stats.dilution_ratio <= 0.2 ? '#22c55e' : stats.dilution_ratio <= 0.4 ? '#f59e0b' : '#ef4444'}
        />
        <StatCard
          label="Off-Topic Pages"
          value={stats.pages_off_topic}
          sub={`${stats.pages_borderline} borderline, ${stats.pages_on_topic} on-topic`}
          color="#ef4444"
        />
      </div>

      {/* GSC panel */}
      <div className="bg-slate-800 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-sm">Search Console Data</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {gsc_available ? 'GSC data loaded - traffic metrics active' : 'Connect GSC or upload a CSV for traffic-weighted analysis'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {gsc_available ? (
              <button
                onClick={fetchGsc}
                disabled={gscLoading}
                className="px-3 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-lg text-sm transition disabled:opacity-50"
              >
                {gscLoading ? 'Loading...' : 'Refresh GSC Data'}
              </button>
            ) : (
              <>
                <button
                  onClick={connectGsc}
                  className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-sm transition"
                >
                  Connect GSC
                </button>
                <label className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition cursor-pointer">
                  {gscLoading ? 'Uploading...' : 'Upload CSV'}
                  <input ref={fileRef} type="file" accept=".csv" onChange={uploadCsv} className="hidden" />
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <ScatterPlotChart pages={pages} gscAvailable={gsc_available} />
        <DistributionChart distribution={distribution} />
      </div>

      {/* Pages table */}
      <PagesTable pages={pages} gscAvailable={gsc_available} />
    </div>
  )
}
