import { useState, useMemo } from 'react'

function getColor(score, tOff, tOn) {
  if (score >= tOn) return '#22c55e'
  if (score >= tOff) return '#f59e0b'
  return '#ef4444'
}

const typeStyles = {
  content: '',
  blog: 'bg-purple-500/20 text-purple-300',
  structural: 'bg-slate-600/30 text-slate-400',
}

export default function PagesTable({ pages, gscAvailable, thresholdOff, thresholdOn, onPageClick }) {
  const [sortKey, setSortKey] = useState('similarity_score')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [scoreFilter, setScoreFilter] = useState('all')
  const [showStructural, setShowStructural] = useState(false)

  const filtered = useMemo(() => {
    let result = [...pages]

    if (!showStructural) result = result.filter(p => p.page_type !== 'structural')
    if (scoreFilter === 'off') result = result.filter(p => p.similarity_score < thresholdOff && p.page_type !== 'structural')
    else if (scoreFilter === 'border') result = result.filter(p => p.similarity_score >= thresholdOff && p.similarity_score < thresholdOn && p.page_type !== 'structural')
    else if (scoreFilter === 'on') result = result.filter(p => p.similarity_score >= thresholdOn && p.page_type !== 'structural')

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
  }, [pages, sortKey, sortAsc, search, scoreFilter, showStructural, thresholdOff, thresholdOn])

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
            Show structural
          </label>
          <select value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none">
            <option value="all">All scores</option>
            <option value="off">Off-topic</option>
            <option value="border">Borderline</option>
            <option value="on">On-topic</option>
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search URL or title..."
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none w-60 focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-left">
              <th className="pb-3 pr-4 font-medium">URL / Title</th>
              <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('similarity_score')}>
                Score <SortIcon col="similarity_score" />
              </th>
              <th className="pb-3 px-3 font-medium">Type</th>
              <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('word_count')}>
                Words <SortIcon col="word_count" />
              </th>
              {gscAvailable && (
                <>
                  <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('gsc_clicks')}>
                    Clicks <SortIcon col="gsc_clicks" />
                  </th>
                  <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('gsc_position')}>
                    Pos. <SortIcon col="gsc_position" />
                  </th>
                  <th className="pb-3 pl-3 font-medium">Top Query</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((p, i) => {
              const isStruct = p.page_type === 'structural'
              return (
                <tr key={i} onClick={() => onPageClick?.(p.id)}
                  className={`border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/30 transition ${isStruct ? 'opacity-50' : ''}`}>
                  <td className="py-3 pr-4 max-w-md">
                    <div className="truncate font-medium text-slate-200" title={p.title}>{p.title || '(no title)'}</div>
                    <div className="truncate text-xs text-slate-500" title={p.path}>{p.path}</div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="font-mono font-medium" style={{ color: isStruct ? '#64748b' : getColor(p.similarity_score, thresholdOff, thresholdOn) }}>
                      {(p.similarity_score * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    {p.page_type !== 'content' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyles[p.page_type] || ''}`}>
                        {p.page_type}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-400">{p.word_count?.toLocaleString()}</td>
                  {gscAvailable && (
                    <>
                      <td className="py-3 px-3 text-slate-300 font-medium">{p.gsc_clicks?.toLocaleString() || '0'}</td>
                      <td className="py-3 px-3 text-slate-400">{p.gsc_position || '-'}</td>
                      <td className="py-3 pl-3 text-slate-400 text-xs truncate max-w-[180px]">{p.top_queries?.[0] || '-'}</td>
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
