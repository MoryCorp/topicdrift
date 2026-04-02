import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

function getBarColor(rangeStr, tOff, tOn) {
  const mid = parseFloat(rangeStr.split('-')[0]) + 0.05
  if (mid >= tOn) return '#22c55e'
  if (mid >= tOff) return '#f59e0b'
  return '#ef4444'
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-2 shadow-xl text-sm">
      <p className="text-slate-300">Range: {label}</p>
      <p className="text-slate-100 font-medium">{payload[0].value} pages</p>
    </div>
  )
}

export default function DistributionChart({ distribution, thresholdOff, thresholdOn }) {
  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <h3 className="font-semibold mb-4">Score Distribution</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={distribution} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: 'Pages', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {distribution.map((d, i) => (
              <Cell key={i} fill={getBarColor(d.range, thresholdOff, thresholdOn)} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
