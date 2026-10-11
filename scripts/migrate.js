/**
 * scripts/migrate.js
 * Re-applies the schema (idempotent — `CREATE TABLE IF NOT EXISTS`).
 * Add ALTER statements under a version check as the schema evolves.
 *
 * Usage:  npm run db:migrate
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/db');
const logger = require('../src/utils/logger');

try {
  db.applySchema();
  logger.info('migrate', 'Schema applied successfully.');
} catch (err) {
  logger.error('migrate', `Migration failed: ${err.message}`);
  process.exit(1);
} finally {
  db.closeDatabase();
  process.exit(0);
}
