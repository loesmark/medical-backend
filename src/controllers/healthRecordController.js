/**
 * HealthRecordController — add record (multipart) + list records.
 *
 * Attachments are uploaded via multipart/form-data (multer handles the field
 * parsing in the route layer); the controller passes the parsed body + the
 * multer memory-file array to the service.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const healthRecordService = require('../services/healthRecordService');

function check(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('validation');
    err.type = 'validation';
    err.array = () => errors.array();
    throw err;
  }
}

// Multipart body fields come through as strings; arrays come through as JSON
// strings (Flutter sends `symptoms` as JSON). Best-effort parse here.
function maybeParseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

module.exports = {
  addRecord: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = await healthRecordService.addRecord({
      userId: req.user.id,
      bp_systolic: req.body.bp_systolic ? Number(req.body.bp_systolic) : undefined,
      bp_diastolic: req.body.bp_diastolic ? Number(req.body.bp_diastolic) : undefined,
      heart_rate: req.body.heart_rate ? Number(req.body.heart_rate) : undefined,
      current_medications: req.body.current_medications,
      notes: req.body.notes,
      symptoms: maybeParseArray(req.body.symptoms),
      custom_symptom_text: req.body.custom_symptom_text,
      upload_mode: req.body.upload_mode,
      files: req.files || [],
    });
    return created(res, data, 'Health record added.');
  }),

  listRecords: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const { records, total } = healthRecordService.listRecords(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, records, total, req, 'Patient health records.');
  }),
};
