/**
 * TreatmentPlan validator — POST /admin/patients/:userId/treatment-plan.
 *
 *   recommended_medications?  array of { medication_id?, custom_name?, dose?, reason? }
 *   instructions?            string
 *   follow_up_dates?         array of YYYY-MM-DD strings
 *   clinical_notes?          string
 */

const { body } = require('express-validator');

const create = [
  body('recommended_medications').optional().isArray({ max: 100 }),
  body('recommended_medications.*.medication_id').optional().isString(),
  body('recommended_medications.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('recommended_medications.*.dose').optional().isString().trim().isLength({ max: 120 }),
  body('recommended_medications.*.reason').optional().isString().trim().isLength({ max: 500 }),
  body('instructions').optional().isString().trim().isLength({ max: 4000 }),
  body('follow_up_dates').optional().isArray({ max: 50 }),
  body('follow_up_dates.*').optional().isISO8601().withMessage('Each follow_up_date must be YYYY-MM-DD.'),
  body('clinical_notes').optional().isString().trim().isLength({ max: 8000 }),
];

module.exports = { create };
