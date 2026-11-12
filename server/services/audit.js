'use strict';
const { pool } = require('../config/db');

/** Write an audit record. Pass the transaction connection so it commits/rolls back with the business change. */
async function audit(connOrPool, req, action, entityType, entityId, details = {}) {
  const userId = req && req.user ? req.user.id : (req && req.userId) || null;
  const ip = req && (req.ip || (req.socket && req.socket.remoteAddress)) || null;
  await (connOrPool || pool).query(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?,?,?,?,?,?)',
    [userId, action, entityType || null, entityId == null ? null : String(entityId), JSON.stringify(details), ip]);
}
module.exports = { audit };
