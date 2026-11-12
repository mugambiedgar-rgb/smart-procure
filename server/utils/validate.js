'use strict';
const { badRequest } = require('./errors');

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function str(v, name, { required = false, min = 0, max = 255 } = {}) {
  if (isBlank(v)) { if (required) throw badRequest(`${name} is required`); return null; }
  const s = String(v).trim();
  if (s.length < min) throw badRequest(`${name} must be at least ${min} characters`);
  if (s.length > max) throw badRequest(`${name} must be at most ${max} characters`);
  return s;
}
function int(v, name, { required = false, min = 0, max = 2147483647 } = {}) {
  if (isBlank(v)) { if (required) throw badRequest(`${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest(`${name} must be a whole number`);
  if (n < min) throw badRequest(`${name} must be at least ${min}`);
  if (n > max) throw badRequest(`${name} must be at most ${max}`);
  return n;
}
function money(v, name, { required = false, min = 0, max = 99999999 } = {}) {
  if (isBlank(v)) { if (required) throw badRequest(`${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`${name} must be a number`);
  if (n < min) throw badRequest(`${name} must be at least ${min}`);
  if (n > max) throw badRequest(`${name} is too large`);
  return Math.round(n * 100) / 100;
}
function email(v, name = 'Email', { required = false } = {}) {
  const s = str(v, name, { required, max: 150 });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`${name} is not a valid email address`);
  return s ? s.toLowerCase() : null;
}
function date(v, name, { required = false } = {}) {
  if (isBlank(v)) { if (required) throw badRequest(`${name} is required`); return null; }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw badRequest(`${name} must be a valid date (YYYY-MM-DD)`);
  return s;
}
function oneOf(v, name, allowed, { required = false } = {}) {
  if (isBlank(v)) { if (required) throw badRequest(`${name} is required`); return null; }
  if (!allowed.includes(v)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
}
function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def ? 1 : 0;
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}
function password(v, name = 'Password') {
  const s = str(v, name, { required: true, min: 8, max: 100 });
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw badRequest(`${name} must contain at least one letter and one number`);
  return s;
}
/** Validates an array of line items. Each line needs a unique positive productId. */
function lines(v, name = 'Items', { max = 100 } = {}) {
  if (!Array.isArray(v) || v.length === 0) throw badRequest(`${name}: add at least one product`);
  if (v.length > max) throw badRequest(`${name}: too many lines (max ${max})`);
  return v;
}

module.exports = { str, int, money, email, date, oneOf, bool, password, lines, isBlank };
