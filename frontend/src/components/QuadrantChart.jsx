import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Label } from 'recharts'

const QUADRANT_COLORS = {
  top_right: '#22c55e',
  top_left: '#ef4444',
  bottom_right: '#3b82f6',
  bottom_left: '#64748b',
}

const QUADRANT_LABELS = {
  top_right: 'Core business',
  top_left: 'Dilution',
  bottom_right: 'Isolated business',
  bottom_left: 'Outliers',
}

function getQuadrant(anchor, centroid, tOff, centroidMedian) {
  if (anchor >= tOff && centroid >= centroidMedian) return 'top_right'
  if (anchor < tOff && centroid >= centroidMedian) return 'top_left'
  if (anchor >= tOff && centroid < centroidMedian) return 'bottom_right'
  return 'bottom_left'
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-sm max-w-xs z-50">
      <p className="font-medium text-slate-100 truncate">{d.title || d.path}</p>
      <p className="text-slate-400 text-xs truncate mb-2">{d.path}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span>Anchor: <strong style={{ color: QUADRANT_COLORS[d._quadrant] }}>{(d._anchor * 100).toFixed(0)}%</strong></span>
        <span>Centroid: <strong>{(d._centroid * 100).toFixed(0)}%</strong></span>
        {d.gsc_clicks > 0 && <span>Clicks: <strong>{d.gsc_clicks.toLocaleString()}</strong></span>}
        <span>Words: <strong>{d.word_count?.toLocaleString()}</strong></span>
      </div>
      <div className="mt-1 text-xs opacity-60">{QUADRANT_LABELS[d._quadrant]}</div>
    </div>
  )
}

export default function QuadrantChart({ pages, gscAvailable, thresholdOff, centroidMedian, onPageClick }) {
  const hasCentroid = pages.some(p => p.centroid_similarity_norm != null)

  if (!hasCentroid) {
    return (
      <div className="bg-slate-800 rounded-xl p-6">
        <h3 className="font-semibold mb-4">Semantic Quadrants</h3>
        <div className="flex items-center justify-center h-64 text-slate-400">
          <div className="text-center">
            <p className="mb-2">Centroid data not available.</p>
            <p className="text-sm text-slate-500">Re-run the analysis to compute dual-axis scores.</p>
          </div>
        </div>
      </div>
    )
  }

  const filtered = pages.filter(p => !p.is_structural && p.centroid_similarity_norm != null)

  // Precompute sqrt range for bubble sizing
  const clicks = gscAvailable ? filtered.map(p => p.gsc_clicks || 0) : []
  const sqrtMin = clicks.length ? Math.sqrt(Math.min(...clicks)) : 0
  const sqrtMax = clicks.length ? Math.sqrt(Math.max(...clicks)) : 0
  const sqrtSpan = sqrtMax - sqrtMin

  const data = filtered.map(p => {
    const q = getQuadrant(p.similarity_score_norm, p.centroid_similarity_norm, thresholdOff, centroidMedian)
    let radius = 20
    if (gscAvailable && sqrtSpan > 0) {
      radius = 20 + ((Math.sqrt(p.gsc_clicks || 0) - sqrtMin) / sqrtSpan) * 100
    } else if (gscAvailable) {
      radius = 20
    }
    return {
      ...p,
      _anchor: p.similarity_score_norm,
      _centroid: p.centroid_similarity_norm,
      _quadrant: q,
      _color: QUADRANT_COLORS[q],
      _size: radius,
    }
  })

  const topRight = data.filter(d => d._quadrant === 'top_right')
  const topLeft = data.filter(d => d._quadrant === 'top_left')
  const bottomRight = data.filter(d => d._quadrant === 'bottom_right')
  const bottomLeft = data.filter(d => d._quadrant === 'bottom_left')

  // _size is already the target radius; pass through via identity range
  const zRange = gscAvailable ? [20, 120] : [20, 20]

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Semantic Quadrants</h3>
        {!gscAvailable && (
          <span className="text-xs text-amber-400/70 bg-amber-400/10 px-2 py-1 rounded">
            Import GSC data for click-weighted bubble sizes
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={500}>
        <ScatterChart margin={{ top: 30, right: 30, bottom: 30, left: 20 }}
          onClick={(e) => { if (e?.activePayload?.[0]?.payload?.id) onPageClick?.(e.activePayload[0].payload.id) }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="_anchor" type="number" domain={[0, 1]} name="Anchor"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}>
            <Label value={"Proximity to target topic \u2192"} position="bottom" offset={10} fill="#94a3b8" fontSize={12} />
          </XAxis>
          <YAxis dataKey="_centroid" type="number" domain={[0, 1]} name="Centroid"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}>
            <Label value={"\u2191 Proximity to site centroid"} angle={-90} position="insideLeft" offset={5} fill="#94a3b8" fontSize={12} />
          </YAxis>
          <ZAxis dataKey="_size" type="number" range={zRange} />
          <Tooltip content={<CustomTooltip />} />

          {/* Threshold lines */}
          <ReferenceLine x={thresholdOff} stroke="rgba(255,255,255,0.2)" strokeDasharray="6 4" />
          <ReferenceLine y={centroidMedian} stroke="rgba(255,255,255,0.2)" strokeDasharray="6 4" />

          {/* Quadrant data */}
          <Scatter data={bottomLeft} fill={QUADRANT_COLORS.bottom_left} fillOpacity={0.6} cursor="pointer" />
          <Scatter data={bottomRight} fill={QUADRANT_COLORS.bottom_right} fillOpacity={0.6} cursor="pointer" />
          <Scatter data={topLeft} fill={QUADRANT_COLORS.top_left} fillOpacity={0.6} cursor="pointer" />
          <Scatter data={topRight} fill={QUADRANT_COLORS.top_right} fillOpacity={0.6} cursor="pointer" />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Quadrant legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-3 text-xs">
        {Object.entries(QUADRANT_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: QUADRANT_COLORS[key] }} />
            <span className="text-slate-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
