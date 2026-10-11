/**
 * Authentication & Role-Based Access Control middleware.
 *
 *   authenticate  → verifies Bearer JWT, attaches req.user = { id, role, name }
 *   authorize(...roles) → 403 if role not allowed
 *   restrictToSelfOrAdmin → patient may access own resources, admin may access any
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const ApiError = require('../utils/ApiError');

function extractToken(req) {
  const header = req.header('Authorization') || req.header('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  // Flutter fallback: x-auth-token header
  if (req.header('X-Auth-Token')) return req.header('X-Auth-Token').trim();
  return null;
}

function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized('AUTH_REQUIRED', 'Authentication required.'));

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded; // { id, role, name }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('AUTH_TOKEN_EXPIRED', 'Your session has expired. Please log in again.'));
    }
    return next(ApiError.unauthorized('AUTH_TOKEN_INVALID', 'Invalid or malformed token.'));
  }
}

function authorize(...roles) {
  if (!roles.length) throw new Error('authorize() requires at least one role');
  return (req, _res, next) => {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('AUTH_REQUIRED', 'Authentication required.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('AUTH_FORBIDDEN', `Access denied. Requires role: ${roles.join(' or ')}.`));
    }
    next();
  };
}

// Patient may access their own profile; admin may access anyone's
function restrictToSelfOrAdmin(getUserIdParam = 'userId') {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === 'admin') return next();
    const targetId = req.params[getUserIdParam];
    if (req.user.id === targetId) return next();
    return next(ApiError.forbidden('AUTH_FORBIDDEN', 'You can only access your own resources.'));
  };
}

module.exports = { authenticate, authorize, restrictToSelfOrAdmin };
