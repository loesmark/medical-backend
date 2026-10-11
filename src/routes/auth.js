/**
 * Auth routes — /api/v1/auth/*
 *
 *   POST /doctor-login      (rate-limited)   → { token, user }
 *   POST /patient-register  (rate-limited)   → { patient_token, jwt, profileId }
 *   POST /patient-login     (rate-limited)   → { jwt, user, profileId }
 *   GET  /me                (authenticate)   → current user
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { ok } = require('../utils/response');
const authController = require('../controllers/authController');
const { doctorLogin, patientRegister, patientLogin, updateProfile, changePassword } = require('../validators/authValidator');

router.post('/doctor-login', authLimiter, doctorLogin, authController.doctorLogin);
router.post('/patient-register', authLimiter, patientRegister, authController.patientRegister);
router.post('/patient-login', authLimiter, patientLogin, authController.patientLogin);
router.get('/me', authenticate, authController.me);

// Self-management (the doctor manages his own profile + password)
router.put('/profile', authenticate, updateProfile, authController.updateProfile);
router.put('/password', authenticate, changePassword, authController.changePassword);

module.exports = router;
