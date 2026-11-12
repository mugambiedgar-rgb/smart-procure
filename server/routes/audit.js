'use strict';
const express = require('express');
const { pool } = require('../config/db');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

router.get('/', requirePerm('audit.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const where = []; const params = [];
  if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
  if (req.query.userId) { where.push('a.user_id = ?'); params.push(Number(req.query.userId)); }
  if (req.query.from) { where.push('a.created_at >= ?'); params.push(`${String(req.query.from).slice(0, 10)} 00:00:00`); }
  if (req.query.to) { where.push('a.created_at <= ?'); params.push(`${String(req.query.to).slice(0, 10)} 23:59:59`); }
  const [rows] = await pool.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.ip_address, a.created_at, u.full_name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${limit}`, params);
  const [actions] = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json({ actions: actions.map((a) => a.action), items: rows });
});

module.exports = router;
