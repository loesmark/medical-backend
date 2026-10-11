/**
 * PatientRepository — the BASIC patient_profiles row only.
 *
 * In the v3 schema, patient_profiles stores just the basic identity fields:
 *   id, user_id, birth_date, smoking_status, additional_info, updated_at.
 *
 * Richer profile data (diseases / surgeries / symptoms / medications selections
 * and version snapshots) lives in patientProfileRepository — this file stays
 * focused on the row that the auth + admin flows read/write.
 *
 * Health records, consultations, appointments, etc. have been moved to their
 * own repositories (healthRecordRepository, consultationRepository, …).
 */

const db = require('../db');

const stmts = {
  getProfileByUserId: db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?'),
  getProfileById: db.prepare('SELECT * FROM patient_profiles WHERE id = ?'),
  insertProfile: db.prepare(
    `INSERT INTO patient_profiles (id, user_id, birth_date, smoking_status, additional_info)
     VALUES (?, ?, ?, ?, ?)`
  ),
  updateProfile: db.prepare(
    `UPDATE patient_profiles
       SET birth_date = ?, smoking_status = ?, additional_info = ?
     WHERE user_id = ?`
  ),
};

module.exports = {
  getProfileByUserId(userId) { return stmts.getProfileByUserId.get(userId) || null; },
  getProfileById(id) { return stmts.getProfileById.get(id) || null; },

  insertProfile({ id, userId, birthDate, smokingStatus, additionalInfo }) {
    stmts.insertProfile.run(
      id,
      userId,
      birthDate || null,
      smokingStatus || null,
      additionalInfo || null
    );
  },

  updateProfile({ userId, birthDate, smokingStatus, additionalInfo }) {
    return stmts.updateProfile.run(
      birthDate || null,
      smokingStatus || null,
      additionalInfo || null,
      userId
    );
  },
};
