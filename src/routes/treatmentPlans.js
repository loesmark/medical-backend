/**
 * TreatmentPlan routes — two sub-routers (patient + admin).
 *
 * Patient (mounted under /api/v1/patient/treatment-plan by routes/patient.js):
 *   GET  /            → current plan
 *   GET  /versions    → version history
 *
 * Admin (mounted under /api/v1/admin/patients/:userId/treatment-plan by
 * routes/admin.js):
 *   GET  /            → current plan for the patient
 *   POST /            → create a new current plan (creates a version snapshot)
 *   GET  /versions    → version history
 */

const express = require('express');
const treatmentPlanController = require('../controllers/treatmentPlanController');
const { create } = require('../validators/treatmentPlanValidator');

// ── Patient router ──
const patientRouter = express.Router();
patientRouter.get('/', treatmentPlanController.getCurrent);
patientRouter.get('/versions', treatmentPlanController.listVersions);

// ── Admin router ──
const adminRouter = express.Router();
adminRouter.get('/', treatmentPlanController.adminGetCurrent);
adminRouter.post('/', create, treatmentPlanController.adminCreate);
adminRouter.get('/versions', treatmentPlanController.adminListVersions);

module.exports = { patientRouter, adminRouter };
