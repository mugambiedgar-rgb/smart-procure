'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { pool } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { badRequest, notFound } = require('../utils/errors');
const v = require('../utils/validate');

const router = express.Router();
router.use(requirePerm('users.manage'));

router.get('/roles', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, description FROM roles ORDER BY id');
  res.json(rows);
});

router.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at, r.id AS role_id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body;
  const fullName = v.str(b.fullName, 'Full name', { required: true, min: 2, max: 120 });
  const email = v.email(b.email, 'Email', { required: true });
  const roleId = v.int(b.roleId, 'Role', { required: true, min: 1 });
  const phone = v.str(b.phone, 'Phone', { max: 30 });
  const pwd = v.password(b.password);
  const hash = await bcrypt.hash(pwd, env.bcryptRounds);
  const [r] = await pool.query('INSERT INTO users (full_name, email, password_hash, role_id, phone) VALUES (?,?,?,?,?)', [fullName, email, hash, roleId, phone]);
  await audit(pool, req, 'USER_CREATED', 'user', r.insertId, { email, roleId });
  res.status(201).json({ id: r.insertId, message: 'User created' });
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id); const b = req.body;
  const fullName = v.str(b.fullName, 'Full name', { required: true, min: 2, max: 120 });
  const roleId = v.int(b.roleId, 'Role', { required: true, min: 1 });
  const phone = v.str(b.phone, 'Phone', { max: 30 });
  const isActive = v.bool(b.isActive, true);
  if (id === req.user.id && (!isActive || roleId !== req.user.role_id)) throw badRequest('You cannot deactivate your own account or change your own role.');
  const [r] = await pool.query(
    'UPDATE users SET full_name = ?, role_id = ?, phone = ?, is_active = ?, token_version = token_version + 1 WHERE id = ?', [fullName, roleId, phone, isActive, id]);
  if (!r.affectedRows) throw notFound('User not found');
  await audit(pool, req, 'USER_UPDATED', 'user', id, { roleId, isActive });
  res.json({ message: 'User updated' });
});

router.post('/:id/reset-password', async (req, res) => {
  const id = Number(req.params.id);
  const pwd = v.password(req.body.password);
  const hash = await bcrypt.hash(pwd, env.bcryptRounds);
  const [r] = await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, id]);
  if (!r.affectedRows) throw notFound('User not found');
  await audit(pool, req, 'USER_PASSWORD_RESET', 'user', id);
  res.json({ message: 'Password reset' });
});

module.exports = router;
