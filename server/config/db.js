'use strict';
const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  dateStrings: true,      // DATE/DATETIME come back as plain strings (no timezone shifts)
  decimalNumbers: true,   // DECIMAL columns come back as numbers
  charset: 'utf8mb4',
});

/**
 * Run `fn(conn)` inside a database transaction. Commits on success, rolls back on
 * error. Deadlocks / lock-wait timeouts are retried automatically (up to 3 times).
 */
async function withTransaction(fn) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      const retryable = err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT');
      if (retryable && attempt < 3) { await new Promise((r) => setTimeout(r, 50 * attempt)); continue; }
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { pool, withTransaction };
