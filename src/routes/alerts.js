/**
 * Alert routes — mounted under /api/v1/admin/* (auth: admin).
 *
 *   GET    /thresholds                → list thresholds (paged)
 *   POST   /thresholds                → create threshold
 *   PUT    /thresholds/:id            → update threshold
 *   DELETE /thresholds/:id            → delete threshold
 *   GET    /alerts                    → list alerts (with filters)
 *   GET    /alerts/unread-count       → unread count
 *   PATCH  /alerts/:id/read           → mark read
 *   PATCH  /alerts/:id/resolve        → mark resolved
 */

const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { upsert: thresholdUpsert } = require('../validators/thresholdValidator');

// ── Thresholds ──
router.get('/thresholds', alertController.listThresholds);
router.post('/thresholds', thresholdUpsert, alertController.createThreshold);
router.put('/thresholds/:id', thresholdUpsert, alertController.updateThreshold);
router.delete('/thresholds/:id', alertController.deleteThreshold);

// ── Alerts ──
// /unread-count must be defined BEFORE /:id so Express doesn't interpret
// "unread-count" as the :id parameter.
router.get('/alerts/unread-count', alertController.unreadCount);
router.get('/alerts', alertController.listAlerts);
router.patch('/alerts/:id/read', alertController.markRead);
router.patch('/alerts/:id/resolve', alertController.markResolved);

module.exports = router;
