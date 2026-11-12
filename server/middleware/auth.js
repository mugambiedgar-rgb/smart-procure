'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/db');
const { unauthorized, forbidden } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

/** Loads a user (+ role + permissions) for a verified token. Returns null if invalid/inactive. */
async function loadUserFromToken(token) {
  let payload;
  try { payload = jwt.verify(token, env.jwtSecret); } catch (_) { return null; }
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.token_version, u.role_id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [payload.sub]);
  const u = rows[0];
  if (!u || !u.is_active || u.token_version !== payload.tv) return null;
  const [perms] = await pool.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`, [u.role_id]);
  u.permissions = perms.map((p) => p.code);
  return u;
}

async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const user = await loadUserFromToken(token);
  if (!user) throw unauthorized('Session expired or invalid. Please sign in again.');
  req.user = user;
  next();
}

/** Allow the request if the user holds ANY of the listed permission codes. */
const requirePerm = (...codes) => (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (!codes.some((c) => req.user.permissions.includes(c))) throw forbidden();
  next();
};
const can = (user, code) => user.permissions.includes(code);

module.exports = { signToken, loadUserFromToken, authenticate, requirePerm, can };
