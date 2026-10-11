/**
 * AlertRepository — alert_thresholds CRUD + alerts (generated) CRUD.
 *
 * v3 schema:
 *   alert_thresholds: parameter_name (bp_systolic|bp_diastolic|heart_rate),
 *     warning_value, critical_value, operator (>|<|>=|<=), is_active.
 *
 *   alerts: AUTOINCREMENT id, patient_id (= users.id), health_record_id,
 *     symptom_log_id, parameter_name, value, threshold_value, severity
 *     (warning|critical), status (unread|read|resolved), read_at.
 *
 * The threshold EVALUATION logic lives in alertService — this repo only does
 * CRUD + provides the queries the service needs (list active thresholds by
 * parameter, insert alerts, list alerts with filters).
 */

const db = require('../db');

const stmts = {
  // ── Thresholds ──
  listThresholds: db.prepare(
    `SELECT * FROM alert_thresholds ORDER BY parameter_name ASC, created_at DESC`
  ),
  listThresholdsPaged: db.prepare(
    `SELECT * FROM alert_thresholds
     ORDER BY parameter_name ASC, created_at DESC
     LIMIT ? OFFSET ?`
  ),
  countThresholds: db.prepare(`SELECT COUNT(*) as c FROM alert_thresholds`),
  listActiveByParams: db.prepare(
    `SELECT * FROM alert_thresholds
     WHERE is_active = 1
       AND parameter_name IN (SELECT value FROM json_each(?))`
  ),
  getThresholdById: db.prepare(`SELECT * FROM alert_thresholds WHERE id = ?`),
  insertThreshold: db.prepare(
    `INSERT INTO alert_thresholds
       (id, admin_id, parameter_name, warning_value, critical_value, operator, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  updateThreshold: db.prepare(
    `UPDATE alert_thresholds
        SET parameter_name = ?, warning_value = ?, critical_value = ?,
            operator = ?, is_active = ?
      WHERE id = ?`
  ),
  deleteThreshold: db.prepare(`DELETE FROM alert_thresholds WHERE id = ?`),
  deactivateThreshold: db.prepare(`UPDATE alert_thresholds SET is_active = 0 WHERE id = ?`),

  // ── Alerts ──
  insertAlert: db.prepare(
    `INSERT INTO alerts
       (patient_id, health_record_id, symptom_log_id, parameter_name,
        value, threshold_value, severity, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unread')`
  ),
  // Returns the alert with the joined patient (admin view)
  listAlertsJoined: db.prepare(`
    SELECT a.*,
           u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM alerts a
    JOIN users u ON u.id = a.patient_id
    WHERE 1=1
      AND (@status IS NULL OR a.status = @status)
      AND (@severity IS NULL OR a.severity = @severity)
      AND (@patient_id IS NULL OR a.patient_id = @patient_id)
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT @limit OFFSET @offset
  `),
  countAlerts: db.prepare(`
    SELECT COUNT(*) as c
    FROM alerts a
    WHERE 1=1
      AND (@status IS NULL OR a.status = @status)
      AND (@severity IS NULL OR a.severity = @severity)
      AND (@patient_id IS NULL OR a.patient_id = @patient_id)
  `),
  unreadCount: db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE status = 'unread'`),
  markRead: db.prepare(
    `UPDATE alerts SET status = 'read', read_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'unread'`
  ),
  markResolved: db.prepare(
    `UPDATE alerts SET status = 'resolved', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE id = ?`
  ),
  getById: db.prepare(`SELECT * FROM alerts WHERE id = ?`),
};

module.exports = {
  // ── Thresholds ──
  listThresholds() { return stmts.listThresholds.all(); },
  listThresholdsPaged(limit, offset) { return stmts.listThresholdsPaged.all(limit, offset); },
  countThresholds() { return stmts.countThresholds.get().c; },
  // params = ['bp_systolic','bp_diastolic','heart_rate']
  listActiveByParams(params) {
    return stmts.listActiveByParams.all(JSON.stringify(params || []));
  },
  getThresholdById(id) { return stmts.getThresholdById.get(id) || null; },
  insertThreshold({ id, adminId, parameterName, warningValue, criticalValue, operator, isActive = true }) {
    stmts.insertThreshold.run(
      id,
      adminId,
      parameterName,
      warningValue ?? null,
      criticalValue ?? null,
      operator || '>',
      isActive ? 1 : 0
    );
  },
  updateThreshold(id, { parameterName, warningValue, criticalValue, operator, isActive }) {
    return stmts.updateThreshold.run(
      parameterName,
      warningValue ?? null,
      criticalValue ?? null,
      operator || '>',
      isActive ? 1 : 0,
      id
    );
  },
  deleteThreshold(id) { return stmts.deleteThreshold.run(id); },
  deactivateThreshold(id) { return stmts.deactivateThreshold.run(id); },

  // ── Alerts ──
  insertAlert({ patientId, healthRecordId, symptomLogId, parameterName, value, thresholdValue, severity }) {
    const r = stmts.insertAlert.run(
      patientId,
      healthRecordId || null,
      symptomLogId || null,
      parameterName || null,
      value != null ? String(value) : null,
      thresholdValue ?? null,
      severity
    );
    return { id: r.lastInsertRowid, severity };
  },

  listAlertsJoined({ status, severity, patientId, limit, offset }) {
    return stmts.listAlertsJoined.all({
      status: status || null,
      severity: severity || null,
      patient_id: patientId || null,
      limit,
      offset,
    });
  },
  countAlerts({ status, severity, patientId }) {
    return stmts.countAlerts.get({
      status: status || null,
      severity: severity || null,
      patient_id: patientId || null,
    }).c;
  },
  unreadCount() { return stmts.unreadCount.get().c; },
  getById(id) { return stmts.getById.get(id) || null; },
  markRead(id) { return stmts.markRead.run(id); },
  markResolved(id) { return stmts.markResolved.run(id); },
};
