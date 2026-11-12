'use strict';
const { pool } = require('../config/db');

/**
 * Supplier performance indicators, computed from verified GRNs (never from supplier claims).
 *  on_time_pct       - share of delivered orders whose first verified GRN arrived on/before the expected date
 *  fulfillment_pct   - accepted quantity / ordered quantity across received (partial or full) orders
 *  avg_delivery_days - order date -> first verified GRN date
 *  incomplete_orders - open orders (Approved / Sent / Partially Received); overdue_orders = past expected date
 */
async function supplierPerformance(supplierId = null) {
  const filter = supplierId ? 'WHERE s.id = ?' : '';
  const [rows] = await pool.query(
    `SELECT s.id, s.code, s.name, s.contact_person, s.email, s.phone, s.city, s.country, s.payment_terms, s.is_active,
            COALESCE(d.delivered_orders, 0) AS delivered_orders,
            ROUND(100 * d.on_time / NULLIF(d.delivered_orders, 0), 1) AS on_time_pct,
            ROUND(d.avg_days, 1) AS avg_delivery_days,
            ROUND(100 * f.received_qty / NULLIF(f.ordered_qty, 0), 1) AS fulfillment_pct,
            COALESCE(o.open_orders, 0) AS incomplete_orders,
            COALESCE(o.overdue_orders, 0) AS overdue_orders,
            COALESCE(o.outstanding_value, 0) AS outstanding_value,
            COALESCE(t.total_orders, 0) AS total_orders,
            COALESCE(t.total_spend, 0) AS total_spend
       FROM suppliers s
       LEFT JOIN (SELECT po.supplier_id, COUNT(*) AS delivered_orders, SUM(fg.first_date <= po.expected_date) AS on_time,
                         AVG(DATEDIFF(fg.first_date, po.order_date)) AS avg_days
                    FROM purchase_orders po
                    JOIN (SELECT po_id, MIN(received_date) AS first_date FROM goods_received_notes WHERE status = 'Verified' GROUP BY po_id) fg ON fg.po_id = po.id
                   GROUP BY po.supplier_id) d ON d.supplier_id = s.id
       LEFT JOIN (SELECT po.supplier_id, SUM(poi.quantity_received) AS received_qty, SUM(poi.quantity_ordered) AS ordered_qty
                    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id
                   WHERE po.status IN ('Partially Received','Fully Received') GROUP BY po.supplier_id) f ON f.supplier_id = s.id
       LEFT JOIN (SELECT po.supplier_id, COUNT(DISTINCT po.id) AS open_orders,
                         COUNT(DISTINCT CASE WHEN po.expected_date < CURDATE() THEN po.id END) AS overdue_orders,
                         SUM((poi.quantity_ordered - poi.quantity_received) * poi.unit_price) AS outstanding_value
                    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id
                   WHERE po.status IN ('Approved','Sent to Supplier','Partially Received') GROUP BY po.supplier_id) o ON o.supplier_id = s.id
       LEFT JOIN (SELECT supplier_id, COUNT(*) AS total_orders, SUM(total_amount) AS total_spend
                    FROM purchase_orders WHERE status NOT IN ('Draft','Pending Approval','Cancelled') GROUP BY supplier_id) t ON t.supplier_id = s.id
      ${filter} ORDER BY s.name`, supplierId ? [supplierId] : []);
  return rows;
}
module.exports = { supplierPerformance };
