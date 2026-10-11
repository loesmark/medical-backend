/**
 * ApiError — throwable error carrying an HTTP status and machine-readable code.
 * The central error handler converts it to the standard error envelope.
 *
 * `code` is a stable string Flutter can switch on (e.g. 'AUTH_INVALID_CREDENTIALS').
 */
class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true; // distinguish from programmer errors
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code = 'AUTH_REQUIRED', message = 'Authentication required.') {
    return new ApiError(401, code, message);
  }
  static forbidden(code = 'AUTH_FORBIDDEN', message = 'Access denied.') {
    return new ApiError(403, code, message);
  }
  static notFound(code = 'NOT_FOUND', message = 'Resource not found.') {
    return new ApiError(404, code, message);
  }
  static conflict(code = 'CONFLICT', message = 'Resource already exists.') {
    return new ApiError(409, code, message);
  }
  static tooMany(code = 'RATE_LIMITED', message = 'Too many requests.') {
    return new ApiError(429, code, message);
  }
  static internal(code = 'INTERNAL', message = 'Something went wrong.', details) {
    return new ApiError(500, code, message, details);
  }
}

module.exports = ApiError;
