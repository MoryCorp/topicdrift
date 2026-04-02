import { useState, useMemo } from 'react'

function getColor(score) {
  if (score >= 0.7) return '#22c55e'
  if (score >= 0.5) return '#f59e0b'
  return '#ef4444'
}

export default function PagesTable({ pages, gscAvailable }) {
  const [sortKey, setSortKey] = useState('similarity_score')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [scoreFilter, setScoreFilter] = useState('all')

  const filtered = useMemo(() => {
    let result = [...pages]

    // Score filter
    if (scoreFilter === 'off') result = result.filter(p => p.similarity_score < 0.5)
    else if (scoreFilter === 'border') result = result.filter(p => p.similarity_score >= 0.5 && p.similarity_score < 0.7)
    else if (scoreFilter === 'on') result = result.filter(p => p.similarity_score >= 0.7)

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        (p.url || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q)
      )
    }

    // Sort
    result.sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      return sortAsc ? av - bv : bv - av
    })

    return result
  }, [pages, sortKey, sortAsc, search, scoreFilter])

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="text-slate-600 ml-1">&#8597;</span>
    return <span className="text-blue-400 ml-1">{sortAsc ? '&#8593;' : '&#8595;'}</span>
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <h3 className="font-semibold">Pages ({filtered.length})</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={scoreFilter}
            onChange={e => setScoreFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none"
          >
            <option value="all">All scores</option>
            <option value="off">Off-topic (&lt;0.5)</option>
            <option value="border">Borderline (0.5-0.7)</option>
            <option value="on">On-topic (&ge;0.7)</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search URL or title..."
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none w-60 focus:ring-1 focus:ring-blue-500"
          />
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
              <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('word_count')}>
                Words <SortIcon col="word_count" />
              </th>
              {gscAvailable && (
                <th className="pb-3 px-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('gsc_clicks')}>
                  Clicks <SortIcon col="gsc_clicks" />
                </th>
              )}
              {gscAvailable && (
                <th className="pb-3 pl-3 font-medium">Top Query</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((p, i) => (
              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-750">
                <td className="py-3 pr-4 max-w-md">
                  <div className="truncate font-medium text-slate-200" title={p.title}>{p.title || '(no title)'}</div>
                  <div className="truncate text-xs text-slate-500" title={p.url}>
                    {p.url.replace(/^https?:\/\/[^/]+/, '')}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="font-mono font-medium" style={{ color: getColor(p.similarity_score) }}>
                    {(p.similarity_score * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="py-3 px-3 text-slate-400">{p.word_count?.toLocaleString()}</td>
                {gscAvailable && (
                  <td className="py-3 px-3 text-slate-300 font-medium">{p.gsc_clicks?.toLocaleString() || '0'}</td>
                )}
                {gscAvailable && (
                  <td className="py-3 pl-3 text-slate-400 text-xs truncate max-w-[200px]">
                    {p.top_queries?.[0] || '-'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="text-slate-500 text-sm text-center mt-4">Showing first 200 of {filtered.length} results</p>
        )}
      </div>
    </div>
  )
}
