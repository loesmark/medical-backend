/**
 * Centralized error handler — the LAST middleware in the stack.
 *
 * Converts every thrown/next(err)'d error into the standard envelope:
 *   { success: false, error: { code, message, details? } }
 *
 * - ApiError → exact status from err.status
 * - express-validator errors → 422 with field details
 * - SQLite UNIQUE constraint → 409 CONFLICT_EMAIL / CONFLICT_PHONE
 * - Anything else → 500 (no stack leaked to client in production)
 */

const config = require('../config');
const logger = require('../utils/logger');

// SQLite constraint code map (stable Flutter-facing codes)
function sqliteConstraintCode(err) {
  const msg = (err.message || '').toLowerCase();
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /unique/i.test(err.message)) {
    if (msg.includes('phone')) return { code: 'CONFLICT_PHONE', message: 'Phone number already registered.', status: 409 };
    if (msg.includes('patient_token')) return { code: 'CONFLICT_TOKEN', message: 'Patient token collision — please retry.', status: 409 };
    return { code: 'CONFLICT', message: 'A record with that value already exists.', status: 409 };
  }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { code: 'FK_VIOLATION', message: 'Referenced record does not exist.', status: 400 };
  }
  return null;
}

function notFound(req, _res, next) {
  next(require('../utils/ApiError').notFound('ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found.`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const ApiError = require('../utils/ApiError');

  // 1) Our own operational errors
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // 2) express-validator result flatten
  if (err && err.array && typeof err.array === 'function' && err.type === 'validation') {
    const details = err.array().map((e) => ({ field: e.path || e.param, message: e.msg, value: e.value }));
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'One or more fields failed validation.', details },
    });
  }

  // 3) SQLite constraint errors
  const sqlite = sqliteConstraintCode(err);
  if (sqlite) {
    return res.status(sqlite.status).json({
      success: false,
      error: { code: sqlite.code, message: sqlite.message },
    });
  }

  // 4) Multer file-size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: { code: 'FILE_TOO_LARGE', message: 'One of the uploaded files exceeds the size limit.' },
    });
  }

  // 5) Fallback — programmer / runtime error. Never leak internals in prod.
  logger.error('errorHandler', err.message, {
    stack: config.isProd ? undefined : err.stack,
    name: err.name,
  });
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong on the server. Please try again later.',
      ...(config.isDev ? { details: { name: err.name, message: err.message, stack: err.stack } } : {}),
    },
  });
}

module.exports = { notFound, errorHandler };
