/**
 * ConsultationService — patient create/list + admin respond/list.
 *
 * Creating a consultation:
 *   1. Fetch the patient's latest health_record (bp_systolic/bp_diastolic/
 *      heart_rate/created_at) via healthRecordService.latestForUser.
 *   2. Fetch the patient's latest symptom_log via symptomLogService.
 *   3. Build context JSON = { latest_reading, reading_freshness, symptoms_only,
 *      latest_symptoms }. (symptoms_only is TRUE for consultations — the
 *      patient doesn't bundle a new record into a consultation request.)
 *   4. If category='immediate': rate-limit to 3/day/patient, build a WhatsApp
 *      deep link to doctor_whatsapp + store it on consultations.whatsapp_link.
 *   5. Insert the consultation row (status='pending', context set).
 *
 * Admin respond:
 *   - Replace doctor_response JSON with { response_text, recommended_action,
 *     follow_up_date, attachment }, set status='responded', responded_at=now.
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const consultationRepo = require('../repositories/consultationRepository');
const userRepo = require('../repositories/userRepository');
const settingsRepo = require('../repositories/settingsRepository');
const telegramService = require('./telegramService');

const healthRecordService = require('./healthRecordService');
const symptomLogService = require('./symptomLogService');
const alertService = require('./alertService');

const IMMEDIATE_DAILY_LIMIT = 3;

function buildWhatsappLink(doctorWhatsapp, message) {
  const phone = (doctorWhatsapp || '').replace(/[^\d]/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

module.exports = {
  create({ userId, type_id, custom_type, reason, category, attachment }) {
    if (!reason) throw ApiError.badRequest('VALIDATION_FAILED', 'reason is required.');
    if (!['immediate', 'regular'].includes(category)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'category must be "immediate" or "regular".');
    }
    if (!type_id && !custom_type) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'Either type_id or custom_type is required.');
    }

    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Patient not found.');

    // ── Build context (latest reading + freshness + latest symptoms) ──
    const latestReading = healthRecordService.latestForUser(userId);
    const readingFreshness = alertService.freshness(latestReading);
    const latestSymptomLog = symptomLogService.latestForUser(userId);

    const context = JSON.stringify({
      latest_reading: latestReading
        ? {
            bp_systolic: latestReading.bp_systolic,
            bp_diastolic: latestReading.bp_diastolic,
            heart_rate: latestReading.heart_rate,
            created_at: latestReading.created_at,
          }
        : null,
      reading_freshness: readingFreshness,
      symptoms_only: true, // consultations don't carry a new record in this version
      latest_symptoms: latestSymptomLog
        ? { id: latestSymptomLog.id, symptoms: latestSymptomLog.symptoms, created_at: latestSymptomLog.created_at }
        : null,
    });

    // ── WhatsApp link (immediate only) + rate limit ──
    let whatsappLink = null;
    if (category === 'immediate') {
      const todayCount = consultationRepo.countImmediateToday(userId);
      if (todayCount >= IMMEDIATE_DAILY_LIMIT) {
        throw ApiError.tooMany('IMMEDIATE_LIMIT', `You've already submitted ${IMMEDIATE_DAILY_LIMIT} immediate consultations today.`);
      }
      const doctorWhatsapp = settingsRepo.get('doctor_whatsapp') || '';
      const freshnessWarn = readingFreshness === 'old' ? '⚠️ Latest reading is older than 24h.' : '';
      const msg = `🚨 *Immediate consultation*\nPatient: ${user.name}\nPhone: ${user.phone_number || '-'}\nReason: ${reason}\nLatest vitals: ${latestReading ? `BP ${latestReading.bp_systolic || '-'}/${latestReading.bp_diastolic || '-'} · HR ${latestReading.heart_rate || '-'}` : 'no records'}\n${freshnessWarn}`;
      whatsappLink = buildWhatsappLink(doctorWhatsapp, msg);
    }

    const id = uuidv4();
    consultationRepo.insert({
      id,
      patientId: userId,
      typeId: type_id,
      customType: custom_type,
      reason,
      category,
      context,
      whatsappLink,
      attachment: JSON.stringify(attachment || []),
    });

    // ── For immediate consultations: notify the doctor's alerts Telegram group ──
    // The patient's deeplink goes to the public doctor_whatsapp number; this
    // Telegram notification is a SEPARATE private channel the doctor monitors on
    // his phone. Patients never see the alerts group. Fire-and-forget (non-blocking).
    if (category === 'immediate') {
      const freshnessWarn = readingFreshness === 'old' ? '⚠️ Latest reading is older than 24h.' :
                            readingFreshness === 'none' ? '⚠️ Patient has NO previous measurements.' : '';
      const noSymptomsNote = !latestSymptomLog ? '' : '';
      const alertText = `🚨 *Immediate consultation*\n*Patient:* ${user.name}\n*Phone:* ${user.phone_number || '-'}\n*Reason:* ${reason}\n*Latest vitals:* ${latestReading ? `BP ${latestReading.bp_systolic || '-'}/${latestReading.bp_diastolic || '-'} · HR ${latestReading.heart_rate || '-'}` : 'no records'}\n${freshnessWarn}\n${noSymptomsNote}`;
      telegramService.sendAlertMessage(settingsRepo, alertText).catch((err) => {
        logger.warn('consultationService', `Telegram notify failed: ${err.message}`);
      });
    }

    logger.info('consultationService', `Consultation created for ${userId}: ${id} (${category})`);
    return {
      consultation_id: id,
      category,
      whatsapp_link: whatsappLink,
    };
  },

  listByUser(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = consultationRepo.listByPatient(userId, safeLimit, safeOffset);
    const total = consultationRepo.countByPatient(userId);
    return {
      consultations: rows.map((r) => ({
        ...r,
        context: r.context ? JSON.parse(r.context) : null,
        doctor_response: r.doctor_response ? JSON.parse(r.doctor_response) : null,
        attachment: JSON.parse(r.attachment || '[]'),
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  getById(id, { includeJoined = false } = {}) {
    const row = includeJoined ? consultationRepo.getByIdJoined(id) : consultationRepo.getById(id);
    if (!row) throw ApiError.notFound('CONSULTATION_NOT_FOUND', 'Consultation not found.');
    return {
      ...row,
      context: row.context ? JSON.parse(row.context) : null,
      doctor_response: row.doctor_response ? JSON.parse(row.doctor_response) : null,
      attachment: JSON.parse(row.attachment || '[]'),
    };
  },

  // ── Admin ──
  listAll({ page = 1, limit = 20, status, category } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = consultationRepo.listAll({ status, category, limit: safeLimit, offset: safeOffset });
    const total = consultationRepo.countAll({ status, category });
    return {
      consultations: rows.map((r) => ({
        ...r,
        context: r.context ? JSON.parse(r.context) : null,
        doctor_response: r.doctor_response ? JSON.parse(r.doctor_response) : null,
        attachment: JSON.parse(r.attachment || '[]'),
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  respond(id, { response_text, recommended_action, follow_up_date, attachment, actorId, actorIp }) {
    const existing = consultationRepo.getById(id);
    if (!existing) throw ApiError.notFound('CONSULTATION_NOT_FOUND', 'Consultation not found.');
    const doctorResponse = JSON.stringify({
      response_text: response_text || null,
      recommended_action: recommended_action || null,
      follow_up_date: follow_up_date || null,
      attachment: attachment || [],
    });
    consultationRepo.respond(id, doctorResponse);
    logger.info('consultationService', `Consultation ${id} responded by ${actorId || 'admin'}`);
    return this.getById(id, { includeJoined: true });
  },

  // ── Used by adminService.patientSummary (latest + total) ──
  lastForPatient(userId) { return consultationRepo.lastForPatient(userId); },
  totalForPatient(userId) { return consultationRepo.totalForPatient(userId); },
};
