/**
 * ConsultationRepository — consultations CRUD.
 *
 * v3 schema: type_id (nullable) | custom_type | reason | category
 *   (immediate|regular) | status (pending|responded|closed) | context (JSON)
 *   | doctor_response (JSON) | whatsapp_link | attachment (JSON) | responded_at.
 *
 * patient_id column = users.id (FK).
 *
 * The context JSON is built in consultationService.create and stored here
 * verbatim. The doctor_response JSON is set when admin responds.
 */

const db = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO consultations
       (id, patient_id, type_id, custom_type, reason, category,
        status, context, whatsapp_link, attachment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  listByPatient: db.prepare(
    `SELECT * FROM consultations
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM consultations WHERE patient_id = ?`),
  getById: db.prepare(`SELECT * FROM consultations WHERE id = ?`),
  getByIdJoined: db.prepare(`
    SELECT c.*,
           ct.name AS type_name, ct.category AS type_category,
           u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM consultations c
    LEFT JOIN consultation_types ct ON ct.id = c.type_id
    JOIN users u ON u.id = c.patient_id
    WHERE c.id = ?
  `),
  listAll: db.prepare(`
    SELECT c.*,
           ct.name AS type_name, ct.category AS type_category,
           u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM consultations c
    LEFT JOIN consultation_types ct ON ct.id = c.type_id
    JOIN users u ON u.id = c.patient_id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `),
  // ── Filters (status / category) — built dynamically because express-validator
  // sanitizes but we don't want SQL injection via string concat. ──
  listAllFiltered: (filters) => db.prepare(`
    SELECT c.*,
           ct.name AS type_name, ct.category AS type_category,
           u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM consultations c
    LEFT JOIN consultation_types ct ON ct.id = c.type_id
    JOIN users u ON u.id = c.patient_id
    WHERE 1=1
      ${filters.status ? 'AND c.status = @status' : ''}
      ${filters.category ? 'AND c.category = @category' : ''}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT @limit OFFSET @offset
  `),
  countAll: db.prepare(`SELECT COUNT(*) as c FROM consultations`),
  countAllFiltered: (filters) => db.prepare(`
    SELECT COUNT(*) as c
    FROM consultations c
    WHERE 1=1
      ${filters.status ? 'AND c.status = @status' : ''}
      ${filters.category ? 'AND c.category = @category' : ''}
  `),

  respond: db.prepare(
    `UPDATE consultations
        SET doctor_response = ?, status = 'responded', responded_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ),
  close: db.prepare(`UPDATE consultations SET status = 'closed' WHERE id = ?`),

  // ── Rate limit: max 3 immediate/day/patient ──
  countImmediateToday: db.prepare(
    `SELECT COUNT(*) as c
     FROM consultations
     WHERE patient_id = ?
       AND category = 'immediate'
       AND created_at >= datetime('now','start of day')`
  ),

  // ── For admin patient summary ──
  lastForPatient: db.prepare(
    `SELECT id, reason, status, whatsapp_link, doctor_response, created_at
     FROM consultations WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`
  ),
  totalForPatient: db.prepare(`SELECT COUNT(*) AS c FROM consultations WHERE patient_id = ?`),
};

module.exports = {
  insert({ id, patientId, typeId, customType, reason, category,
           context, whatsappLink, attachment }) {
    stmts.insert.run(
      id,
      patientId,
      typeId || null,
      customType || null,
      reason,
      category,
      'pending',
      context || null,
      whatsappLink || null,
      attachment || '[]'
    );
  },

  listByPatient(patientId, limit, offset) {
    return stmts.listByPatient.all(patientId, limit, offset);
  },
  countByPatient(patientId) {
    return stmts.countByPatient.get(patientId).c;
  },
  getById(id) { return stmts.getById.get(id) || null; },
  getByIdJoined(id) { return stmts.getByIdJoined.get(id) || null; },

  listAll({ status, category, limit, offset }) {
    const filters = { status, category };
    return stmts.listAllFiltered(filters).all({
      status: status || null,
      category: category || null,
      limit,
      offset,
    });
  },
  countAll({ status, category }) {
    const filters = { status, category };
    return stmts.countAllFiltered(filters).get({
      status: status || null,
      category: category || null,
    }).c;
  },

  respond(id, doctorResponseJson) {
    return stmts.respond.run(doctorResponseJson, id);
  },
  close(id) { return stmts.close.run(id); },

  countImmediateToday(patientId) {
    return stmts.countImmediateToday.get(patientId).c;
  },

  lastForPatient(patientId) { return stmts.lastForPatient.get(patientId) || null; },
  totalForPatient(patientId) { return stmts.totalForPatient.get(patientId).c; },
};
