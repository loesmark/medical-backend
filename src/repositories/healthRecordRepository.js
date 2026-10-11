/**
 * HealthRecordRepository — health_records CRUD + the cross-patient
 * "recent records" view + the latest/previous-record trend queries.
 *
 * v3 schema columns: bp_systolic, bp_diastolic, heart_rate,
 * current_medications, notes, attachments (JSON), symptom_log_id.
 *
 * patient_id column = patient_profiles.id (FK).
 */

const db = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO health_records
       (id, patient_id, bp_systolic, bp_diastolic, heart_rate,
        current_medications, notes, attachments, symptom_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  // rowid tiebreaker: created_at is second-resolution, so two rows added in the
  // same second need a deterministic order. rowid is implicit insertion order.
  listByPatient: db.prepare(
    `SELECT * FROM health_records
     WHERE patient_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM health_records WHERE patient_id = ?`),
  getById: db.prepare(`SELECT * FROM health_records WHERE id = ?`),
  getByIdJoined: db.prepare(`
    SELECT hr.*,
           pp.id AS profile_id, pp.user_id,
           u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM health_records hr
    JOIN patient_profiles pp ON pp.id = hr.patient_id
    JOIN users u ON u.id = pp.user_id
    WHERE hr.id = ?
  `),

  // ── Latest + previous for trend (per profile) ──
  latestForProfile: db.prepare(`
    SELECT id, bp_systolic, bp_diastolic, heart_rate, current_medications,
           notes, attachments, created_at
    FROM health_records
    WHERE patient_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `),
  previousForProfile: db.prepare(`
    SELECT bp_systolic, bp_diastolic, heart_rate
    FROM health_records
    WHERE patient_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET 1
  `),

  // ── Recent records across ALL patients (admin Recent Cases view) ──
  recentRecords: db.prepare(`
    SELECT hr.id AS record_id, hr.bp_systolic, hr.bp_diastolic, hr.heart_rate,
           hr.current_medications, hr.notes, hr.attachments, hr.created_at,
           pp.id AS profile_id, pp.user_id, u.name AS patient_name,
           u.phone_number AS patient_phone, u.status AS patient_status
    FROM health_records hr
    JOIN patient_profiles pp ON pp.id = hr.patient_id
    JOIN users u ON u.id = pp.user_id
    ORDER BY hr.created_at DESC, hr.rowid DESC
    LIMIT ? OFFSET ?
  `),
  countRecentRecords: db.prepare(`SELECT COUNT(*) AS c FROM health_records`),
};

module.exports = {
  insert({ id, patientId, bpSystolic, bpDiastolic, heartRate,
           currentMedications, notes, attachments, symptomLogId }) {
    stmts.insert.run(
      id,
      patientId,
      bpSystolic ?? null,
      bpDiastolic ?? null,
      heartRate ?? null,
      currentMedications || null,
      notes || null,
      attachments || '[]',
      symptomLogId || null
    );
  },

  listByPatient(profileId, limit, offset) {
    return stmts.listByPatient.all(profileId, limit, offset);
  },
  countByPatient(profileId) {
    return stmts.countByPatient.get(profileId).c;
  },

  getById(id) { return stmts.getById.get(id) || null; },
  getByIdJoined(id) { return stmts.getByIdJoined.get(id) || null; },

  latestForProfile(profileId) { return stmts.latestForProfile.get(profileId) || null; },
  previousForProfile(profileId) { return stmts.previousForProfile.get(profileId) || null; },

  recentRecords(limit, offset) { return stmts.recentRecords.all(limit, offset); },
  countRecentRecords() { return stmts.countRecentRecords.get().c; },
};
