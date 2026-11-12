'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const env = require('./config/env');
const { pool } = require('./config/db');
const { authenticate, loadUserFromToken } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const realtime = require('./utils/realtime');
const { startAlertScanner } = require('./services/alertScanner');
const sales = require('./routes/sales');

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// CORS applies to the API only. Allowed: configured client origins (CLIENT_ORIGIN) and same-origin requests
// (when Express serves the built React app, the browser sends Origin = this server's own address).
app.use('/api', cors((req, cb) => {
  const origin = req.headers.origin;
  let sameOrigin = false;
  try { sameOrigin = !!origin && new URL(origin).host === req.headers.host; } catch (_) { /* malformed origin */ }
  cb(null, { origin: !origin || sameOrigin || env.clientOrigin.includes(origin), credentials: true });
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests. Please slow down.' } }));

// ---------------------------------------------------------------- public routes
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (e) { res.status(503).json({ status: 'error', database: 'unreachable' }); }
});
// Aggregate numbers only (no business detail) for the public home page.
app.get('/api/public/overview', async (_req, res) => {
  const [[r]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products, (SELECT COUNT(*) FROM suppliers WHERE is_active = 1) AS suppliers,
            (SELECT COALESCE(SUM(physical_qty),0) FROM inventory) AS units, (SELECT COUNT(*) FROM inventory_transactions) AS movements`);
  res.json(r);
});
app.use('/api/auth', require('./routes/auth'));

// ---------------------------------------------------------------- protected routes
app.use('/api', authenticate);
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/products', require('./routes/products'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/requisitions', require('./routes/requisitions'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/grn', require('./routes/grn'));
app.use('/api/reconciliations', require('./routes/reconciliations'));
app.use('/api/customers', sales.customers);
app.use('/api/orders', sales.orders);
app.use('/api/deliveries', sales.deliveries);
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api', notFoundHandler);

// ---------------------------------------------------------------- production: serve the built React app
const dist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

// ---------------------------------------------------------------- Socket.IO (real-time inventory + notifications)
const io = new Server(server, { cors: { origin: env.clientOrigin, credentials: true } });
realtime.init(io);
io.use(async (socket, next) => {
  const user = await loadUserFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
});
io.on('connection', (socket) => { socket.join(`user:${socket.data.user.id}`); });

server.listen(env.port, async () => {
  console.log(`SmartProcure API listening on http://localhost:${env.port}`);
  try { await pool.query('SELECT 1'); console.log(`Connected to MySQL database "${env.db.database}"`); startAlertScanner(); }
  catch (e) { console.error(`\nCould not connect to MySQL (${e.code || e.message}). Check DB_* values in .env and run "npm run db:setup".\n`); }
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
