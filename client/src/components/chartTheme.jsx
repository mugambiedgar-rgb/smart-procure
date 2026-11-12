// Shared Recharts styling so every chart matches the dark theme.
export const COLORS = ['#3b82f6', '#22d3ee', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
export const axis = { stroke: '#64748b', fontSize: 11, tickLine: false, axisLine: { stroke: '#1f2a3d' } };
export const grid = { stroke: '#1a2335', strokeDasharray: '3 3', vertical: false };

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label !== undefined && <strong>{label}</strong>}
      {payload.map((p) => (
        <div key={p.dataKey + p.name} className="chart-tip-row"><i style={{ background: p.color || p.payload?.fill }} />{p.name}: <b>{formatter ? formatter(p.value, p.name) : Number(p.value).toLocaleString()}</b></div>
      ))}
    </div>
  );
}
