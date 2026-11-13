'use strict';
/**
 * Creates wholesale_procurement_db, its tables and (when empty) the sample data.
 *   npm run db:setup   - create schema if missing, load seed data if the DB is empty
 *   npm run db:reset   - DROP the database and rebuild it from scratch
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

(async () => {
  const reset = process.argv.includes('--reset');
  const conn = await mysql.createConnection({
    host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password,
    ssl: env.db.ssl,
    multipleStatements: true,
  });
  try {
    if (reset) {
      console.log(`Dropping database ${env.db.database} ...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${env.db.database}\``);
    }
    const dbDir = path.resolve(__dirname, '../../database');
    console.log('Applying schema.sql ...');
    await conn.query(fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8'));
    await conn.query(`USE \`${env.db.database}\``);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM roles');
    if (n === 0) {
      console.log('Loading seed.sql (sample data) ...');
      await conn.query(fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8'));
      console.log('Sample data loaded.');
    } else {
      console.log('Database already contains data - seed skipped (use "npm run db:reset" to start over).');
    }
    console.log('\nDone. Demo login: admin@smartprocure.com / Password@123');
  } catch (err) {
    console.error('\nDatabase setup failed:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
