import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function getClusterColor(sim) {
  if (sim >= 0.65) return '#22c55e'
  if (sim >= 0.45) return '#f59e0b'
  return '#ef4444'
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-sm">
      <p className="font-medium text-slate-200 mb-1">Range: {d.range}</p>
      <div className="space-y-0.5 text-xs">
        <p>{d.page_count} pages</p>
        <p>{d.total_clicks.toLocaleString()} clicks</p>
        {d.avg_position && <p>Avg position: {d.avg_position}</p>}
      </div>
    </div>
  )
}

export default function ClusterBubble({ clusters, gscAvailable }) {
  if (!clusters?.length) return null

  const data = clusters.map(c => ({
    ...c,
    _y: gscAvailable && c.avg_position ? c.avg_position : c.page_count,
    _size: Math.max(c.total_clicks, 1),
    _color: getClusterColor(c.avg_similarity),
  }))

  const usePosition = gscAvailable && data.some(d => d.avg_position)
  const yLabel = usePosition ? 'Avg Position' : 'Page Count'

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <h3 className="font-semibold mb-4">Cluster Overview</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="avg_similarity" type="number" domain={[0, 1]} name="Similarity"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            label={{ value: 'Similarity Range', position: 'bottom', fill: '#94a3b8', fontSize: 12 }} />
          <YAxis dataKey="_y" type="number" name={yLabel} reversed={usePosition}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }} />
          <ZAxis dataKey="_size" type="number" range={[20, 80]} />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={data} fillOpacity={0.6}>
            {data.map((d, i) => (
              <circle key={i} fill={d._color} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
