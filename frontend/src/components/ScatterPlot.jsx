import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function getColor(score) {
  if (score >= 0.7) return '#22c55e'
  if (score >= 0.5) return '#f59e0b'
  return '#ef4444'
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-sm max-w-xs">
      <p className="font-medium text-slate-100 truncate">{d.title || d.url}</p>
      <p className="text-slate-400 text-xs truncate mb-2">{d.url}</p>
      <div className="flex gap-4">
        <span>Score: <strong style={{ color: getColor(d.similarity_score) }}>{(d.similarity_score * 100).toFixed(0)}%</strong></span>
        {d.gsc_clicks > 0 && <span>Clicks: <strong>{d.gsc_clicks}</strong></span>}
        <span>Words: <strong>{d.word_count}</strong></span>
      </div>
    </div>
  )
}

export default function ScatterPlotChart({ pages, gscAvailable }) {
  const yKey = gscAvailable ? 'gsc_clicks' : 'word_count'
  const yLabel = gscAvailable ? 'Clicks (GSC)' : 'Word Count'

  // Split data into 3 groups for coloring
  const onTopic = pages.filter(p => p.similarity_score >= 0.7)
  const borderline = pages.filter(p => p.similarity_score >= 0.5 && p.similarity_score < 0.7)
  const offTopic = pages.filter(p => p.similarity_score < 0.5)

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <h3 className="font-semibold mb-4">Similarity vs {yLabel}</h3>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="similarity_score"
            type="number"
            domain={[0, 1]}
            name="Similarity"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: 'Similarity Score', position: 'bottom', fill: '#94a3b8', fontSize: 12 }}
          />
          <YAxis
            dataKey={yKey}
            type="number"
            name={yLabel}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine x={0.7} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
          <ReferenceLine x={0.5} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Scatter data={offTopic} fill="#ef4444" fillOpacity={0.7} r={4} />
          <Scatter data={borderline} fill="#f59e0b" fillOpacity={0.7} r={4} />
          <Scatter data={onTopic} fill="#22c55e" fillOpacity={0.7} r={4} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
