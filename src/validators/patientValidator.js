/**
 * Patient input validators.
 */

const { body } = require('express-validator');

const addRecord = [
  body('blood_pressure').optional().isString().trim(),
  body('heart_rate').optional().isInt({ min: 0, max: 300 }).withMessage('Heart rate must be 0-300.'),
  body('current_medications').optional().isString().trim(),
  body('notes').optional().isString().trim(),
  body('upload_mode').optional().isIn(['photo', 'document']).withMessage('upload_mode must be "photo" or "document".'),
];

const requestConsultation = [
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
];

module.exports = { addRecord, requestConsultation };
