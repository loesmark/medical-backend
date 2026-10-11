/**
 * PatientProfileController — get/update profile + list versions.
 *
 * All endpoints require the patient role (enforced in the route).
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const profileService = require('../services/patientProfileService');

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
  getProfile: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = profileService.getProfile(req.user.id);
    return ok(res, data, 'Patient profile.');
  }),

  updateProfile: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = profileService.updateProfile(req.user.id, req.body);
    return ok(res, data, 'Profile updated.');
  }),

  listVersions: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const data = profileService.listVersions(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return ok(res, data, 'Profile versions.');
  }),
};
