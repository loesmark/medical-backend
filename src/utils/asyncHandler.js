/**
 * asyncHandler — wraps an async route handler so rejected promises
 * are forwarded to Express's error pipeline instead of crashing the process.
 *
 * Usage: router.get('/x', asyncHandler(async (req,res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
