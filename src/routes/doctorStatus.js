/**
 * Doctor-status routes — admin-facing:
 *
 *   GET    /admin/working-hours        → list the doctor's recurring working hours
 *   PUT    /admin/working-hours        → upsert a day's working hours { day_of_week, start_time, end_time, is_active? }
 *   GET    /admin/availability-status  → doctor availability flag (available|unavailable|busy)
 *   PUT    /admin/availability-status  → set { status }
 *
 * Mounted under /api/v1/admin (auth: admin) — the parent router applies
 * authenticate + authorize('admin') + apiLimiter.
 */

const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');

router.get('/working-hours', appointmentController.listWorkingHours);
router.put('/working-hours', appointmentController.upsertWorkingHours);

router.get('/availability-status', appointmentController.getAvailabilityStatus);
router.put('/availability-status', appointmentController.setAvailabilityStatus);

module.exports = router;
