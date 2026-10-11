/**
 * Consultation routes — two sub-routers (patient + admin).
 *
 * Patient (mounted under /api/v1/patient/consultations by routes/patient.js):
 *   POST   /                   → create
 *   GET    /                   → list mine
 *   GET    /:id                → get mine
 *
 * Admin (mounted under /api/v1/admin/consultations by routes/admin.js):
 *   GET    /                   → list all (with ?status=&category=&page=&limit=)
 *   GET    /:id                → get any
 *   PATCH  /:id/respond        → respond
 */

const express = require('express');
const consultationController = require('../controllers/consultationController');
const { create, respond } = require('../validators/consultationValidator');

// ── Patient router ──
const patientRouter = express.Router();
patientRouter.post('/', create, consultationController.create);
patientRouter.get('/', consultationController.listMine);
patientRouter.get('/:id', consultationController.getMine);

// ── Admin router ──
const adminRouter = express.Router();
adminRouter.get('/', consultationController.listAll);
adminRouter.get('/:id', consultationController.getAny);
adminRouter.patch('/:id/respond', respond, consultationController.respond);

module.exports = { patientRouter, adminRouter };
