/**
 * AuthController — thin HTTP layer over authService.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/response');
const authService = require('../services/authService');

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
  doctorLogin: asyncHandler(async (req, res) => {
    check(req);
    const data = authService.doctorLogin(req.body);
    return ok(res, data, 'Login successful.');
  }),

  patientRegister: asyncHandler(async (req, res) => {
    check(req);
    const data = authService.patientRegister(req.body);
    return created(res, data, 'Profile created successfully.');
  }),

  patientLogin: asyncHandler(async (req, res) => {
    check(req);
    const data = authService.patientLogin(req.body);
    return ok(res, data, 'Logged in via token.');
  }),

  me: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = authService.me(req.user.id);
    return ok(res, data, 'Current user.');
  }),

  updateProfile: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = authService.updateProfile(req.user.id, {
      name: req.body.name,
      phone_number: req.body.phone_number,
    });
    return ok(res, data, 'Profile updated.');
  }),

  changePassword: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = authService.changePassword(req.user.id, {
      current_password: req.body.current_password,
      new_password: req.body.new_password,
    });
    return ok(res, data, 'Password changed.');
  }),
};
