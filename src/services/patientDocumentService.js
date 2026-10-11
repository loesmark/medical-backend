/**
 * PatientDocumentService — upload a document (ECG/Echo/lab report) to
 * Telegram + list the patient's documents.
 *
 * Append-only — there's no edit endpoint. A document row persists the
 * patient-entered type / title / taken_at / notes + the JSON array of
 * telegram_file_id refs returned by telegramService.
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const documentRepo = require('../repositories/patientDocumentRepository');
const userRepo = require('../repositories/userRepository');
const settingsRepo = require('../repositories/settingsRepository');
const telegramService = require('./telegramService');

function parseAttachments(rows) {
  return rows.map((r) => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }));
}

module.exports = {
  async upload({
    userId,
    type,
    title,
    taken_at,
    notes,
    upload_mode,
    files,
  }) {
    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Patient not found.');

    let attachments = [];
    if (files && files.length) {
      const botToken = settingsRepo.get('telegram_bot_token');
      const chatId = settingsRepo.get('telegram_chat_id');
      if (botToken && chatId) {
        try {
          attachments = await telegramService.uploadFiles({
            files,
            botToken,
            chatId,
            uploadMode: upload_mode,
            caption: `Document [${type || 'other'}] — ${user?.name || 'Unknown'}\nTitle: ${title || 'N/A'}`,
          });
        } catch (err) {
          logger.error('patientDocumentService', `Telegram upload failed: ${err.message}`);
        }
      }
    }

    const id = uuidv4();
    documentRepo.insert({
      id,
      patientId: userId,
      type: type || 'other',
      title,
      takenAt: taken_at,
      notes,
      attachments: JSON.stringify(attachments),
    });
    logger.info('patientDocumentService', `Document uploaded for ${userId}: ${id}`);
    return { document_id: id, files_uploaded: attachments.length };
  },

  listDocuments(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = documentRepo.listByPatient(userId, safeLimit, safeOffset);
    const total = documentRepo.countByPatient(userId);
    return { documents: parseAttachments(rows), total, page, limit: safeLimit };
  },

  // Used by admin endpoints — same data, different actor.
  listDocumentsByUserId(userId, opts) {
    return this.listDocuments(userId, opts);
  },

  getDocument(id) {
    const row = documentRepo.getById(id);
    if (!row) return null;
    return { ...row, attachments: JSON.parse(row.attachments || '[]') };
  },
};
