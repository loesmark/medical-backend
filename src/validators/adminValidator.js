/**
 * Admin input validators.
 */

const { body } = require('express-validator');

const changeRole = [
  body('role').isIn(['admin', 'patient']).withMessage('role must be "admin" or "patient".'),
];

const changeStatus = [
  body('status').isIn(['active', 'suspended']).withMessage('status must be "active" or "suspended".'),
];

const updateSettings = [
  body('telegram_bot_token').optional().isString().trim(),
  body('telegram_chat_id').optional().isString().trim(),            // group for patient-uploaded file storage
  body('telegram_alerts_chat_id').optional().isString().trim(),     // SEPARATE group for doctor notifications/alerts
  body('doctor_whatsapp').optional().isString().trim(),             // public number shown to patients in the deeplink
];

const backup = [
  body('passcode').isString().isLength({ min: 4, max: 256 }).withMessage('passcode is required.'),
];

const testTelegram = [
  body('token').isString().isLength({ min: 5 }).withMessage('token required.'),
  body('chat_id').isString().isLength({ min: 1 }).withMessage('chat_id required.'),
];

module.exports = { changeRole, changeStatus, updateSettings, backup, testTelegram };
