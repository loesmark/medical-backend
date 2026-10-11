/**
 * Standard RESTful response envelope used across every endpoint.
 *
 * Success: { success: true, data: ..., message: '...' }
 * Error  : { success: false, error: { code, message, details? } }
 *
 * Flutter clients can rely on `success` to branch, then read `data` or `error.message`.
 */

function ok(res, data = null, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, data, message });
}

function created(res, data = null, message = 'Created') {
  return res.status(201).json({ success: true, data, message });
}

function noContent(res, message = 'No Content') {
  // Still return an envelope so Flutter always sees JSON
  return res.status(200).json({ success: true, data: null, message });
}

function paginate(res, rows, total, req, message = 'OK') {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return res.status(200).json({
    success: true,
    data: rows,
    message,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}

module.exports = { ok, created, noContent, paginate };
