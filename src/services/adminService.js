/**
 * AdminService — admin-facing business logic.
 *   - list patients with search + pagination (uses patientProfileRepository
 *     which selects the v3 columns birth_date / smoking_status /
 *     additional_info — NOT userRepository, which still selects the removed
 *     age/medical_history columns and would throw against the v3 schema).
 *   - change user role / status
 *   - delete user
 *   - fetch patient records (for the admin dashboard) — via healthRecordRepo
 *   - settings get/update
 *   - logs (request logs + audit logs)
 *   - recentRecords / patientSummary — rebuilt for the v3 bp_systolic /
 *     bp_diastolic columns and the consultation/treatment-plan tables.
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const userRepo = require('../repositories/userRepository');
const patientRepo = require('../repositories/patientRepository');
const profileRepo = require('../repositories/patientProfileRepository');
const healthRecordRepo = require('../repositories/healthRecordRepository');
const consultationRepo = require('../repositories/consultationRepository');
const settingsRepo = require('../repositories/settingsRepository');
const logRepo = require('../repositories/logRepository');
const audit = require('../middleware/auditLog');

function parseAttachments(records) {
  return records.map((r) => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }));
}

module.exports = {
  listPatients({ page = 1, limit = 20, search = null, sort = 'created_at' } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = profileRepo.listPatientsWithProfile({ search, limit: safeLimit, offset: safeOffset });
    const total = profileRepo.countPatientsWithProfile({ search });
    return {
      patients: rows.map((p) => ({
        id: p.id,
        name: p.name,
        phone_number: p.phone_number,
        role: p.role,
        status: p.status,
        created_at: p.created_at,
        profile_id: p.profile_id,
        birth_date: p.birth_date,
        smoking_status: p.smoking_status,
        additional_info: p.additional_info,
        profile_updated_at: p.profile_updated_at,
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  getUserDetail(userId) {
    const user = userRepo.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    const profile = patientRepo.getProfileByUserId(userId);

    // Richer profile: include selections (diseases / surgeries / symptoms /
    // medications) joined with the catalog names so the admin sees real text.
    let selections = null;
    if (profile) {
      selections = {
        diseases:    profileRepo.listDiseasesByProfileJoined(profile.id),
        surgeries:  profileRepo.listSurgeriesByProfileJoined(profile.id),
        symptoms:    profileRepo.listSymptomsByProfileJoined(profile.id),
        medications: profileRepo.listMedicationsByProfileJoined(profile.id),
      };
    }

    return {
      id: user.id,
      name: user.name,
      phone_number: user.phone_number,
      role: user.role,
      status: user.status,
      created_at: user.created_at,
      profile: profile
        ? {
            id: profile.id,
            birth_date: profile.birth_date,
            smoking_status: profile.smoking_status,
            additional_info: profile.additional_info,
            updated_at: profile.updated_at,
            selections,
          }
        : null,
    };
  },

  listUserRecords(userId, { page = 1, limit = 20 } = {}) {
    const profile = patientRepo.getProfileByUserId(userId);
    if (!profile) throw ApiError.notFound('PROFILE_NOT_FOUND', 'Patient profile not found.');
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = healthRecordRepo.listByPatient(profile.id, safeLimit, safeOffset);
    const total = healthRecordRepo.countByPatient(profile.id);
    return { records: parseAttachments(rows), total, page, limit: safeLimit };
  },

  // ── Recent records across ALL patients (Recent Cases view) ──
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

  // ── Patient medical summary — latest reading + trend + totals ──
  patientSummary(userId) {
    const profile = patientRepo.getProfileByUserId(userId);
    if (!profile) throw ApiError.notFound('PROFILE_NOT_FOUND', 'Patient profile not found.');
    const latest = healthRecordRepo.latestForProfile(profile.id);
    const previous = healthRecordRepo.previousForProfile(profile.id);
    const lastConsultation = consultationRepo.lastForPatient(userId);
    const totalRecords = healthRecordRepo.countByPatient(profile.id);
    const totalConsultations = consultationRepo.totalForPatient(userId);

    // Trend comparison (bp_systolic + bp_diastolic + heart_rate are now separate columns)
    function trend(curr, prev) {
      if (curr == null || prev == null) return 'unknown';
      if (curr > prev + 5) return 'elevated';
      if (curr < prev - 5) return 'lower';
      return 'stable';
    }
    const bpTrend =
      latest && previous
        ? (trend(latest.bp_systolic, previous.bp_systolic) === 'elevated' ||
          trend(latest.bp_diastolic, previous.bp_diastolic) === 'elevated')
          ? 'elevated'
          : (trend(latest.bp_systolic, previous.bp_systolic) === 'lower' ||
            trend(latest.bp_diastolic, previous.bp_diastolic) === 'lower')
            ? 'lower'
            : 'stable'
        : 'unknown';
    const hrTrend = latest && previous ? trend(latest.heart_rate, previous.heart_rate) : 'unknown';

    return {
      user_id: userId,
      profile_id: profile.id,
      total_records: totalRecords,
      total_consultations: totalConsultations,
      latest_record: latest
        ? {
            bp_systolic: latest.bp_systolic,
            bp_diastolic: latest.bp_diastolic,
            heart_rate: latest.heart_rate,
            current_medications: latest.current_medications,
            notes: latest.notes,
            created_at: latest.created_at,
          }
        : null,
      trends: {
        blood_pressure: bpTrend,
        heart_rate: hrTrend,
      },
      last_consultation: lastConsultation
        ? {
            id: lastConsultation.id,
            reason: lastConsultation.reason,
            status: lastConsultation.status,
            whatsapp_link: lastConsultation.whatsapp_link,
            doctor_response: lastConsultation.doctor_response
              ? JSON.parse(lastConsultation.doctor_response)
              : null,
            created_at: lastConsultation.created_at,
          }
        : null,
    };
  },

  changeUserRole({ targetUserId, role, actorId, actorIp }) {
    if (!['admin', 'patient'].includes(role)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'Invalid role.');
    }
    const user = userRepo.findById(targetUserId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    userRepo.updateRole(targetUserId, role);
    audit.log({ actorId, actorIp, action: 'USER_ROLE_CHANGE', target: targetUserId, status: 'success', meta: { from: user.role, to: role } });
    return { id: targetUserId, role };
  },

  changeUserStatus({ targetUserId, status, actorId, actorIp }) {
    if (!['active', 'suspended'].includes(status)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'Invalid status.');
    }
    const user = userRepo.findById(targetUserId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    userRepo.updateStatus(targetUserId, status);
    audit.log({ actorId, actorIp, action: 'USER_STATUS_CHANGE', target: targetUserId, status: 'success', meta: { from: user.status, to: status } });
    return { id: targetUserId, status };
  },

  deleteUser({ targetUserId, actorId, actorIp }) {
    const user = userRepo.findById(targetUserId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found.');
    if (user.role === 'admin') {
      throw ApiError.badRequest('CANNOT_DELETE_ADMIN', 'Admin accounts cannot be deleted via this endpoint. Use the CLI script.');
    }
    // ON DELETE CASCADE removes profile/records/consultations
    userRepo.deleteById(targetUserId);
    audit.log({ actorId, actorIp, action: 'USER_DELETE', target: targetUserId, status: 'success', meta: { name: user.name, phone: user.phone_number } });
    return { id: targetUserId, deleted: true };
  },

  // ── Settings ──
  getSettings() {
    const rows = settingsRepo.all();
    return rows.reduce((acc, r) => ({ ...acc, [r.key]: r.value }), {});
  },

  updateSettings(updates) {
    const allowed = ['telegram_bot_token', 'telegram_chat_id', 'telegram_alerts_chat_id', 'doctor_whatsapp'];
    const items = Object.entries(updates)
      .filter(([k]) => allowed.includes(k))
      .map(([key, value]) => ({ key, value }));
    settingsRepo.upsertMany(items);
    return Object.fromEntries(items);
  },

  // ── Logs ──
  getRecentRequests({ page = 1, limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = logRepo.recentRequests(safeLimit, safeOffset);
    return { logs: rows, total: logRepo.totalRequests(), page, limit: safeLimit };
  },

  getStatusBreakdown() {
    return logRepo.statusBreakdown();
  },

  getTopEndpoints() {
    return logRepo.topEndpoints(10);
  },
};
