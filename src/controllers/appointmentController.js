/**
 * AppointmentController — patient list-slots/request/list/cancel + admin
 * list/confirm/cancel.
 *
 * Working-hours / availability-status are also exposed here for the patient
 * (GET /patient/working-hours) and admin (GET/PUT /admin/working-hours +
 * PUT /admin/availability-status).
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const appointmentService = require('../services/appointmentService');

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
  listAvailableSlots: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = appointmentService.listAvailableSlots(req.user.id, { date: req.query.date });
    return ok(res, data, 'Available slots.');
  }),

  getWorkingHours: asyncHandler(async (req, res) => {
    // Patient-readable: list the doctor's recurring working hours
    return ok(res, appointmentService.listWorkingHours(), 'Doctor working hours.');
  }),

  request: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = appointmentService.request({
      userId: req.user.id,
      scheduled_date: req.body.scheduled_date,
      scheduled_time: req.body.scheduled_time,
      notes: req.body.notes,
    });
    return created(res, data, 'Appointment requested.');
  }),

  listMine: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const { appointments, total } = appointmentService.listByUser(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, appointments, total, req, 'Your appointments.');
  }),

  cancel: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = appointmentService.cancel({
      userId: req.user.id, appointmentId: req.params.id,
    });
    return ok(res, data, 'Appointment cancelled.');
  }),

  // ── Admin ──
  listAll: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status, date } = req.query;
    const { appointments, total } = appointmentService.listAll({
      page: Number(page), limit: Number(limit),
      status, date,
    });
    return paginate(res, appointments, total, req, 'Appointments.');
  }),

  confirm: asyncHandler(async (req, res) => {
    const data = appointmentService.confirm(req.params.id, {
      actorId: req.user?.id, actorIp: req.ip,
    });
    return ok(res, data, 'Appointment confirmed.');
  }),

  adminCancel: asyncHandler(async (req, res) => {
    const data = appointmentService.adminCancel(req.params.id, {
      actorId: req.user?.id, actorIp: req.ip,
    });
    return ok(res, data, 'Appointment cancelled.');
  }),

  // ── Admin: working hours ──
  listWorkingHours: asyncHandler(async (req, res) => {
    return ok(res, appointmentService.listWorkingHours(), 'Doctor working hours.');
  }),

  upsertWorkingHours: asyncHandler(async (req, res) => {
    const data = appointmentService.upsertWorkingHours({
      day_of_week: Number(req.body.day_of_week),
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      is_active: req.body.is_active !== undefined ? !!req.body.is_active : true,
    });
    return ok(res, data, 'Working hours saved.');
  }),

  // ── Admin: availability status ──
  getAvailabilityStatus: asyncHandler(async (req, res) => {
    return ok(res, appointmentService.getAvailabilityStatus(), 'Doctor availability status.');
  }),

  setAvailabilityStatus: asyncHandler(async (req, res) => {
    const data = appointmentService.setAvailabilityStatus(req.body.status);
    return ok(res, data, 'Doctor availability status updated.');
  }),
};
