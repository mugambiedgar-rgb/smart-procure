import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, Settings2, TrendingUp, TriangleAlert, ShoppingBasket, Snail } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import { Badge, Card, Field, PageHeader, StatCard, Tabs } from '../components/ui.jsx';
import { COLORS, ChartTooltip, axis, grid } from '../components/chartTheme.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { money, num } from '../utils/format.js';

const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

function Settings({ settings, onSaved }) {
  const { can } = useAuth(); const { toast } = useUi();
  const [f, setF] = useState(settings); const [busy, setBusy] = useState(false);
  useEffect(() => setF(settings), [settings]);
  const save = async () => { setBusy(true); try { await api.put('/analytics/settings', f); toast.success('Forecast settings saved'); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Forecast settings" subtitle="Transparent inputs - change them to see how suggestions react">
      <div className="form-grid">
        <Field label="Sales history window (days)" hint="Average daily demand = units sold in this window / days"><input type="number" min="7" max="365" value={f.forecast_window_days} onChange={set('forecast_window_days')} disabled={!can('settings.manage')} /></Field>
        <Field label="Safety stock (days of demand)"><input type="number" min="0" max="90" value={f.safety_stock_days} onChange={set('safety_stock_days')} disabled={!can('settings.manage')} /></Field>
        <Field label="Cover beyond lead time (days)" hint="How long a replenishment order should last once it arrives"><input type="number" min="0" max="180" value={f.cover_days} onChange={set('cover_days')} disabled={!can('settings.manage')} /></Field>
        <div className="alert alert-info"><Info size={18} /><span>Lead time is set per product (Inventory &rarr; Edit product).</span></div>
      </div>
      {can('settings.manage') ? <button className="btn btn-primary mt" onClick={save} disabled={busy}><Settings2 size={15} /> Save settings</button> : <p className="muted small mt">Only administrators can change these settings.</p>}
    </Card>
  );
}

export default function Analytics() {
  const [tab, setTab] = useState('forecast'); const [risk, setRisk] = useState('');
  const fc = useFetch('/analytics/forecast', { live: ['inventory:update'] }); const mv = useFetch('/analytics/movers'); const se = useFetch('/analytics/seasonality');
  const rows = (fc.data?.rows || []).filter((r) => !risk || r.risk === risk);
  const atRisk = (fc.data?.rows || []).filter((r) => ['Stock-out', 'Shortage risk'].includes(r.risk)).length;
  const toReorder = (fc.data?.rows || []).filter((r) => r.suggested_reorder_qty > 0).length;
  const movers = mv.data?.rows || [];

  const fcCols = [
    { key: 'name', label: 'Product', render: (r) => <div><div className="cell-title">{r.name}</div><div className="cell-sub"><span className="mono">{r.sku}</span> - {r.category}</div></div> },
    { key: 'available_qty', label: 'Available', align: 'right', render: (r) => <b>{num(r.available_qty)}</b> },
    { key: 'incoming_qty', label: 'Incoming', align: 'right', render: (r) => (r.incoming_qty ? <span style={{ color: '#a78bfa' }}>+{r.incoming_qty}</span> : <span className="muted">-</span>) },
    { key: 'avg_daily_demand', label: 'Avg daily demand', align: 'right', render: (r) => <span title="Forecast estimate">~{r.avg_daily_demand}</span> },
    { key: 'days_of_cover', label: 'Days of cover', align: 'right', sortValue: (r) => r.days_of_cover ?? 9999, render: (r) => (r.days_of_cover === null ? <span className="muted">no sales</span> : <span style={{ color: r.days_of_cover < r.lead_time_days ? '#f87171' : undefined }}>{r.days_of_cover} d</span>) },
    { key: 'lead_time_days', label: 'Lead time', align: 'right', render: (r) => `${r.lead_time_days} d` },
    { key: 'reorder_point', label: 'Reorder point', align: 'right', render: (r) => <span title="Forecast estimate">~{r.reorder_point}</span> },
    { key: 'suggested_reorder_qty', label: 'Suggested reorder', align: 'right', render: (r) => (r.suggested_reorder_qty > 0 ? <b style={{ color: '#60a5fa' }}>~{num(r.suggested_reorder_qty)}</b> : <span className="muted">0</span>) },
    { key: 'risk', label: 'Shortage risk', render: (r) => <Badge>{r.risk}</Badge> },
  ];
  const moverCols = [
    { key: 'rank', label: '#', align: 'right' }, { key: 'name', label: 'Product', render: (r) => <div><div className="cell-title">{r.name}</div><div className="cell-sub"><span className="mono">{r.sku}</span> - {r.category}</div></div> },
    { key: 'units_sold', label: `Units sold (${mv.data?.windowDays}d)`, align: 'right', render: (r) => num(r.units_sold) }, { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money(r.revenue, 0) },
    { key: 'physical_qty', label: 'On hand', align: 'right' }, { key: 'last_sale', label: 'Last sale', render: (r) => (r.last_sale ? String(r.last_sale).slice(0, 10) : '-') }, { key: 'movement', label: 'Movement', render: (r) => <Badge>{r.movement}</Badge> },
  ];
  const top = movers.slice(0, 8).map((m) => ({ name: m.name.length > 22 ? `${m.name.slice(0, 21)}...` : m.name, units: m.units_sold }));
  const seasonal = (se.data?.rows || []).map((r) => ({ ...r, label: monthLabel(r.month) }));
  const index = (se.data?.index || []).map((r) => ({ ...r, label: monthLabel(r.month) }));

  return (
    <>
      <PageHeader title="Analytics & demand forecast" subtitle="Decision support for procurement." />
      <div className="alert alert-warning mb"><Info size={18} /><span><b>Forecasts are estimates, not stock.</b> They are calculated from historical sales and configurable lead times and never change inventory quantities. Figures marked with ~ are forecast values.</span></div>
      <div className="grid grid-3 mb">
        <StatCard icon={TriangleAlert} tone={atRisk ? 'danger' : 'success'} label="Potential stock shortages" value={atRisk} hint="Available stock below demand during lead time" />
        <StatCard icon={ShoppingBasket} tone="info" label="Products to reorder" value={toReorder} hint="Suggested quantity above zero" />
        <StatCard icon={TrendingUp} tone="cyan" label="Fast-moving products" value={movers.filter((m) => m.movement === 'Fast-moving').length} hint={`Top quartile by units sold (${mv.data?.windowDays || 90}d)`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'forecast', label: 'Reorder forecast' }, { key: 'movers', label: 'Fast & slow movers' }, { key: 'seasonal', label: 'Seasonal demand' }, { key: 'settings', label: 'Settings' }]} />
      {tab === 'forecast' && <DataTable columns={fcCols} rows={rows} loading={fc.loading} pageSize={12} searchPlaceholder="Search products..." rowClass={(r) => (['Stock-out', 'Shortage risk'].includes(r.risk) ? 'row-danger' : r.suggested_reorder_qty > 0 ? 'row-warn' : '')}
        filters={<select className="inline-select" value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk"><option value="">All products</option>{['Stock-out', 'Shortage risk', 'Watch (incoming)', 'Low', 'OK'].map((r) => <option key={r}>{r}</option>)}</select>} />}
      {tab === 'movers' && (<>
        <Card title="Top sellers" subtitle={`Units sold, last ${mv.data?.windowDays || 90} days`} className="mb"><div className="chart-box"><ResponsiveContainer><BarChart data={top} layout="vertical" margin={{ left: 60, right: 16 }}><CartesianGrid {...grid} horizontal={false} vertical /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="name" {...axis} width={150} /><Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(59,130,246,.08)' }} /><Bar dataKey="units" name="Units sold" radius={[0, 6, 6, 0]}>{top.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
        <DataTable columns={moverCols} rows={movers} loading={mv.loading} pageSize={15} searchPlaceholder="Search products..." rowKey="id" /></>)}
      {tab === 'seasonal' && (<div className="grid grid-2">
        <Card title="Units sold by category" subtitle="Last 12 months"><div className="chart-box tall"><ResponsiveContainer><LineChart data={seasonal} margin={{ left: -8, right: 8 }}><CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={40} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />{(se.data?.categories || []).map((c, i) => <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer></div></Card>
        <Card title="Seasonal demand index" subtitle="Month units / average month (1.0 = typical month)"><div className="chart-box tall"><ResponsiveContainer><BarChart data={index} margin={{ left: -8, right: 8 }}><CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={40} /><Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(59,130,246,.08)' }} /><Bar dataKey="seasonalIndex" name="Index" radius={[6, 6, 0, 0]}>{index.map((r, i) => <Cell key={i} fill={r.seasonalIndex >= 1.15 ? '#22c55e' : r.seasonalIndex <= 0.85 ? '#f59e0b' : '#3b82f6'} />)}</Bar></BarChart></ResponsiveContainer></div><div className="legend"><span><i style={{ background: '#22c55e' }} />Peak (&ge;1.15)</span><span><i style={{ background: '#3b82f6' }} />Typical</span><span><i style={{ background: '#f59e0b' }} />Quiet (&le;0.85)</span></div></Card>
      </div>)}
      {tab === 'settings' && fc.data && <Settings settings={fc.data.settings} onSaved={fc.reload} />}
    </>
  );
}
