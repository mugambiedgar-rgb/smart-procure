'use strict';
const { pool } = require('../config/db');
const realtime = require('../utils/realtime');

/**
 * Create a notification for every active user holding one of `perms`.
 * `dedupeKey` (optional) suppresses repeats of the same alert for the same user within `dedupeHours`.
 * Real-time pushes are sent after insert; call with the transaction connection to stay atomic.
 */
async function notifyPerms(connOrPool, perms, { type, severity = 'info', title, message = null, link = null, dedupeKey = null, dedupeHours = 20, excludeUserId = null }) {
  const db = connOrPool || pool;
  const [users] = await db.query(
    `SELECT DISTINCT u.id FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE u.is_active = 1 AND p.code IN (?)`, [perms]);
  const sent = [];
  for (const { id } of users) {
    if (excludeUserId && id === excludeUserId) continue;
    if (dedupeKey) {
      const [dup] = await db.query(
        'SELECT 1 FROM notifications WHERE user_id = ? AND dedupe_key = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR) LIMIT 1',
        [id, dedupeKey, dedupeHours]);
      if (dup.length) continue;
    }
    await db.query(
      'INSERT INTO notifications (user_id, type, severity, title, message, link, dedupe_key) VALUES (?,?,?,?,?,?,?)',
      [id, type, severity, title, message, link, dedupeKey]);
    sent.push(id);
  }
  // Push after the caller commits (small delay is fine; clients refetch the list on this event).
  setTimeout(() => sent.forEach((uid) => realtime.toUser(uid, 'notification:new', { type, severity, title, message, link })), 150);
  return sent.length;
}

async function notifyUser(connOrPool, userId, { type, severity = 'info', title, message = null, link = null }) {
  await (connOrPool || pool).query(
    'INSERT INTO notifications (user_id, type, severity, title, message, link) VALUES (?,?,?,?,?,?)',
    [userId, type, severity, title, message, link]);
  setTimeout(() => realtime.toUser(userId, 'notification:new', { type, severity, title, message, link }), 150);
}

module.exports = { notifyPerms, notifyUser };
