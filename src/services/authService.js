/**
 * AuthService — login/register logic for both doctors and patients.
 *
 * Key refactor points vs original:
 *   - patient-register is now wrapped in a db.transaction (no orphaned user on partial failure)
 *   - patients get a NULL password_hash (no more dummyHash hack)
 *   - JWT now embeds { id, role, name } so patientRoutes' Telegram caption can use req.user.name
 *   - input validation lives in validators/authValidator.js
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const db = require('../db');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const userRepo = require('../repositories/userRepository');
const patientRepo = require('../repositories/patientRepository');

function signToken(payload, isPatient = false) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: isPatient ? config.jwt.patientExpiresIn : config.jwt.expiresIn,
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone_number: user.phone_number,
    role: user.role,
    status: user.status,
    // Expose patient_token so the patient can retrieve/view their own token
    // in the app (Settings → My Token). Null for admins (harmless).
    patient_token: user.patient_token || null,
  };
}

const authService = {
  doctorLogin({ phone_number, password }) {
    const user = userRepo.findByPhone(phone_number);
    if (!user || user.role !== 'admin') {
      throw ApiError.unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid phone or password.');
    }
    if (user.status === 'suspended') {
      throw ApiError.forbidden('AUTH_SUSPENDED', 'This account has been suspended.');
    }
    if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      throw ApiError.unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid phone or password.');
    }
    const token = signToken({ id: user.id, role: user.role, name: user.name });
    return { token, user: publicUser(user) };
  },

  patientRegister({ name, phone_number, birth_date, smoking_status, additional_info }) {
    const userId = uuidv4();
    const profileId = uuidv4();
    const patientToken = uuidv4();

    try {
      // Atomic: if profile insert fails, user insert is rolled back
      db.tx(() => {
        userRepo.insert({
          id: userId,
          name,
          phone: phone_number,
          passwordHash: null, // patients authenticate by patient_token, not password
          role: 'patient',
          patientToken,
        });
        patientRepo.insertProfile({
          id: profileId,
          userId,
          birthDate: birth_date,
          smokingStatus: smoking_status,
          additionalInfo: additional_info,
        });
      });
    } catch (err) {
      // Constraint errors are translated by errorHandler; rethrow non-operational
      if (err.constraint === 'UNIQUE') {
        throw ApiError.conflict('CONFLICT_PHONE', 'Phone number already registered.');
      }
      throw err;
    }

    const jwtToken = signToken({ id: userId, role: 'patient', name }, true);
    logger.info('authService', `Patient registered: ${userId}`);
    return { patient_token: patientToken, jwt: jwtToken, profileId, user: { id: userId, name, role: 'patient' } };
  },

  patientLogin({ patient_token }) {
    const user = userRepo.findByToken(patient_token);
    if (!user || user.role !== 'patient') {
      throw ApiError.notFound('AUTH_TOKEN_INVALID', 'Invalid patient token.');
    }
    if (user.status === 'suspended') {
      throw ApiError.forbidden('AUTH_SUSPENDED', 'This account has been suspended.');
    }
    const jwtToken = signToken({ id: user.id, role: user.role, name: user.name }, true);
    const profile = patientRepo.getProfileByUserId(user.id);
    return { jwt: jwtToken, user: { id: user.id, name: user.name, role: 'patient' }, profileId: profile?.id || null };
  },

  // Get the authenticated user's current identity (used by /auth/me)
  me(userId) {
    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    return publicUser(user);
  },

  // Doctor updates own profile (name + phone)
  updateProfile(userId, { name, phone_number }) {
    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    // If phone changed, ensure it's not taken by another user
    if (phone_number && phone_number !== user.phone_number) {
      const existing = userRepo.findByPhone(phone_number);
      if (existing && existing.id !== userId) {
        throw ApiError.conflict('CONFLICT_PHONE', 'Phone number already used by another account.');
      }
    }
    userRepo.updateProfile(userId, name, phone_number);
    const updated = userRepo.findById(userId);
    logger.info('authService', `Profile updated: ${userId}`);
    return publicUser(updated);
  },

  // Doctor changes own password — must verify current password first
  changePassword(userId, { current_password, new_password }) {
    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    if (!user.password_hash || !bcrypt.compareSync(current_password, user.password_hash)) {
      throw ApiError.unauthorized('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    if (new_password.length < 8) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'New password must be at least 8 characters.');
    }
    const hash = bcrypt.hashSync(new_password, config.bcrypt.saltRounds);
    userRepo.updatePassword(userId, hash);
    logger.info('authService', `Password changed: ${userId}`);
    return { id: userId, password_changed: true };
  },
};

module.exports = authService;
