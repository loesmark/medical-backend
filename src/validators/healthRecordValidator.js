/**
 * HealthRecord validator — POST /patient/records (multipart).
 *
 * v3 columns: bp_systolic / bp_diastolic / heart_rate + symptoms[] + notes.
 * At least ONE vitals value OR a symptom must be provided (the service
 * doesn't enforce that; the validator allows either-or so empty submissions
 * are rejected only at the controller's discretion).
 *
 * Attachments are uploaded via multipart (req.files), so they're not in the
 * body — handled by multer in the route layer.
 */

const { body } = require('express-validator');

const addRecord = [
  body('bp_systolic').optional().isInt({ min: 0, max: 300 }).withMessage('bp_systolic must be 0-300.'),
  body('bp_diastolic').optional().isInt({ min: 0, max: 200 }).withMessage('bp_diastolic must be 0-200.'),
  body('heart_rate').optional().isInt({ min: 0, max: 300 }).withMessage('heart_rate must be 0-300.'),
  body('current_medications').optional().isString().trim().isLength({ max: 2000 }),
  body('notes').optional().isString().trim().isLength({ max: 4000 }),
  body('upload_mode').optional().isIn(['photo', 'document']).withMessage('upload_mode must be "photo" or "document".'),
  body('symptoms').optional().isArray({ max: 50 }),
  body('symptoms.*.symptom_id').optional().isString(),
  body('symptoms.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('custom_symptom_text').optional().isString().trim().isLength({ max: 2000 }),
];

module.exports = { addRecord };
