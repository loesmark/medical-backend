/**
 * PatientProfile validator — PUT /patient/profile.
 *
 * birth_date required on first completion (when the existing row's birth_date
 * is NULL). The service enforces that rule; here we just ensure if birth_date
 * is supplied, it's a valid ISO date.
 *
 * Accepts:
 *   birth_date?        ISO date (YYYY-MM-DD)
 *   smoking_status?     'never' | 'former' | 'current' | null
 *   additional_info?   string
 *   diseases[]?         [{ disease_id?, custom_name? }]
 *   surgeries[]?        [{ surgery_id?, custom_name? }]
 *   symptoms[]?         [{ symptom_id?, custom_name? }]
 *   medications[]?      [{ medication_id?, custom_name?, dose?, frequency?, schedule_times[]?, instructions?, status? }]
 */

const { body } = require('express-validator');

const isoDate = (v) => v == null || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

const updateProfile = [
  body('birth_date').optional({ nullable: true }).custom(isoDate).withMessage('birth_date must be YYYY-MM-DD.'),
  body('smoking_status')
    .optional({ nullable: true })
    .isIn(['never', 'former', 'current', '']).withMessage('smoking_status must be never|former|current.'),
  body('additional_info').optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body('diseases').optional().isArray({ max: 100 }),
  body('diseases.*.disease_id').optional().isString(),
  body('diseases.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('surgeries').optional().isArray({ max: 100 }),
  body('surgeries.*.surgery_id').optional().isString(),
  body('surgeries.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('symptoms').optional().isArray({ max: 100 }),
  body('symptoms.*.symptom_id').optional().isString(),
  body('symptoms.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('medications').optional().isArray({ max: 100 }),
  body('medications.*.medication_id').optional().isString(),
  body('medications.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('medications.*.dose').optional().isString().trim().isLength({ max: 120 }),
  body('medications.*.frequency').optional().isString().trim().isLength({ max: 120 }),
  body('medications.*.schedule_times').optional().isArray({ max: 24 }),
  body('medications.*.instructions').optional().isString().trim().isLength({ max: 1000 }),
  body('medications.*.status').optional().isIn(['active', 'stopped']),
];

module.exports = { updateProfile };
