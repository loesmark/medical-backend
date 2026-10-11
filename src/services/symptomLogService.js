/**
 * SymptomLogService — add a standalone symptom log (no vitals) + check
 * critical symptoms → generate alerts + list logs.
 *
 * If the patient is reporting symptoms WITHOUT a vitals reading, they POST
 * /patient/symptom-logs with symptoms[] + optional custom_text. We:
 *   1. Insert the symptom_log row (health_record_id = NULL).
 *   2. Run alertService.evaluateSymptoms() — any catalog symptom flagged
 *      is_critical=1 generates a 'critical' alert.
 *
 * If the patient is submitting symptoms WITH a vitals reading, that flows
 * through healthRecordService.addRecord instead (which inserts BOTH the
 * symptom_log and the health_record in one call).
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const symptomLogRepo = require('../repositories/symptomLogRepository');
const userRepo = require('../repositories/userRepository');
const alertService = require('./alertService');

module.exports = {
  addLog({ userId, symptoms, custom_text }) {
    // Sanity: ensure the user exists (auth middleware already validated the JWT,
    // but a deleted user could still hold an unexpired token — be defensive).
    const user = userRepo.findById(userId);
    if (!user || user.role !== 'patient') {
      throw ApiError.notFound('USER_NOT_FOUND', 'Patient not found.');
    }
    const id = uuidv4();
    symptomLogRepo.insert({
      id,
      patientId: userId,
      symptoms: symptoms || [],
      customText: custom_text,
      healthRecordId: null,
    });

    let triggered = [];
    try {
      triggered = alertService.evaluateSymptoms(userId, id, symptoms || []);
    } catch (err) {
      logger.error('symptomLogService', `Alert evaluation failed: ${err.message}`);
    }
    logger.info('symptomLogService', `Symptom log added for ${userId}: ${id}`);
    return { log_id: id, triggered_alerts: triggered };
  },

  listLogs(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = symptomLogRepo.listByPatient(userId, safeLimit, safeOffset);
    const total = symptomLogRepo.countByPatient(userId);
    return {
      logs: rows.map((r) => ({
        ...r,
        symptoms: JSON.parse(r.symptoms || '[]'),
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  latestForUser(userId) {
    const row = symptomLogRepo.latestForPatient(userId);
    if (!row) return null;
    return { ...row, symptoms: JSON.parse(row.symptoms || '[]') };
  },
};
