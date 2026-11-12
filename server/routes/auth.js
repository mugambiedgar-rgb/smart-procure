'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { pool } = require('../config/db');
const { signToken, authenticate } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { badRequest, unauthorized, conflict } = require('../utils/errors');
const v = require('../utils/validate');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

const publicUser = (u, permissions) => ({
  id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, role: u.role, permissions,
});

router.post('/login', authLimiter, async (req, res) => {
  const emailAddr = v.email(req.body.email, 'Email', { required: true });
  const pwd = v.str(req.body.password, 'Password', { required: true, max: 100 });
  const [rows] = await pool.query(
    'SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?', [emailAddr]);
  const user = rows[0];
  // Same message for unknown user / wrong password / disabled account (no user enumeration).
  const ok = user && user.is_active && await bcrypt.compare(pwd, user.password_hash);
  if (!ok) {
    await audit(pool, { ip: req.ip }, 'LOGIN_FAILED', 'user', user ? user.id : null, { email: emailAddr });
    throw unauthorized('Invalid email or password');
  }
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const [perms] = await pool.query(
    'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', [user.role_id]);
  await audit(pool, { userId: user.id, ip: req.ip }, 'LOGIN', 'user', user.id);
  res.json({ token: signToken(user), user: publicUser(user, perms.map((p) => p.code)) });
});

// Self-service registration (used by the Sign up and Create account pages). New accounts are always given the
// read-only "Viewer" role, so nobody can pick or escalate their own privileges; an Administrator can change
// the role later from the Users page. The role is created on first use if it does not exist yet.
const VIEWER_PERMS = ['dashboard.view', 'products.view', 'inventory.view', 'suppliers.view', 'customers.view', 'orders.view'];
async function viewerRoleId() {
  const [[found]] = await pool.query("SELECT id FROM roles WHERE name = 'Viewer'");
  if (found) return found.id;
  try {
    const [r] = await pool.query("INSERT INTO roles (name, description) VALUES ('Viewer', 'Read-only access (self-registered accounts)')");
    const [perms] = await pool.query('SELECT id FROM permissions WHERE code IN (?)', [VIEWER_PERMS]);
    if (perms.length) await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [perms.map((p) => [r.insertId, p.id])]);
    return r.insertId;
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    const [[again]] = await pool.query("SELECT id FROM roles WHERE name = 'Viewer'");
    return again.id;
  }
}

router.post('/register', authLimiter, async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Full name', { required: true, min: 2, max: 120 });
  const emailAddr = v.email(req.body.email, 'Email', { required: true });
  const phone = v.str(req.body.phone, 'Phone', { max: 30 });
  if (phone && !/^[0-9+()\-\s.]{6,30}$/.test(phone)) throw badRequest('Phone number is not valid');
  const pwd = v.password(req.body.password, 'Password');
  const [[exists]] = await pool.query('SELECT id FROM users WHERE email = ?', [emailAddr]);
  if (exists) throw conflict('An account with this email already exists. Try signing in instead.');
  const roleId = await viewerRoleId();
  const hash = await bcrypt.hash(pwd, env.bcryptRounds);
  let id;
  try {
    const [r] = await pool.query('INSERT INTO users (full_name, email, password_hash, role_id, phone) VALUES (?, ?, ?, ?, ?)',
      [fullName, emailAddr, hash, roleId, phone]);
    id = r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw conflict('An account with this email already exists. Try signing in instead.');
    throw e;
  }
  await audit(pool, { userId: id, ip: req.ip }, 'USER_REGISTERED', 'user', id, { email: emailAddr });
  const [[user]] = await pool.query('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  const [perms] = await pool.query(
    'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', [roleId]);
  res.status(201).json({ token: signToken(user), user: publicUser(user, perms.map((p) => p.code)) });
});

router.post('/logout', authenticate, async (req, res) => {
  await audit(pool, req, 'LOGOUT', 'user', req.user.id);
  res.json({ message: 'Signed out' });
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user, req.user.permissions) }));

router.put('/me', authenticate, async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Full name', { required: true, min: 2, max: 120 });
  const phone = v.str(req.body.phone, 'Phone', { max: 30 });
  await pool.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [fullName, phone, req.user.id]);
  await audit(pool, req, 'PROFILE_UPDATED', 'user', req.user.id);
  res.json({ user: publicUser({ ...req.user, full_name: fullName, phone }, req.user.permissions) });
});

router.put('/me/password', authenticate, async (req, res) => {
  const current = v.str(req.body.currentPassword, 'Current password', { required: true, max: 100 });
  const next = v.password(req.body.newPassword, 'New password');
  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, row.password_hash))) throw badRequest('Current password is incorrect');
  const hash = await bcrypt.hash(next, env.bcryptRounds);
  // Bumping token_version signs out every other session of this user.
  await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.user.id]);
  await audit(pool, req, 'PASSWORD_CHANGED', 'user', req.user.id);
  const [[u]] = await pool.query('SELECT id, token_version FROM users WHERE id = ?', [req.user.id]);
  res.json({ message: 'Password updated', token: signToken(u) });
});

// Forgot password: always answers the same way. No mail server is bundled, so outside production the
// reset link is returned in the response (and printed in the server console) to make the flow testable.
router.post('/forgot-password', authLimiter, async (req, res) => {
  const emailAddr = v.email(req.body.email, 'Email', { required: true });
  const generic = { message: 'If that email address is registered, a password reset link has been generated.' };
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? AND is_active = 1', [emailAddr]);
  if (!rows.length) return res.json(generic);
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('UPDATE users SET reset_token_hash = ?, reset_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [hash, rows[0].id]);
  await audit(pool, { ip: req.ip }, 'PASSWORD_RESET_REQUESTED', 'user', rows[0].id);
  const link = `${env.clientOrigin[0]}/reset-password?token=${token}`;
  if (!env.isProd) {
    console.log(`[password reset] ${emailAddr}: ${link}`);
    return res.json({ ...generic, devResetLink: link, devNote: 'Development mode: no email server is configured, so the link is shown here.' });
  }
  // TODO (production): send `link` to the user's email address with your mail provider (e.g. nodemailer).
  res.json(generic);
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const token = v.str(req.body.token, 'Reset token', { required: true, max: 200 });
  const next = v.password(req.body.password, 'New password');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.query('SELECT id FROM users WHERE reset_token_hash = ? AND reset_expires_at > NOW() AND is_active = 1', [hash]);
  if (!rows.length) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  const pwHash = await bcrypt.hash(next, env.bcryptRounds);
  await pool.query('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, token_version = token_version + 1 WHERE id = ?', [pwHash, rows[0].id]);
  await audit(pool, { userId: rows[0].id, ip: req.ip }, 'PASSWORD_RESET', 'user', rows[0].id);
  res.json({ message: 'Password reset successfully. You can now sign in.' });
});

module.exports = router;
