'use strict';
const path = require('path');
const dotenv = require('dotenv');

// Load the project-root .env first, then an optional server/.env override.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wholesale_procurement_db',
  },
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
};
env.isProd = env.nodeEnv === 'production';

if (!env.jwtSecret || env.jwtSecret.length < 16) {
  if (env.isProd) {
    console.error('FATAL: JWT_SECRET must be set (16+ characters) in production.');
    process.exit(1);
  }
  console.warn('[warn] JWT_SECRET is missing or too short - using an insecure development secret. Set it in .env.');
  env.jwtSecret = 'dev-only-insecure-secret-change-me';
}

module.exports = env;
