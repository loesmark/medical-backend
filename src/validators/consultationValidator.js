/**
 * Consultation validator — POST /patient/consultations + PATCH /admin/consultations/:id/respond.
 *
 * Create:
 *   category       required: 'immediate' | 'regular'
 *   type_id?       catalog reference (mutually exclusive with custom_type)
 *   custom_type?   free text when the type isn't in the catalog
 *   reason         required, the patient's complaint
 *   attachment?    array of telegram file refs (rarely used — patients usually
 *                  upload files via /patient/records; included for completeness)
 *
 * Respond:
 *   response_text?    string
 *   recommended_action? string
 *   follow_up_date?   YYYY-MM-DD
 *   attachment?       array
 */

const { body } = require('express-validator');

const create = [
  body('category').isIn(['immediate', 'regular']).withMessage('category must be "immediate" or "regular".'),
  body('type_id').optional().isString(),
  body('custom_type').optional().isString().trim().isLength({ max: 200 }),
  body('reason').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('reason is required (1-4000 chars).'),
  body('attachment').optional().isArray({ max: 20 }),
];

const respond = [
  body('response_text').optional().isString().trim().isLength({ max: 4000 }),
  body('recommended_action').optional().isString().trim().isLength({ max: 1000 }),
  body('follow_up_date').optional().isISO8601().withMessage('follow_up_date must be YYYY-MM-DD.'),
  body('attachment').optional().isArray({ max: 20 }),
];

module.exports = { create, respond };
