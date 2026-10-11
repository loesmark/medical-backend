/**
 * Appointment validator — POST /patient/appointments.
 *
 *   scheduled_date  YYYY-MM-DD (required)
 *   scheduled_time  HH:MM (required, 24h)
 *   notes?          string
 */

const { body } = require('express-validator');

const request = [
  body('scheduled_date').isISO8601().withMessage('scheduled_date must be YYYY-MM-DD.'),
  body('scheduled_time').matches(/^\d{2}:\d{2}$/).withMessage('scheduled_time must be HH:MM (24h).'),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
];

module.exports = { request };
