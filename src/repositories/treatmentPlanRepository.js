/**
 * TreatmentPlanRepository — treatment_plans + treatment_plan_versions.
 *
 * v3 schema:
 *   treatment_plans: patient_id (= users.id), created_by_admin_id,
 *     recommended_medications (JSON), instructions, follow_up_dates (JSON),
 *     clinical_notes, is_current (1 = latest version).
 *
 *   treatment_plan_versions: snapshot (JSON of the full plan at save time).
 *
 * Creating a new plan: in a transaction, mark previous plans for that patient
 * as is_current=0, insert the new one as is_current=1, then write a snapshot
 * to treatment_plan_versions. The service orchestrates this.
 */

const db = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO treatment_plans
       (id, patient_id, created_by_admin_id, recommended_medications,
        instructions, follow_up_dates, clinical_notes, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  markPreviousNotCurrent: db.prepare(
    `UPDATE treatment_plans SET is_current = 0 WHERE patient_id = ?`
  ),
  getCurrentForPatient: db.prepare(
    `SELECT * FROM treatment_plans
     WHERE patient_id = ? AND is_current = 1
     ORDER BY created_at DESC, id DESC LIMIT 1`
  ),
  getById: db.prepare(`SELECT * FROM treatment_plans WHERE id = ?`),
  listByPatient: db.prepare(
    `SELECT * FROM treatment_plans
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM treatment_plans WHERE patient_id = ?`),

  // ── Versions ──
  insertVersion: db.prepare(
    `INSERT INTO treatment_plan_versions
       (id, patient_id, snapshot, created_by_admin_id)
     VALUES (?, ?, ?, ?)`
  ),
  listVersionsByPatient: db.prepare(
    `SELECT id, patient_id, snapshot, created_by_admin_id, created_at
     FROM treatment_plan_versions
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countVersionsByPatient: db.prepare(
    `SELECT COUNT(*) as c FROM treatment_plan_versions WHERE patient_id = ?`
  ),
};

module.exports = {
  insert({ id, patientId, createdByAdminId, recommendedMedications,
           instructions, followUpDates, clinicalNotes, isCurrent = 1 }) {
    stmts.insert.run(
      id,
      patientId,
      createdByAdminId,
      JSON.stringify(recommendedMedications || []),
      instructions || null,
      JSON.stringify(followUpDates || []),
      clinicalNotes || null,
      isCurrent ? 1 : 0
    );
  },
  markPreviousNotCurrent(patientId) {
    return stmts.markPreviousNotCurrent.run(patientId);
  },
  getCurrentForPatient(patientId) { return stmts.getCurrentForPatient.get(patientId) || null; },
  getById(id) { return stmts.getById.get(id) || null; },
  listByPatient(patientId, limit, offset) {
    return stmts.listByPatient.all(patientId, limit, offset);
  },
  countByPatient(patientId) {
    return stmts.countByPatient.get(patientId).c;
  },

  insertVersion({ id, patientId, snapshot, createdByAdminId }) {
    stmts.insertVersion.run(id, patientId, snapshot, createdByAdminId || null);
  },
  listVersionsByPatient(patientId, limit, offset) {
    return stmts.listVersionsByPatient.all(patientId, limit, offset);
  },
  countVersionsByPatient(patientId) {
    return stmts.countVersionsByPatient.get(patientId).c;
  },
};
