/**
 * PatientProfile routes — /api/v1/patient/profile*
 *
 * Mounted as a sub-router INSIDE routes/patient.js (so all paths are relative
 * to /api/v1/patient). The authenticate + authorize('patient') middleware is
 * applied at the parent patient router level — these sub-routes don't need
 * to re-authenticate.
 *
 *   GET  /                          → current profile + selections
 *   PUT  /                          → update profile (transactional)
 *   GET  /versions                  → paginated version snapshots
 */

const express = require('express');
const router = express.Router();
const profileController = require('../controllers/patientProfileController');
const { updateProfile } = require('../validators/patientProfileValidator');

router.get('/', profileController.getProfile);
router.put('/', updateProfile, profileController.updateProfile);
router.get('/versions', profileController.listVersions);

module.exports = router;
