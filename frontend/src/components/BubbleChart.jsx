import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function getColor(score, tOff, tOn) {
  if (score >= tOn) return '#22c55e'
  if (score >= tOff) return '#f59e0b'
  return '#ef4444'
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-sm max-w-xs">
      <p className="font-medium text-slate-100 truncate">{d.title || d.path}</p>
      <p className="text-slate-400 text-xs truncate mb-2">{d.path}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span>Score: <strong style={{ color: d._color }}>{(d.similarity_score * 100).toFixed(0)}%</strong></span>
        {d.gsc_clicks > 0 && <span>Clicks: <strong>{d.gsc_clicks.toLocaleString()}</strong></span>}
        {d.gsc_position && <span>Position: <strong>{d.gsc_position}</strong></span>}
        <span>Words: <strong>{d.word_count?.toLocaleString()}</strong></span>
      </div>
    </div>
  )
}

export default function BubbleChart({ pages, gscAvailable, thresholdOff, thresholdOn, onPageClick }) {
  const usePosition = gscAvailable && pages.some(p => p.gsc_position)
  const yKey = usePosition ? 'gsc_position' : 'word_count'
  const yLabel = usePosition ? 'GSC Position' : 'Word Count'
  const yReversed = usePosition

  const data = pages
    .filter(p => !p.is_structural)
    .map(p => ({
      ...p,
      _color: getColor(p.similarity_score, thresholdOff, thresholdOn),
      _size: gscAvailable ? Math.max(p.gsc_clicks || 1, 1) : 50,
      [yKey]: usePosition ? (p.gsc_position || 50) : p.word_count,
    }))

  const onTopic = data.filter(p => p.similarity_score >= thresholdOn)
  const borderline = data.filter(p => p.similarity_score >= thresholdOff && p.similarity_score < thresholdOn)
  const offTopic = data.filter(p => p.similarity_score < thresholdOff)

  const zRange = gscAvailable ? [4, 40] : [6, 6]

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Similarity vs {yLabel}</h3>
        {!gscAvailable && (
          <span className="text-xs text-amber-400/70 bg-amber-400/10 px-2 py-1 rounded">
            Import GSC data for position & clicks view
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
          onClick={(e) => { if (e?.activePayload?.[0]?.payload?.id) onPageClick?.(e.activePayload[0].payload.id) }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="similarity_score" type="number" domain={[0, 1]} name="Similarity"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            label={{ value: 'Similarity Score', position: 'bottom', fill: '#94a3b8', fontSize: 12 }} />
          <YAxis dataKey={yKey} type="number" name={yLabel} reversed={yReversed}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }} />
          <ZAxis dataKey="_size" type="number" range={zRange} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine x={thresholdOn} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} />
          <ReferenceLine x={thresholdOff} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} />
          <Scatter data={offTopic} fill="#ef4444" fillOpacity={0.6} cursor="pointer" />
          <Scatter data={borderline} fill="#f59e0b" fillOpacity={0.6} cursor="pointer" />
          <Scatter data={onTopic} fill="#22c55e" fillOpacity={0.6} cursor="pointer" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
