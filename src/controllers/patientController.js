/**
 * PatientController — thin HTTP layer over patientService.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const patientService = require('../services/patientService');

function check(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('validation');
    err.type = 'validation';
    err.array = () => errors.array();
    throw err;
  }
}

module.exports = {
  getProfile: asyncHandler(async (req, res) => {
    const data = patientService.getProfile(req.user.id);
    return ok(res, data, 'Patient profile.');
  }),

  addRecord: asyncHandler(async (req, res) => {
    check(req);
    const data = await patientService.addHealthRecord({
      userId: req.user.id,
      blood_pressure: req.body.blood_pressure,
      heart_rate: req.body.heart_rate,
      current_medications: req.body.current_medications,
      notes: req.body.notes,
      upload_mode: req.body.upload_mode,
      files: req.files || [],
    });
    return created(res, data, 'Health record added.');
  }),

  listRecords: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const { records, total } = patientService.listRecords(req.user.id, {
      page: Number(page),
      limit: Number(limit),
    });
    return paginate(res, records, total, req, 'Patient health records.');
  }),

  requestConsultation: asyncHandler(async (req, res) => {
    check(req);
    const data = patientService.requestConsultation({ userId: req.user.id, notes: req.body.notes });
    return created(res, data, 'Consultation requested.');
  }),
};
