export const money = (n, digits = 2) =>
  n === null || n === undefined || n === '' ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const num = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US'));
export const compact = (n) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));

const toDate = (s) => (s ? new Date(String(s).length <= 10 ? `${s}T00:00:00` : String(s).replace(' ', 'T')) : null);
export const fmtDate = (s) => { const d = toDate(s); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'; };
export const fmtDateTime = (s) => { const d = toDate(s); return d && !isNaN(d) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'; };
export const timeAgo = (s) => {
  const d = toDate(s); if (!d) return '';
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now'; if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`; if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(s);
};
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 60);

export const TONES = {
  'Draft': 'neutral', 'Pending Approval': 'warning', 'Approved': 'info', 'Sent to Supplier': 'violet', 'Partially Received': 'warning', 'Fully Received': 'success', 'Cancelled': 'danger',
  'Pending': 'warning', 'Rejected': 'danger', 'Converted': 'violet', 'Verified': 'success', 'Open': 'info', 'Submitted': 'warning', 'Completed': 'success', 'Confirmed': 'info',
  'Processing': 'info', 'Ready for Dispatch': 'violet', 'Dispatched': 'violet', 'Delivered': 'success', 'Failed Delivery': 'danger',
  'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger', 'Matched': 'success', 'Variance': 'warning', 'Pending Count': 'neutral',
  'Shortage risk': 'danger', 'Stock-out': 'danger', 'Watch (incoming)': 'warning', 'Low': 'warning', 'OK': 'success',
  'Fast-moving': 'success', 'Steady': 'info', 'Slow-moving': 'warning', 'Urgent': 'danger', 'High': 'warning', 'Normal': 'info',
};
