'use strict';
/**
 * Atomic, gap-tolerant document numbers (PO-2026-00001, GRN-2026-00001 ...).
 * Uses LAST_INSERT_ID(expr) so concurrent transactions never receive the same number.
 */
async function nextDocNo(conn, prefix) {
  const key = `${prefix}-${new Date().getFullYear()}`;
  await conn.query(
    `INSERT INTO doc_sequences (seq_key, last_number) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`, [key]);
  const [[row]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
  return `${key}-${String(row.n).padStart(5, '0')}`;
}
module.exports = { nextDocNo };
