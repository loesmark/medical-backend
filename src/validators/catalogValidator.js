/**
 * Catalog validators — admin CRUD input for the 5 catalogs.
 *
 * Each catalog has slightly different fields; the param-based branching is
 * done in catalogService, so the validators just check the SHARED shape:
 * - name (required for diseases / surgeries / symptoms / consultation_types)
 * - brand_name (required for medications)
 * - category, is_critical, generic_name, form — optional
 */

const { body } = require('express-validator');

// One validator for all 5 catalogs — the service enforces catalog-specific
// requirements (e.g. consultation_types.category must be immediate|regular).
const upsert = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('category').optional().isString().trim().isLength({ max: 120 }),
  body('is_critical').optional().isBoolean(),
  body('brand_name').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('generic_name').optional().isString().trim().isLength({ max: 200 }),
  body('form').optional().isString().trim().isIn(['tablet', 'capsule', 'syrup', 'injection', 'other']),
];

module.exports = { upsert };
