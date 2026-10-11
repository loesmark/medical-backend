/**
 * Appointment routes — two sub-routers (patient + admin) + working-hours.
 *
 * Patient (mounted under /api/v1/patient by routes/patient.js):
 *   GET    /working-hours            → list the doctor's recurring hours
 *   GET    /available-slots?date=    → computed free slots
 *   POST   /appointments             → request
 *   GET    /appointments             → list mine
 *   DELETE /appointments/:id         → cancel mine
 *
 * Admin (mounted under /api/v1/admin by routes/admin.js):
 *   GET    /appointments             → list all (with ?status=&date=&page=&limit=)
 *   PATCH  /appointments/:id/confirm → confirm (generates whatsapp_link)
 *   PATCH  /appointments/:id/cancel  → cancel
 */

const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const { request } = require('../validators/appointmentValidator');

// ── Patient router ──
const patientRouter = express.Router();
patientRouter.get('/working-hours', appointmentController.getWorkingHours);
patientRouter.get('/available-slots', appointmentController.listAvailableSlots);
patientRouter.post('/appointments', request, appointmentController.request);
patientRouter.get('/appointments', appointmentController.listMine);
patientRouter.delete('/appointments/:id', appointmentController.cancel);

// ── Admin router ──
const adminRouter = express.Router();
adminRouter.get('/appointments', appointmentController.listAll);
adminRouter.patch('/appointments/:id/confirm', appointmentController.confirm);
adminRouter.patch('/appointments/:id/cancel', appointmentController.adminCancel);

module.exports = { patientRouter, adminRouter };
