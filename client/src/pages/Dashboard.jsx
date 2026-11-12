import { useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Boxes, Package, Truck, ShoppingCart, Clock, CheckCircle2, AlertTriangle, PackageX, PackageCheck, Send, RefreshCw, Activity } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, ErrorState, PageHeader, Spinner, StatCard } from '../components/ui.jsx';
import { COLORS, ChartTooltip, axis, grid } from '../components/chartTheme.jsx';
import { compact, money, num, timeAgo } from '../utils/format.js';

const ACTION_TEXT = {
  PO_CREATED: 'created purchase order', PO_APPROVED: 'approved purchase order', PO_SENT: 'sent purchase order', PO_REJECTED: 'rejected purchase order', PO_CANCELLED: 'cancelled purchase order', PO_SUBMITTED: 'submitted purchase order',
  PO_EDITED: 'edited purchase order', GRN_CREATED: 'recorded goods received', GRN_VERIFIED: 'verified goods received', GRN_CANCELLED: 'cancelled GRN', ORDER_CREATED: 'confirmed customer order', ORDER_CANCELLED: 'cancelled customer order',
  STOCK_ADJUSTED: 'approved a stock adjustment', RECON_CREATED: 'started stock count', RECON_SUBMITTED: 'submitted stock count', PRODUCT_CREATED: 'added product', PRODUCT_UPDATED: 'updated product',
  PRODUCT_DEACTIVATED: 'deactivated product', SUPPLIER_CREATED: 'registered supplier', SUPPLIER_UPDATED: 'updated supplier', REQ_CREATED: 'raised requisition', REQ_APPROVED: 'approved requisition', REQ_REJECTED: 'rejected requisition',
  DELIVERY_DISPATCHED: 'dispatched delivery', DELIVERY_DELIVERED: 'completed delivery', DELIVERY_FAILED_DELIVERY: 'recorded failed delivery', DELIVERY_PROCESSING: 'started processing delivery', DELIVERY_READY_FOR_DISPATCH: 'marked delivery ready', USER_CREATED: 'created user',
  CUSTOMER_CREATED: 'registered customer', SETTINGS_UPDATED: 'changed forecast settings', REPORT_EXPORTED: 'exported report',
};
const ref = (a) => a.details?.poNumber || a.details?.po_number || a.details?.grnNumber || a.details?.grn_number || a.details?.orderNo || a.details?.order_no || a.details?.deliveryNo || a.details?.delivery_no || a.details?.reqNumber || a.details?.req_number || a.details?.sessionNo || a.details?.sku || a.details?.name || '';

const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short' }); };

export default function Dashboard() {
  const { user } = useAuth(); const navigate = useNavigate();
  const { data, error, loading, reload } = useFetch('/dashboard', { live: ['inventory:update', 'data:changed'] });
  if (loading && !data) return <Spinner block label="Loading dashboard..." />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const { kpis: k, charts: c, activity } = data;

  const expenditure = c.monthlyExpenditure.map((r) => ({ ...r, label: monthLabel(r.month) }));
  const movement = c.stockMovement.map((r) => ({ ...r, label: r.day.slice(5) }));
  const demand = c.demand.rows.map((r) => ({ ...r, label: monthLabel(r.month) }));
  const supplier = c.supplierPerformance.map((s) => ({ ...s, short: s.name.split(' ')[0] }));
  const statusData = c.poStatus.map((s) => ({ name: s.status, value: Number(s.count) }));
  const valuation = c.valuation.map((v) => ({ ...v, value: Number(v.value) }));

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user.fullName.split(' ')[0]}`}
        subtitle="Live operational status - every figure below is read from the database and refreshes as stock changes."
        actions={<button className="btn btn-ghost" onClick={reload}><RefreshCw size={15} /> Refresh</button>} />

      <div className="grid grid-4 mb">
        <StatCard icon={Boxes} tone="info" label="Total products" value={num(k.total_products)} hint={`${num(k.total_stock)} units physical`} onClick={() => navigate('/inventory')} />
        <StatCard icon={Package} tone="cyan" label="Total stock quantity" value={num(k.total_stock)} hint={`${num(k.reserved_stock)} reserved - ${num(k.available_stock)} available`} onClick={() => navigate('/inventory')} />
        <StatCard icon={Truck} tone="violet" label="Total suppliers" value={num(k.total_suppliers)} hint="Active suppliers" onClick={() => navigate('/suppliers')} />
        <StatCard icon={ShoppingCart} tone="info" label="Total purchase orders" value={num(k.total_orders)} hint={`${num(k.awaiting_approval)} awaiting approval`} onClick={() => navigate('/procurement')} />
        <StatCard icon={Clock} tone="warning" label="Pending purchase orders" value={num(k.pending_orders)} hint={k.overdue_orders > 0 ? `${k.overdue_orders} overdue from supplier` : 'None overdue'} onClick={() => navigate('/procurement')} />
        <StatCard icon={CheckCircle2} tone="success" label="Completed purchases" value={num(k.completed_orders)} hint="Fully received" onClick={() => navigate('/procurement')} />
        <StatCard icon={AlertTriangle} tone="warning" label="Low-stock products" value={num(k.low_stock)} hint="At or below minimum level" onClick={() => navigate('/inventory?status=Low Stock')} />
        <StatCard icon={PackageX} tone="danger" label="Out-of-stock products" value={num(k.out_of_stock)} hint="No available units" onClick={() => navigate('/inventory?status=Out of Stock')} />
        <StatCard icon={PackageCheck} tone="success" label="Goods received today" value={num(k.grn_today)} hint={`${num(k.units_received_today)} units verified today`} onClick={() => navigate('/goods-received')} />
        <StatCard icon={Send} tone="violet" label="Pending customer deliveries" value={num(k.pending_deliveries)} hint={k.delayed_deliveries > 0 ? `${k.delayed_deliveries} delayed` : 'None delayed'} onClick={() => navigate('/sales?tab=deliveries')} />
        <StatCard icon={Activity} tone="cyan" label="Sales today" value={money(k.sales_today, 0)} hint={`${num(k.orders_today)} orders`} onClick={() => navigate('/sales')} />
        <StatCard icon={Boxes} tone="info" label="Inventory valuation" value={money(k.inventory_value, 0)} hint="Physical stock at cost" />
      </div>

      <div className="grid grid-main mb">
        <Card title="Monthly procurement expenditure" subtitle="Approved and received purchase orders, by order month">
          <div className="chart-box"><ResponsiveContainer>
            <BarChart data={expenditure} margin={{ left: -8, right: 8 }}>
              <CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={compact} width={48} />
              <Tooltip content={<ChartTooltip formatter={(v) => money(v, 0)} />} cursor={{ fill: 'rgba(59,130,246,.08)' }} />
              <Bar dataKey="amount" name="Expenditure" radius={[6, 6, 0, 0]} fill="url(#gBlue)" />
              <defs><linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#6d5cf0" /></linearGradient></defs>
            </BarChart></ResponsiveContainer></div>
        </Card>
        <Card title="Purchase order status" subtitle="All purchase orders">
          <div className="chart-box"><ResponsiveContainer>
            <PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2} stroke="none">
              {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
              <Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: '#aab4c6' }} /></PieChart></ResponsiveContainer></div>
        </Card>
      </div>

      <div className="grid grid-2 mb">
        <Card title="Stock movement trend" subtitle="Units in vs out of the warehouse, last 30 days">
          <div className="chart-box"><ResponsiveContainer>
            <AreaChart data={movement} margin={{ left: -8, right: 8 }}>
              <defs>
                <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.45} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} minTickGap={24} /><YAxis {...axis} width={40} />
              <Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="inbound" name="Received" stroke="#22c55e" fill="url(#gIn)" strokeWidth={2} />
              <Area type="monotone" dataKey="outbound" name="Dispatched" stroke="#22d3ee" fill="url(#gOut)" strokeWidth={2} />
            </AreaChart></ResponsiveContainer></div>
        </Card>
        <Card title="Product demand trend" subtitle="Units sold per month, by category">
          <div className="chart-box"><ResponsiveContainer>
            <LineChart data={demand} margin={{ left: -8, right: 8 }}>
              <CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={40} />
              <Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {c.demand.categories.map((cat, i) => <Line key={cat} type="monotone" dataKey={cat} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
            </LineChart></ResponsiveContainer></div>
        </Card>
      </div>

      <div className="grid grid-2 mb">
        <Card title="Supplier performance" subtitle="On-time delivery and order fulfilment (%) from verified receipts">
          <div className="chart-box"><ResponsiveContainer>
            <BarChart data={supplier} margin={{ left: -8, right: 8 }}>
              <CartesianGrid {...grid} /><XAxis dataKey="short" {...axis} interval={0} /><YAxis {...axis} domain={[0, 100]} width={40} />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: 'rgba(59,130,246,.08)' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="onTime" name="On-time %" fill="#22d3ee" radius={[5, 5, 0, 0]} /><Bar dataKey="fulfillment" name="Fulfilment %" fill="#8b5cf6" radius={[5, 5, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
        </Card>
        <Card title="Inventory valuation" subtitle="Physical stock at purchase cost, by category">
          <div className="chart-box"><ResponsiveContainer>
            <BarChart data={valuation} layout="vertical" margin={{ left: 40, right: 16 }}>
              <CartesianGrid {...grid} horizontal={false} vertical /><XAxis type="number" {...axis} tickFormatter={compact} /><YAxis type="category" dataKey="category" {...axis} width={130} />
              <Tooltip content={<ChartTooltip formatter={(v) => money(v, 0)} />} cursor={{ fill: 'rgba(59,130,246,.08)' }} />
              <Bar dataKey="value" name="Value" radius={[0, 6, 6, 0]}>{valuation.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
            </BarChart></ResponsiveContainer></div>
        </Card>
      </div>

      <Card title="Recent activity" subtitle="Latest transactions and system updates">
        <ul className="activity">
          {activity.length === 0 && <li className="muted">No activity yet.</li>}
          {activity.map((a) => (
            <li key={a.id}><span className="dot" />
              <div className="grow"><b>{a.user_name || 'System'}</b> <span className="muted">{ACTION_TEXT[a.action] || a.action.toLowerCase().replace(/_/g, ' ')}</span> {ref(a) && <span className="mono">{ref(a)}</span>}</div>
              <span className="muted small nowrap">{timeAgo(a.created_at)}</span></li>
          ))}
        </ul>
      </Card>
    </>
  );
}
