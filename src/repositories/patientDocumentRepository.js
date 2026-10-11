/**
 * PatientDocumentRepository — patient_documents CRUD (append-only).
 *
 * v3 schema: patient_id (= users.id), type (ecg|echo|lab|other), title,
 * taken_at, notes, attachments (JSON array of telegram file refs).
 *
 * Used for ECG / Echo / lab reports the patient uploads as documents
 * (distinct from health_records which carry vitals + Telegram uploads).
 */

const db = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO patient_documents
       (id, patient_id, type, title, taken_at, notes, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  listByPatient: db.prepare(
    `SELECT * FROM patient_documents
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM patient_documents WHERE patient_id = ?`),
  getById: db.prepare(`SELECT * FROM patient_documents WHERE id = ?`),
};

module.exports = {
  insert({ id, patientId, type, title, takenAt, notes, attachments }) {
    stmts.insert.run(
      id,
      patientId,
      type || 'other',
      title || null,
      takenAt || null,
      notes || null,
      attachments || '[]'
    );
  },
  listByPatient(patientId, limit, offset) {
    return stmts.listByPatient.all(patientId, limit, offset);
  },
  countByPatient(patientId) {
    return stmts.countByPatient.get(patientId).c;
  },
  getById(id) { return stmts.getById.get(id) || null; },
};
