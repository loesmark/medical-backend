/**
 * Request logger — writes every API request to `request_logs`.
 * Powers the dashboard's "total requests" and "HTTP status breakdown" widgets.
 *
 * Also logs a structured line to the console via morgan-style format in dev.
 *
 * Insertion is fire-and-forget: a write error never blocks the response.
 */

const db = require('../db');
const logger = require('../utils/logger');

function getIp(req) {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

// Skip logging for static admin assets & health pings (too noisy)
function shouldSkip(req) {
  if (req.path.startsWith('/admin') || req.path.startsWith('/health')) return false; // keep these
  return false;
}

function log(req, res, durationMs) {
  try {
    db.prepare(
      `INSERT INTO request_logs (method, path, status, duration_ms, user_id, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.method,
      truncate(req.path, 200),
      res.statusCode,
      Math.round(durationMs),
      req.user?.id || null,
      truncate(getIp(req), 64),
      truncate(req.header('user-agent'), 200)
    );
  } catch (err) {
    logger.warn('requestLogger', `Failed to log request: ${err.message}`);
  }
}

// Express middleware that times the request and writes the log on finish/close.
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  const done = () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (!shouldSkip(req)) log(req, res, ms);
    res.removeListener('finish', done);
    res.removeListener('close', done);
  };
  res.on('finish', done);
  res.on('close', done);
  next();
}

module.exports = { requestLogger };
