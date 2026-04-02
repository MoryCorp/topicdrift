import { useState, useEffect } from 'react'
import { api } from '../api'

function getColor(score, tOff = 0.5, tOn = 0.7) {
  if (score >= tOn) return '#22c55e'
  if (score >= tOff) return '#f59e0b'
  return '#ef4444'
}

const typeStyles = {
  content: 'bg-blue-500/20 text-blue-300',
  blog: 'bg-purple-500/20 text-purple-300',
  structural: 'bg-slate-600/30 text-slate-400',
}

export default function PageDetail({ projectId, pageId, thresholdOff, thresholdOn, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!pageId) return
    setLoading(true)
    api.getPageDetail(projectId, pageId).then(setData).finally(() => setLoading(false))
  }, [projectId, pageId])

  if (!pageId) return null

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold text-sm">Page Detail</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition p-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading ? (
          <div className="text-center py-10 text-slate-400">Loading...</div>
        ) : data ? (
          <>
            {/* Score */}
            <div className="text-center">
              <div className="text-5xl font-bold" style={{ color: getColor(data.similarity_score, thresholdOff, thresholdOn) }}>
                {(data.similarity_score * 100).toFixed(0)}%
              </div>
              <div className="text-slate-500 text-sm mt-1">similarity score</div>
            </div>

            {/* Meta */}
            <div className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Title</div>
                <div className="text-sm font-medium">{data.title || '(no title)'}</div>
              </div>
              {data.h1 && (
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">H1</div>
                  <div className="text-sm">{data.h1}</div>
                </div>
              )}
              {data.meta_description && (
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Meta Description</div>
                  <div className="text-sm text-slate-400">{data.meta_description}</div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyles[data.page_type] || typeStyles.content}`}>
                  {data.page_type}
                </span>
                <span className="text-xs text-slate-500">{data.word_count?.toLocaleString()} words</span>
              </div>
              <a href={data.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition break-all">
                {data.url}
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>

            {/* Content preview */}
            {data.content_preview && (
              <div>
                <div className="text-xs text-slate-500 mb-1">Content Preview</div>
                <div className="text-xs text-slate-400 bg-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto leading-relaxed">
                  {data.content_preview}
                </div>
              </div>
            )}

            {/* GSC queries */}
            {data.gsc_queries?.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Top GSC Queries</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left pb-1 font-medium">Query</th>
                      <th className="text-right pb-1 font-medium">Clicks</th>
                      <th className="text-right pb-1 font-medium">Impr.</th>
                      <th className="text-right pb-1 font-medium">Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gsc_queries.map((q, i) => (
                      <tr key={i} className="border-b border-slate-800">
                        <td className="py-1.5 pr-2 text-slate-300 truncate max-w-[200px]">{q.query}</td>
                        <td className="py-1.5 text-right text-slate-300 font-medium">{q.clicks}</td>
                        <td className="py-1.5 text-right text-slate-400">{q.impressions?.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-slate-400">{q.position?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-10 text-red-400">Failed to load page data</div>
        )}
      </div>
    </div>
  )
}
