/**
 * TreatmentPlanController — patient get/list-versions + admin create/list-by-patient.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const treatmentPlanService = require('../services/treatmentPlanService');

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
  // ── Patient ──
  getCurrent: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = treatmentPlanService.getCurrentForPatient(req.user.id);
    return ok(res, data, 'Current treatment plan.');
  }),

  listVersions: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const data = treatmentPlanService.listVersions(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, data.versions, data.total, req, 'Treatment plan versions.');
  }),

  // ── Admin ──
  adminGetCurrent: asyncHandler(async (req, res) => {
    const data = treatmentPlanService.getCurrentForPatient(req.params.userId);
    return ok(res, data, 'Current treatment plan.');
  }),

  adminListVersions: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const data = treatmentPlanService.listVersionsForPatient(req.params.userId, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, data.versions, data.total, req, 'Treatment plan versions.');
  }),

  adminCreate: asyncHandler(async (req, res) => {
    check(req);
    const data = treatmentPlanService.create({
      patient_id: req.params.userId,
      admin_id: req.user.id,
      recommended_medications: req.body.recommended_medications,
      instructions: req.body.instructions,
      follow_up_dates: req.body.follow_up_dates,
      clinical_notes: req.body.clinical_notes,
      actorId: req.user.id,
      actorIp: req.ip,
    });
    return created(res, data, 'Treatment plan created.');
  }),
};
