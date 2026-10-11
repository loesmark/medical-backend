/**
 * ConsultationController — patient create/list/get + admin respond/list.
 *
 * The same controller is mounted under /patient/consultations (patient role)
 * and /admin/consultations (admin role). Methods don't branch on role — the
 * route layer wires them to the right path with the right auth middleware.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const consultationService = require('../services/consultationService');

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
  // ── Patient ──
  create: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = consultationService.create({
      userId: req.user.id,
      type_id: req.body.type_id,
      custom_type: req.body.custom_type,
      reason: req.body.reason,
      category: req.body.category,
      attachment: maybeParseArray(req.body.attachment),
    });
    return created(res, data, 'Consultation created.');
  }),

  listMine: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const { consultations, total } = consultationService.listByUser(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, consultations, total, req, 'Your consultations.');
  }),

  getMine: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const row = consultationService.getById(req.params.id);
    if (row.patient_id !== req.user.id) {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'You can only access your own consultations.');
    }
    return ok(res, row, 'Consultation.');
  }),

  // ── Admin ──
  listAll: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status, category } = req.query;
    const { consultations, total } = consultationService.listAll({
      page: Number(page), limit: Number(limit),
      status, category,
    });
    return paginate(res, consultations, total, req, 'Consultations.');
  }),

  getAny: asyncHandler(async (req, res) => {
    const row = consultationService.getById(req.params.id, { includeJoined: true });
    return ok(res, row, 'Consultation.');
  }),

  respond: asyncHandler(async (req, res) => {
    check(req);
    const data = consultationService.respond(req.params.id, {
      response_text: req.body.response_text,
      recommended_action: req.body.recommended_action,
      follow_up_date: req.body.follow_up_date,
      attachment: maybeParseArray(req.body.attachment),
      actorId: req.user?.id,
      actorIp: req.ip,
    });
    return ok(res, data, 'Consultation responded.');
  }),
};
