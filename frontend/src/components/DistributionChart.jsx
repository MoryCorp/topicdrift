import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = [
  '#ef4444', '#ef4444', '#ef4444', '#ef4444', '#ef4444',
  '#f59e0b', '#f59e0b',
  '#22c55e', '#22c55e', '#22c55e',
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-2 shadow-xl text-sm">
      <p className="text-slate-300">Range: {label}</p>
      <p className="text-slate-100 font-medium">{payload[0].value} pages</p>
    </div>
  )
}

export default function DistributionChart({ distribution }) {
  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <h3 className="font-semibold mb-4">Score Distribution</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={distribution} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="range"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            label={{ value: 'Similarity Range', position: 'bottom', fill: '#94a3b8', fontSize: 12 }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: 'Pages', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {distribution.map((_, i) => (
              <Cell key={i} fill={COLORS[i] || '#22c55e'} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
