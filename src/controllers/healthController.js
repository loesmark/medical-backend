/**
 * HealthController — `/api/v1/health` and `/health` aliases.
 * Returns DB + uptime + version info. Used by load balancers & uptime monitors.
 */

const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const db = require('../db');
const config = require('../config');

const startedAt = Date.now();

module.exports = {
  check: asyncHandler(async (req, res) => {
    // Quick DB ping
    let dbStatus = 'ok';
    try {
      db.prepare('SELECT 1').get();
    } catch (err) {
      dbStatus = `error: ${err.message}`;
    }
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return ok(
      res,
      {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        uptime_seconds: uptimeSeconds,
        db: dbStatus,
        version: '2.0.0',
        env: config.env,
        timestamp: new Date().toISOString(),
      },
      'Service healthy.'
    );
  }),
};
