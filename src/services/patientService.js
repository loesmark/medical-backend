/**
 * PatientService — patient-facing business logic.
 *
 * Key refactor points vs original patientRoutes.js:
 *   - Telegram upload moved out of the route into telegramService + patientService
 *   - BUG FIX: original used req.user.name but JWT only had {id,role} → "undefined" caption
 *     Now the JWT carries `name` (see authService.signToken), so captions work.
 *   - Records endpoint supports pagination
 *   - Health records are linked via patient_profile.id (correct FK)
 *   - Multer file size & type limits configured in the route layer
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const config = require('../config');
const patientRepo = require('../repositories/patientRepository');
const userRepo = require('../repositories/userRepository');
const settingsRepo = require('../repositories/settingsRepository');
const telegramService = require('./telegramService');

function getProfileOrThrow(userId) {
  const profile = patientRepo.getProfileByUserId(userId);
  if (!profile) throw ApiError.notFound('PROFILE_NOT_FOUND', 'Patient profile not found.');
  return profile;
}

function parseAttachments(records) {
  return records.map((r) => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }));
}

const patientService = {
  getProfile(userId) {
    const profile = getProfileOrThrow(userId);
    const { id, user_id, age, smoking_status, medical_history, updated_at } = profile;
    return { id, user_id, age, smoking_status, medical_history, updated_at };
  },

  async addHealthRecord({ userId, blood_pressure, heart_rate, current_medications, notes, upload_mode, files }) {
    const profile = getProfileOrThrow(userId);
    const user = userRepo.findById(userId);
    const botToken = settingsRepo.get('telegram_bot_token');
    const chatId = settingsRepo.get('telegram_chat_id');

    let attachments = [];
    if (files && files.length && botToken && chatId) {
      attachments = await telegramService.uploadFiles({
        files,
        botToken,
        chatId,
        uploadMode: upload_mode,
        caption: `Patient: ${user?.name || 'Unknown'}\nNotes: ${notes || 'N/A'}`,
      });
    }

    const id = uuidv4();
    patientRepo.insertRecord({
      id,
      patientId: profile.id,
      bloodPressure: blood_pressure,
      heartRate: heart_rate,
      currentMedications: current_medications,
      notes,
      attachments: JSON.stringify(attachments),
    });

    return { recordId: id, files_uploaded: attachments.length };
  },

  listRecords(userId, { page = 1, limit = 20 } = {}) {
    const profile = getProfileOrThrow(userId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = patientRepo.listRecordsByPatient(profile.id, safeLimit, safeOffset);
    const total = patientRepo.countRecordsByPatient(profile.id);
    return { records: parseAttachments(rows), total, page, limit: safeLimit };
  },

  requestConsultation({ userId, notes }) {
    const profile = getProfileOrThrow(userId);
    const user = userRepo.findById(userId);
    const doctorWhatsapp = settingsRepo.get('doctor_whatsapp') || config.telegram.doctorWhatsapp;
    const message = encodeURIComponent(`Consultation for ${user?.name || 'patient'}: ${notes || ''}`);
    const whatsappLink = `https://wa.me/${doctorWhatsapp}?text=${message}`;

    const id = uuidv4();
    patientRepo.insertConsultation({ id, patientId: profile.id, notes, whatsappLink });
    return { whatsapp_link: whatsappLink, consultationId: id };
  },
};

module.exports = patientService;
