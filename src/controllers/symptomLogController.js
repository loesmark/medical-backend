/**
 * SymptomLogController — add log + list logs.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const symptomLogService = require('../services/symptomLogService');

function check(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('validation');
    err.type = 'validation';
    err.array = () => errors.array();
    throw err;
  }
}

function maybeParseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

module.exports = {
  addLog: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = symptomLogService.addLog({
      userId: req.user.id,
      symptoms: maybeParseArray(req.body.symptoms),
      custom_text: req.body.custom_text,
    });
    return created(res, data, 'Symptom log added.');
  }),

  listLogs: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const { logs, total } = symptomLogService.listLogs(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, logs, total, req, 'Symptom logs.');
  }),
};
