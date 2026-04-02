import { useState, useMemo } from 'react'

function getColor(score, tOff, tOn) {
  if (score >= tOn) return '#22c55e'
  if (score >= tOff) return '#f59e0b'
  return '#ef4444'
}

const QUADRANT_STYLES = {
  top_right: { label: 'Core', bg: 'bg-green-500/20', text: 'text-green-300' },
  top_left: { label: 'Dilution', bg: 'bg-red-500/20', text: 'text-red-300' },
  bottom_right: { label: 'Isolated', bg: 'bg-blue-500/20', text: 'text-blue-300' },
  bottom_left: { label: 'Outlier', bg: 'bg-slate-600/30', text: 'text-slate-400' },
}

const TYPE_STYLES = {
  content: '',
  blog: 'bg-purple-500/20 text-purple-300',
  structural: 'bg-slate-600/30 text-slate-400',
}

function getQuadrant(anchorNorm, centroidNorm, tOff, centroidMedian) {
  if (anchorNorm >= tOff && centroidNorm >= centroidMedian) return 'top_right'
  if (anchorNorm < tOff && centroidNorm >= centroidMedian) return 'top_left'
  if (anchorNorm >= tOff && centroidNorm < centroidMedian) return 'bottom_right'
  return 'bottom_left'
}

export default function PagesTable({ pages, gscAvailable, thresholdOff, thresholdOn, centroidMedian, onPageClick }) {
  const [sortKey, setSortKey] = useState('similarity_score_norm')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [quadrantFilter, setQuadrantFilter] = useState('all')
  const [showStructural, setShowStructural] = useState(false)

  const filtered = useMemo(() => {
    let result = [...pages]

    if (!showStructural) result = result.filter(p => p.page_type !== 'structural')

    if (quadrantFilter !== 'all') {
      result = result.filter(p => {
        if (p.page_type === 'structural') return false
        return getQuadrant(p.similarity_score_norm || 0, p.centroid_similarity_norm || 0, thresholdOff, centroidMedian) === quadrantFilter
      })
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        (p.url || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.path || '').toLowerCase().includes(q)
      )
    }

    result.sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      return sortAsc ? av - bv : bv - av
    })

    return result
  }, [pages, sortKey, sortAsc, search, quadrantFilter, showStructural, thresholdOff, centroidMedian])

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="text-slate-600 ml-1">&#8597;</span>
    return <span className="text-blue-400 ml-1">{sortAsc ? '\u2191' : '\u2193'}</span>
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <h3 className="font-semibold">Pages ({filtered.length})</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showStructural} onChange={e => setShowStructural(e.target.checked)}
              className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0" />
            Structural
          </label>
          <select value={quadrantFilter} onChange={e => setQuadrantFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none">
            <option value="all">All quadrants</option>
            <option value="top_right">Core business</option>
            <option value="top_left">Dilution</option>
            <option value="bottom_right">Isolated business</option>
            <option value="bottom_left">Outliers</option>
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search URL or title..."
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none w-56 focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-left">
              <th className="pb-3 pr-4 font-medium">URL / Title</th>
              <th className="pb-3 px-2 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('similarity_score_norm')}>
                Anchor <SortIcon col="similarity_score_norm" />
              </th>
              <th className="pb-3 px-2 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('centroid_similarity_norm')}>
                Centroid <SortIcon col="centroid_similarity_norm" />
              </th>
              <th className="pb-3 px-2 font-medium">Quadrant</th>
              <th className="pb-3 px-2 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('word_count')}>
                Words <SortIcon col="word_count" />
              </th>
              {gscAvailable && (
                <>
                  <th className="pb-3 px-2 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('gsc_clicks')}>
                    Clicks <SortIcon col="gsc_clicks" />
                  </th>
                  <th className="pb-3 pl-2 font-medium">Top Query</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((p, i) => {
              const isStruct = p.page_type === 'structural'
              const quad = isStruct ? null : getQuadrant(p.similarity_score_norm || 0, p.centroid_similarity_norm || 0, thresholdOff, centroidMedian)
              const qs = quad ? QUADRANT_STYLES[quad] : null
              return (
                <tr key={i} onClick={() => onPageClick?.(p.id)}
                  className={`border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/30 transition ${isStruct ? 'opacity-50' : ''}`}>
                  <td className="py-2.5 pr-4 max-w-sm">
                    <div className="truncate font-medium text-slate-200" title={p.title}>{p.title || '(no title)'}</div>
                    <div className="truncate text-xs text-slate-500" title={p.path}>{p.path}</div>
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="font-mono font-medium text-xs" style={{ color: isStruct ? '#64748b' : getColor(p.similarity_score_norm || 0, thresholdOff, thresholdOn) }}>
                      {((p.similarity_score_norm || 0) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="font-mono text-xs text-slate-300">
                      {p.centroid_similarity_norm != null ? `${(p.centroid_similarity_norm * 100).toFixed(0)}%` : '-'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    {isStruct ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-600/30 text-slate-400">Structural</span>
                    ) : qs ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${qs.bg} ${qs.text}`}>{qs.label}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 px-2 text-slate-400 text-xs">{p.word_count?.toLocaleString()}</td>
                  {gscAvailable && (
                    <>
                      <td className="py-2.5 px-2 text-slate-300 font-medium text-xs">{p.gsc_clicks?.toLocaleString() || '0'}</td>
                      <td className="py-2.5 pl-2 text-slate-400 text-xs truncate max-w-[160px]">{p.top_queries?.[0] || '-'}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="text-slate-500 text-sm text-center mt-4">Showing first 200 of {filtered.length}</p>
        )}
      </div>
    </div>
  )
}
