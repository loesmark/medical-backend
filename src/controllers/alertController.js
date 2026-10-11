/**
 * AlertController — admin threshold CRUD + alert list / unread-count / read / resolve.
 *
 * Mounted under /admin/thresholds + /admin/alerts.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate, noContent } = require('../utils/response');
const alertService = require('../services/alertService');
const audit = require('../middleware/auditLog');

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
  // ── Thresholds (admin) ──
  listThresholds: asyncHandler(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const data = alertService.listThresholds({ page: Number(page), limit: Number(limit) });
    return paginate(res, data.thresholds, data.total, req, 'Alert thresholds.');
  }),

  createThreshold: asyncHandler(async (req, res) => {
    check(req);
    const item = alertService.createThreshold({
      adminId: req.user.id,
      parameter_name: req.body.parameter_name,
      warning_value: req.body.warning_value,
      critical_value: req.body.critical_value,
      operator: req.body.operator,
      is_active: req.body.is_active,
    });
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'THRESHOLD_CREATE', target: item.id, status: 'success',
      meta: { parameter_name: item.parameter_name },
    });
    return created(res, item, 'Threshold created.');
  }),

  updateThreshold: asyncHandler(async (req, res) => {
    check(req);
    const item = alertService.updateThreshold(req.params.id, {
      parameter_name: req.body.parameter_name,
      warning_value: req.body.warning_value,
      critical_value: req.body.critical_value,
      operator: req.body.operator,
      is_active: req.body.is_active,
    });
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'THRESHOLD_UPDATE', target: req.params.id, status: 'success',
    });
    return ok(res, item, 'Threshold updated.');
  }),

  deleteThreshold: asyncHandler(async (req, res) => {
    const result = alertService.deleteThreshold(req.params.id);
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'THRESHOLD_DELETE', target: req.params.id, status: 'success',
    });
    return noContent(res, 'Threshold deleted.');
  }),

  // ── Alerts (admin) ──
  listAlerts: asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, status, severity, patient_id } = req.query;
    const data = alertService.listAlerts({
      page: Number(page), limit: Number(limit),
      status, severity, patient_id,
    });
    return paginate(res, data.alerts, data.total, req, 'Alerts.');
  }),

  unreadCount: asyncHandler(async (req, res) => {
    return ok(res, alertService.unreadCount(), 'Unread alert count.');
  }),

  markRead: asyncHandler(async (req, res) => {
    return ok(res, alertService.markRead(req.params.id), 'Alert marked as read.');
  }),

  markResolved: asyncHandler(async (req, res) => {
    const data = alertService.markResolved(req.params.id, {
      actorId: req.user.id, actorIp: req.ip,
    });
    return ok(res, data, 'Alert resolved.');
  }),
};
