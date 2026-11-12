'use strict';
const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const unreadOnly = req.query.unread === '1' ? 'AND is_read = 0' : '';
  const [rows] = await pool.query(`SELECT id, type, severity, title, message, link, is_read, created_at FROM notifications WHERE user_id = ? ${unreadOnly} ORDER BY id DESC LIMIT ${limit}`, [req.user.id]);
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ unread, items: rows });
});

router.post('/read-all', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
});

router.post('/:id/read', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ message: 'Marked as read' });
});

module.exports = router;
