/**
 * HealthRecordService — add record (with optional symptoms + attachments →
 * Telegram) + evaluate thresholds → generate alerts + list records (paginated).
 *
 * Flow:
 *   1. Resolve the patient profile (profile.id is the FK on health_records).
 *   2. If the patient submitted symptom selections (symptoms[]), insert a
 *      symptom_log row FIRST, then link its id back via health_records.
 *      symptom_log_id. (Otherwise symptom_log_id = NULL.)
 *   3. Upload any attached files to Telegram (reuses telegramService), each
 *      file → a stable telegram_file_id we persist in JSON.
 *   4. Insert the health_record row (bp_systolic / bp_diastolic / heart_rate
 *      / current_medications / notes / attachments / symptom_log_id).
 *   5. Evaluate thresholds via alertService.evaluateRecord → insert any
 *      triggered alerts (warn/critical). Also evaluate critical symptoms if
 *      symptoms were provided → alertService.evaluateSymptoms.
 *
 * Telegram uploads are best-effort: failure never blocks the record save.
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const patientRepo = require('../repositories/patientRepository');
const healthRecordRepo = require('../repositories/healthRecordRepository');
const symptomLogRepo = require('../repositories/symptomLogRepository');
const settingsRepo = require('../repositories/settingsRepository');
const userRepo = require('../repositories/userRepository');

const telegramService = require('./telegramService');
const alertService = require('./alertService');

function getProfileOrThrow(userId) {
  const profile = patientRepo.getProfileByUserId(userId);
  if (!profile) throw ApiError.notFound('PROFILE_NOT_FOUND', 'Patient profile not found.');
  return profile;
}

function parseAttachments(rows) {
  return rows.map((r) => ({
    ...r,
    attachments: JSON.parse(r.attachments || '[]'),
  }));
}

module.exports = {
  async addRecord({
    userId,
    bp_systolic,
    bp_diastolic,
    heart_rate,
    current_medications,
    notes,
    symptoms,
    custom_symptom_text,
    upload_mode,
    files,
  }) {
    const profile = getProfileOrThrow(userId);
    const user = userRepo.findById(userId);

    // ── 1. (Optional) Symptom log FIRST, so we can link back ──
    let symptomLogId = null;
    const hasSymptoms = Array.isArray(symptoms) && symptoms.length > 0;
    if (hasSymptoms || custom_symptom_text) {
      symptomLogId = uuidv4();
      symptomLogRepo.insert({
        id: symptomLogId,
        patientId: userId,
        symptoms: symptoms || [],
        customText: custom_symptom_text,
        healthRecordId: null, // linked below via UPDATE? Schema has the FK on
        // symptom_logs.health_record_id pointing to health_records — but
        // we'd need a separate UPDATE. Cleaner: set symptom_logs.health_record_id
        // to NULL on insert, and let health_records.symptom_log_id carry the
        // link. This matches the schema comment "logical back-reference".
      });
    }

    // ── 2. Upload attachments to Telegram (best-effort) ──
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
            caption: `Patient: ${user?.name || 'Unknown'}\nBP: ${bp_systolic || '-'}/${bp_diastolic || '-'} · HR: ${heart_rate || '-'}\nNotes: ${notes || 'N/A'}`,
          });
        } catch (err) {
          logger.error('healthRecordService', `Telegram upload failed: ${err.message}`);
        }
      }
    }

    // ── 3. Insert the health_record row ──
    const recordId = uuidv4();
    healthRecordRepo.insert({
      id: recordId,
      patientId: profile.id,
      bpSystolic: bp_systolic,
      bpDiastolic: bp_diastolic,
      heartRate: heart_rate,
      currentMedications: current_medications,
      notes,
      attachments: JSON.stringify(attachments),
      symptomLogId,
    });

    // ── 4. Evaluate thresholds → generate alerts ──
    let triggeredAlerts = [];
    try {
      triggeredAlerts = alertService.evaluateRecord(userId, recordId, {
        bp_systolic, bp_diastolic, heart_rate,
      });
    } catch (err) {
      logger.error('healthRecordService', `Alert evaluation failed: ${err.message}`);
    }
    if (symptomLogId && hasSymptoms) {
      try {
        alertService.evaluateSymptoms(userId, symptomLogId, symptoms);
      } catch (err) {
        logger.error('healthRecordService', `Symptom alert evaluation failed: ${err.message}`);
      }
    }

    logger.info('healthRecordService', `Record added for ${userId}: ${recordId}`);
    return {
      record_id: recordId,
      symptom_log_id: symptomLogId,
      files_uploaded: attachments.length,
      triggered_alerts: triggeredAlerts,
    };
  },

  listRecords(userId, { page = 1, limit = 20 } = {}) {
    const profile = getProfileOrThrow(userId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = healthRecordRepo.listByPatient(profile.id, safeLimit, safeOffset);
    const total = healthRecordRepo.countByPatient(profile.id);
    return { records: parseAttachments(rows), total, page, limit: safeLimit };
  },

  // ── Used by adminService.recentRecords + adminController ──
  recentRecords({ page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = healthRecordRepo.recentRecords(safeLimit, safeOffset);
    const total = healthRecordRepo.countRecentRecords();
    return {
      records: rows.map((r) => ({
        record_id: r.record_id,
        bp_systolic: r.bp_systolic,
        bp_diastolic: r.bp_diastolic,
        heart_rate: r.heart_rate,
        current_medications: r.current_medications,
        notes: r.notes,
        attachments: JSON.parse(r.attachments || '[]'),
        created_at: r.created_at,
        patient: {
          user_id: r.user_id,
          profile_id: r.profile_id,
          name: r.patient_name,
          phone: r.patient_phone,
          status: r.patient_status,
        },
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  // ── Used by consultationService.create to build the context JSON ──
  latestForUser(userId) {
    const profile = patientRepo.getProfileByUserId(userId);
    if (!profile) return null;
    return healthRecordRepo.latestForProfile(profile.id);
  },
};
