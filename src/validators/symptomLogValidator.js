/**
 * SymptomLog validator — POST /patient/symptom-logs.
 *
 * symptoms[] = array of { symptom_id?, custom_name? }
 * custom_text = free-text description (optional)
 */

const { body } = require('express-validator');

const addLog = [
  body('symptoms').optional().isArray({ max: 50 }),
  body('symptoms.*.symptom_id').optional().isString(),
  body('symptoms.*.custom_name').optional().isString().trim().isLength({ max: 200 }),
  body('custom_text').optional().isString().trim().isLength({ max: 2000 }),
];

module.exports = { addLog };
