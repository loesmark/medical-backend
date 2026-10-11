/**
 * SymptomLogRepository — symptom_logs CRUD.
 *
 * v3 schema: patient_id (= users.id), symptoms (JSON array of
 *   {symptom_id, custom_name}), custom_text, health_record_id (nullable).
 *
 * Standalone symptom entries (no vitals measurement). When the patient
 * submits symptoms WITH a vitals reading, the symptom_log row is linked
 * back to the new health_record via health_record_id.
 */

const db = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO symptom_logs
       (id, patient_id, symptoms, custom_text, health_record_id)
     VALUES (?, ?, ?, ?, ?)`
  ),
  listByPatient: db.prepare(
    `SELECT * FROM symptom_logs
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM symptom_logs WHERE patient_id = ?`),
  getById: db.prepare(`SELECT * FROM symptom_logs WHERE id = ?`),
  latestForPatient: db.prepare(
    `SELECT * FROM symptom_logs
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`
  ),
};

module.exports = {
  insert({ id, patientId, symptoms, customText, healthRecordId }) {
    stmts.insert.run(
      id,
      patientId,
      JSON.stringify(symptoms || []),
      customText || null,
      healthRecordId || null
    );
  },
  listByPatient(patientId, limit, offset) {
    return stmts.listByPatient.all(patientId, limit, offset);
  },
  countByPatient(patientId) {
    return stmts.countByPatient.get(patientId).c;
  },
  getById(id) { return stmts.getById.get(id) || null; },
  latestForPatient(patientId) { return stmts.latestForPatient.get(patientId) || null; },
};
