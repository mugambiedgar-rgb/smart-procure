'use strict';
const path = require('path');
const dotenv = require('dotenv');

// Load the project-root .env first, then an optional server/.env override.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Vercel sets VERCEL_ENV for each deployment. Use it if NODE_ENV is absent.
const nodeEnv = process.env.NODE_ENV || (process.env.VERCEL_ENV === 'production' ? 'production' : 'development');
const isProd = nodeEnv === 'production';
const sslEnabled = process.env.TIDB_ENABLE_SSL === 'true' || (isProd && process.env.TIDB_ENABLE_SSL !== 'false');

const env = {
  nodeEnv,
  port: parseInt(process.env.PORT || '5000', 10),
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  db: {
    // Never silently fall back to localhost in production: Vercel cannot reach a developer's local DB.
    host: process.env.DB_HOST || (isProd ? '' : 'localhost'),
    port: parseInt(process.env.DB_PORT || (isProd ? '4000' : '3306'), 10),
    user: process.env.DB_USER || (isProd ? '' : 'root'),
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || (isProd ? '' : 'wholesale_procurement_db'),
    ssl: sslEnabled ? { minVersion: 'TLSv1.2' } : undefined,
  },
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
};
env.isProd = isProd;

if (env.isProd) {
  const missingDb = ['host', 'user', 'password', 'database'].filter((key) => !env.db[key]);
  if (missingDb.length) {
    console.error(`FATAL: Missing production database settings: ${missingDb.map((key) => 'DB_' + key.toUpperCase()).join(', ')}. Set them in the deployment environment.`);
    process.exit(1);
  }
}

if (!env.jwtSecret || env.jwtSecret.length < 16) {
  if (env.isProd) {
    console.error('FATAL: JWT_SECRET must be set (16+ characters) in production.');
    process.exit(1);
  }
  console.warn('[warn] JWT_SECRET is missing or too short - using an insecure development secret. Set it in .env.');
  env.jwtSecret = 'dev-only-insecure-secret-change-me';
}

module.exports = env;
