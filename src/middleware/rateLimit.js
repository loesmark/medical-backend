/**
 * Rate limiters — different limits for different surfaces.
 *
 *   - authLimiter   : protects login/register from credential stuffing
 *   - backupLimiter : STRICT — protects DB-download brute force (3 / 15min per IP)
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts. Please try again later.',
    },
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
  },
});

const backupLimiter = rateLimit({
  windowMs: config.backup.rateLimitWindowMs,
  max: config.backup.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  // Key on IP only — admin must enter passcode each time anyway
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
  message: {
    success: false,
    error: {
      code: 'BACKUP_RATE_LIMITED',
      message: `Too many database download attempts. Limit is ${config.backup.rateLimitMax} per ${Math.round(config.backup.rateLimitWindowMs / 60000)} minutes.`,
    },
  },
});

module.exports = { authLimiter, apiLimiter, backupLimiter };
