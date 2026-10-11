/**
 * Admin routes — /api/v1/admin/*   (auth: admin)
 *
 *   Metrics:
 *     GET  /metrics                            → server snapshot
 *
 *   User management:
 *     GET    /patients?page=&limit=&search=
 *     GET    /users/:userId
 *     GET    /patients/:userId/records
 *     GET    /patients/:userId/summary
 *     GET    /patients/:userId/documents
 *     GET    /patients/:userId/consultations
 *     GET    /patients/:userId/appointments
 *     GET    /patients/:userId/treatment-plan
 *     POST   /patients/:userId/treatment-plan
 *     GET    /patients/:userId/treatment-plan/versions
 *     PATCH  /users/:id/role                    { role }
 *     PATCH  /users/:id/status                 { status }
 *     DELETE /users/:id
 *
 *   Catalogs (CRUD for diseases|surgeries|symptoms|medications|consultation_types):
 *     GET/POST/PUT/DELETE  /catalogs/:catalog[/:id]
 *
 *   Thresholds + alerts:
 *     GET/POST/PUT/DELETE  /thresholds[/:id]
 *     GET  /alerts                              → list (filters: ?status=&severity=&patient_id=)
 *     GET  /alerts/unread-count
 *     PATCH /alerts/:id/read
 *     PATCH /alerts/:id/resolve
 *
 *   Working hours + availability status:
 *     GET  /working-hours
 *     PUT  /working-hours                       { day_of_week, start_time, end_time, is_active? }
 *     GET  /availability-status
 *     PUT  /availability-status                 { status: available|unavailable|busy }
 *
 *   Consultations (admin view):
 *     GET  /consultations                       → list all
 *     GET  /consultations/:id                   → get any
 *     PATCH /consultations/:id/respond          { response_text?, recommended_action?, follow_up_date?, attachment? }
 *
 *   Appointments (admin view):
 *     GET  /appointments                        → list all (filters: ?status=&date=)
 *     PATCH /appointments/:id/confirm           → confirm + generate whatsapp_link
 *     PATCH /appointments/:id/cancel            → cancel
 *
 *   Settings:
 *     GET /settings
 *     PUT /settings
 *     POST /settings/test-telegram              { token, chat_id }
 *
 *   Logs:
 *     GET  /logs?page=&limit=
 *     GET  /logs/status-breakdown
 *     GET  /logs/top-endpoints
 *     GET  /audit-logs?page=&limit=&action=
 *
 *   Backup (SECURE):
 *     GET  /backup-db/info
 *     POST /backup-db                           { passcode }  → streams the snapshot file
 *
 *   Telegram file proxy:
 *     GET  /telegram-file/:fileId
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { apiLimiter, backupLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const adminValidator = require('../validators/adminValidator');
const audit = require('../middleware/auditLog');

const adminController = require('../controllers/adminController');
const backupController = require('../controllers/backupController');
const telegramFileController = require('../controllers/telegramFileController');
const telegramService = require('../services/telegramService');

const catalogController = require('../controllers/catalogController');
const catalogService = require('../services/catalogService');
const { upsert: catalogUpsert } = require('../validators/catalogValidator');

const alertController = require('../controllers/alertController');
const { upsert: thresholdUpsert } = require('../validators/thresholdValidator');

const treatmentPlanController = require('../controllers/treatmentPlanController');
const { create: treatmentPlanCreate } = require('../validators/treatmentPlanValidator');

const { adminRouter: consultationRoutes } = require('./consultations');
const { adminRouter: appointmentRoutes } = require('./appointments');

// All admin routes require JWT + ROLE_ADMIN
router.use(authenticate, authorize('admin'), apiLimiter);

// ── Metrics ──
router.get('/metrics', adminController.metrics);

// ── Recent cases (latest records across all patients) ──
router.get('/recent-records', adminController.recentRecords);

// ── User management ──
router.get('/patients', adminController.listPatients);
router.get('/users/:userId', adminController.getUserDetail);
router.get('/patients/:userId/records', adminController.listUserRecords);
router.get('/patients/:userId/summary', adminController.patientSummary);

// ── Per-patient deep dives (new v3 resources) ──
router.get('/patients/:userId/documents', adminController.listPatientDocuments);
router.get('/patients/:userId/consultations', adminController.listPatientConsultations);
router.get('/patients/:userId/appointments', adminController.listPatientAppointments);
router.get('/patients/:userId/treatment-plan', treatmentPlanController.adminGetCurrent);
router.post('/patients/:userId/treatment-plan', treatmentPlanCreate, treatmentPlanController.adminCreate);
router.get('/patients/:userId/treatment-plan/versions', treatmentPlanController.adminListVersions);

router.patch('/users/:id/role', adminValidator.changeRole, adminController.changeRole);
router.patch('/users/:id/status', adminValidator.changeStatus, adminController.changeStatus);
router.delete('/users/:id', adminController.deleteUser);

// ── Catalogs (CRUD for 5 catalogs) ──
router.get('/catalogs', (req, res) => ok(res, catalogService.CATALOGS, 'Available catalogs.'));
router.get('/catalogs/:catalog', catalogController.list);
router.get('/catalogs/:catalog/:id', catalogController.getOne);
router.post('/catalogs/:catalog', catalogUpsert, catalogController.create);
router.put('/catalogs/:catalog/:id', catalogUpsert, catalogController.update);
router.delete('/catalogs/:catalog/:id', catalogController.remove);

// ── Thresholds + alerts ──
router.get('/thresholds', alertController.listThresholds);
router.post('/thresholds', thresholdUpsert, alertController.createThreshold);
router.put('/thresholds/:id', thresholdUpsert, alertController.updateThreshold);
router.delete('/thresholds/:id', alertController.deleteThreshold);

router.get('/alerts', alertController.listAlerts);
// /unread-count MUST come before /:id
router.get('/alerts/unread-count', alertController.unreadCount);
router.patch('/alerts/:id/read', alertController.markRead);
router.patch('/alerts/:id/resolve', alertController.markResolved);

// ── Working hours + availability status (sub-router) ──
router.use('/', require('./doctorStatus'));

// ── Consultations (admin sub-router) ──
router.use('/consultations', consultationRoutes);

// ── Appointments (admin sub-router) ──
router.use('/', appointmentRoutes);

// ── Telegram file proxy (retrieve patient-uploaded images/files) ──
router.get('/telegram-file/:fileId', telegramFileController.proxy);

// ── Settings ──
router.get('/settings', adminController.getSettings);
router.put('/settings', adminValidator.updateSettings, adminController.updateSettings);
router.post(
  '/settings/test-telegram',
  adminValidator.testTelegram,
  asyncHandler(async (req, res) => {
    try {
      await telegramService.testTelegram(req.body);
      audit.log({ actorId: req.user.id, actorIp: req.ip, action: 'TELEGRAM_TEST', status: 'success' });
      return ok(res, { success: true }, 'Test message sent to Telegram.');
    } catch (err) {
      audit.log({
        actorId: req.user.id, actorIp: req.ip,
        action: 'TELEGRAM_TEST', status: 'failure',
        meta: { error: err.response?.data?.description || err.message },
      });
      return res.status(400).json({
        success: false,
        error: { code: 'TELEGRAM_TEST_FAILED', message: 'Telegram test failed. Verify the token and that the bot is a member of the chat.', details: err.response?.data || { message: err.message } },
      });
    }
  })
);

// ── Logs ──
router.get('/logs', adminController.getLogs);
router.get('/logs/status-breakdown', adminController.getStatusBreakdown);
router.get('/logs/top-endpoints', adminController.getTopEndpoints);
router.get('/audit-logs', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, action = null } = req.query;
  const safeLimit = Math.min(Math.max(Number(limit), 1), 200);
  const safeOffset = (Math.max(Number(page), 1) - 1) * safeLimit;
  const rows = audit.listRecent({ limit: safeLimit, offset: safeOffset, action });
  const total = audit.count({ action });
  return res.status(200).json({
    success: true,
    data: rows,
    message: 'Audit logs.',
    pagination: {
      page: Number(page),
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  });
}));

// ── Secure backup ──
router.get('/backup-db/info', backupController.info);
router.post('/backup-db', backupLimiter, adminValidator.backup, backupController.download);

module.exports = router;
