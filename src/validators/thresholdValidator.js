/**
 * Threshold validator — POST /admin/thresholds + PUT /admin/thresholds/:id.
 *
 *   parameter_name   required, one of: bp_systolic | bp_diastolic | heart_rate
 *   warning_value?   number
 *   critical_value?  number
 *   operator?        one of > | >= | < | <=  (default '>')
 *   is_active?       boolean
 */

const { body } = require('express-validator');

const upsert = [
  body('parameter_name')
    .isIn(['bp_systolic', 'bp_diastolic', 'heart_rate'])
    .withMessage('parameter_name must be one of: bp_systolic, bp_diastolic, heart_rate.'),
  body('warning_value').optional().isFloat({ min: 0, max: 1000 }),
  body('critical_value').optional().isFloat({ min: 0, max: 1000 }),
  body('operator').optional().isIn(['>', '>=', '<', '<=']),
  body('is_active').optional().isBoolean(),
];

module.exports = { upsert };
