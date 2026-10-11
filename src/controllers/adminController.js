/**
 * AdminController — thin HTTP layer over adminService + metricsService.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, paginate } = require('../utils/response');
const adminService = require('../services/adminService');
const metricsService = require('../services/metricsService');
const patientDocumentService = require('../services/patientDocumentService');
const consultationService = require('../services/consultationService');
const appointmentService = require('../services/appointmentService');
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
  metrics: asyncHandler(async (req, res) => {
    return ok(res, metricsService.getSnapshot(), 'Server metrics.');
  }),

  listPatients: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search = null, sort = 'created_at' } = req.query;
    const { patients, total } = adminService.listPatients({
      page: Number(page),
      limit: Number(limit),
      search,
      sort,
    });
    return paginate(res, patients, total, req, 'Patients list.');
  }),

  getUserDetail: asyncHandler(async (req, res) => {
    const data = adminService.getUserDetail(req.params.userId);
    return ok(res, data, 'User detail.');
  }),

  listUserRecords: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const { records, total } = adminService.listUserRecords(req.params.userId, {
      page: Number(page),
      limit: Number(limit),
    });
    return paginate(res, records, total, req, 'Patient records.');
  }),

  // NEW: recent records across all patients (Recent Cases view)
  recentRecords: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const data = adminService.recentRecords({ page: Number(page), limit: Number(limit) });
    return paginate(res, data.records, data.total, req, 'Recent records across all patients.');
  }),

  // NEW: patient medical summary (latest reading + trends + totals)
  patientSummary: asyncHandler(async (req, res) => {
    const data = adminService.patientSummary(req.params.userId);
    return ok(res, data, 'Patient medical summary.');
  }),

  changeRole: asyncHandler(async (req, res) => {
    check(req);
    const data = adminService.changeUserRole({
      targetUserId: req.params.id,
      role: req.body.role,
      actorId: req.user.id,
      actorIp: req.ip,
    });
    return ok(res, data, 'User role updated.');
  }),

  changeStatus: asyncHandler(async (req, res) => {
    check(req);
    const data = adminService.changeUserStatus({
      targetUserId: req.params.id,
      status: req.body.status,
      actorId: req.user.id,
      actorIp: req.ip,
    });
    return ok(res, data, 'User status updated.');
  }),

  deleteUser: asyncHandler(async (req, res) => {
    const data = adminService.deleteUser({
      targetUserId: req.params.id,
      actorId: req.user.id,
      actorIp: req.ip,
    });
    return ok(res, data, 'User deleted.');
  }),

  getSettings: asyncHandler(async (req, res) => {
    return ok(res, adminService.getSettings(), 'Settings.');
  }),

  updateSettings: asyncHandler(async (req, res) => {
    const data = adminService.updateSettings(req.body);
    return ok(res, data, 'Settings saved.');
  }),

  getLogs: asyncHandler(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const data = adminService.getRecentRequests({ page: Number(page), limit: Number(limit) });
    return paginate(res, data.logs, data.total, req, 'Recent API logs.');
  }),

  getStatusBreakdown: asyncHandler(async (req, res) => {
    return ok(res, adminService.getStatusBreakdown(), 'HTTP status breakdown.');
  }),

  getTopEndpoints: asyncHandler(async (req, res) => {
    return ok(res, adminService.getTopEndpoints(), 'Top endpoints.');
  }),

  // ── Per-patient deep dives (new v3 resources) ──
  listPatientDocuments: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const { documents, total } = patientDocumentService.listDocumentsByUserId(req.params.userId, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, documents, total, req, 'Patient documents.');
  }),

  listPatientConsultations: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const { consultations, total } = consultationService.listByUser(req.params.userId, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, consultations, total, req, 'Patient consultations.');
  }),

  listPatientAppointments: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const { appointments, total } = appointmentService.listByUser(req.params.userId, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, appointments, total, req, 'Patient appointments.');
  }),

  getPatientTreatmentPlan: asyncHandler(async (req, res) => {
    const data = treatmentPlanService.getCurrentForPatient(req.params.userId);
    return ok(res, data, 'Current treatment plan.');
  }),

  listPatientTreatmentPlanVersions: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const data = treatmentPlanService.listVersionsForPatient(req.params.userId, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, data.versions, data.total, req, 'Treatment plan versions.');
  }),
};
