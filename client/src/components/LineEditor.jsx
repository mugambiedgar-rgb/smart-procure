import { Plus, Trash2 } from 'lucide-react';
import { money } from '../utils/format.js';

/**
 * Editable list of product lines. lines: [{ key, productId, quantity, unitPrice }]
 * options: [{ id, label }]; info(line) renders a hint under a line (e.g. available stock).
 */
export default function LineEditor({ lines, setLines, options, withPrice = true, priceLabel = 'Unit price', defaultPrice, info, disabled }) {
  const update = (key, patch) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const used = new Set(lines.map((l) => String(l.productId)));
  const add = () => setLines([...lines, { key: Math.random().toString(36).slice(2), productId: '', quantity: 1, unitPrice: '' }]);
  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  return (
    <div>
      <div className="table-scroll">
        <table className="line-items">
          <thead><tr><th style={{ minWidth: 240 }}>Product</th><th style={{ width: 100 }}>Qty</th>{withPrice && <th style={{ width: 130 }}>{priceLabel}</th>}{withPrice && <th style={{ width: 120 }} className="right">Subtotal</th>}<th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <select value={l.productId} disabled={disabled} onChange={(e) => { const pid = e.target.value; update(l.key, { productId: pid, unitPrice: pid && defaultPrice ? defaultPrice(Number(pid)) : l.unitPrice }); }} aria-label="Product">
                    <option value="">Select product...</option>
                    {options.map((o) => <option key={o.id} value={o.id} disabled={used.has(String(o.id)) && String(l.productId) !== String(o.id)}>{o.label}</option>)}
                  </select>
                  {info && l.productId && <div className="small muted" style={{ marginTop: 3 }}>{info(l)}</div>}
                </td>
                <td><input type="number" min="1" step="1" value={l.quantity} disabled={disabled} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="Quantity" /></td>
                {withPrice && <td><input type="number" min="0" step="0.01" value={l.unitPrice} disabled={disabled} onChange={(e) => update(l.key, { unitPrice: e.target.value })} aria-label="Unit price" /></td>}
                {withPrice && <td className="right"><b>{money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</b></td>}
                <td>{!disabled && <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} disabled={lines.length === 1}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={add}><Plus size={14} /> Add product</button>}
      {withPrice && <div className="total-row"><span className="muted">Total</span><b>{money(total)}</b></div>}
    </div>
  );
}
export const newLine = () => ({ key: Math.random().toString(36).slice(2), productId: '', quantity: 1, unitPrice: '' });
