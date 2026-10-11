/**
 * Auth input validators — express-validator chains reusable on routes.
 */

const { body } = require('express-validator');

const doctorLogin = [
  body('phone_number').isString().trim().isLength({ min: 4, max: 20 }).withMessage('Phone number is required (4-20 chars).'),
  body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password is required.'),
];

const patientRegister = [
  body('name').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name must be 2-120 characters.'),
  body('phone_number').isString().trim().isLength({ min: 4, max: 20 }).withMessage('Phone number is required (4-20 chars).'),
  // birth_date is OPTIONAL at registration — the patient completes it on first
  // PUT /patient/profile. If supplied, it must be a valid ISO date.
  body('birth_date').optional({ nullable: true }).isISO8601().withMessage('birth_date must be YYYY-MM-DD.'),
  body('smoking_status').optional({ nullable: true }).isIn(['never', 'former', 'current']).withMessage('smoking_status must be never|former|current.'),
  body('additional_info').optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
];

const patientLogin = [
  body('patient_token').isString().trim().isLength({ min: 10, max: 128 }).withMessage('patient_token is required.'),
];

const updateProfile = [
  body('name').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name must be 2-120 characters.'),
  body('phone_number').isString().trim().isLength({ min: 4, max: 20 }).withMessage('Phone number is required (4-20 chars).'),
];

const changePassword = [
  body('current_password').isString().isLength({ min: 1, max: 128 }).withMessage('Current password is required.'),
  body('new_password').isString().isLength({ min: 8, max: 128 }).withMessage('New password must be at least 8 characters.'),
];

module.exports = { doctorLogin, patientRegister, patientLogin, updateProfile, changePassword };
