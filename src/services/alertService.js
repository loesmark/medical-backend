/**
 * AlertService — admin threshold CRUD + the threshold evaluation logic.
 *
 * The EVALUATION functions (evaluateRecord / evaluateSymptoms / freshness)
 * are called from healthRecordService.addRecord + symptomLogService.addLog
 * AFTER the record/symptom-log row has been inserted (so we can write the
 * foreign-key back to alerts.health_record_id / alerts.symptom_log_id).
 *
 * Operator semantics:
 *   '>'  → triggers when value > threshold
 *   '>=' → triggers when value >= threshold
 *   '<'  → triggers when value < threshold
 *   '<=' → triggers when value <= threshold
 * Per threshold, critical_value takes precedence over warning_value.
 */

const { v4: uuidv4 } = require('uuid');

const alertRepo = require('../repositories/alertRepository');
const settingsRepo = require('../repositories/settingsRepository');
const userRepo = require('../repositories/userRepository');
const telegramService = require('./telegramService');
const ApiError = require('../utils/ApiError');
const audit = require('../middleware/auditLog');
const logger = require('../utils/logger');

const ALLOWED_PARAMS = ['bp_systolic', 'bp_diastolic', 'heart_rate'];
const ALLOWED_OPERATORS = ['>', '>=', '<', '<='];

function crosses(value, threshold, op) {
  if (value == null || threshold == null || op == null) return false;
  const v = Number(value);
  const t = Number(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t)) return false;
  switch (op) {
    case '>':  return v > t;
    case '>=': return v >= t;
    case '<':  return v < t;
    case '<=': return v <= t;
    default:   return false;
  }
}

/**
 * freshness(latestRecord) → 'fresh' | 'old' | 'none'
 *   fresh = recorded within the last 24h
 *   old   = older than 24h
 *   none  = no records yet
 *
 * `created_at` is stored as UTC seconds; we append 'Z' so Date parses it as UTC.
 */
function freshness(latestRecord) {
  if (!latestRecord || !latestRecord.created_at) return 'none';
  const ts = new Date(latestRecord.created_at + 'Z').getTime();
  if (!Number.isFinite(ts)) return 'none';
  const ageHours = (Date.now() - ts) / 3600000;
  return ageHours <= 24 ? 'fresh' : 'old';
}

module.exports = {
  // ── Threshold CRUD (admin) ──
  listThresholds({ page = 1, limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = alertRepo.listThresholdsPaged(safeLimit, safeOffset);
    const total = alertRepo.countThresholds();
    return { thresholds: rows, total, page, limit: safeLimit };
  },

  createThreshold({ adminId, parameter_name, warning_value, critical_value, operator, is_active }) {
    if (!ALLOWED_PARAMS.includes(parameter_name)) {
      throw ApiError.badRequest('VALIDATION_FAILED', `parameter_name must be one of: ${ALLOWED_PARAMS.join(', ')}`);
    }
    if (!ALLOWED_OPERATORS.includes(operator || '>')) {
      throw ApiError.badRequest('VALIDATION_FAILED', `operator must be one of: ${ALLOWED_OPERATORS.join(', ')}`);
    }
    const id = uuidv4();
    alertRepo.insertThreshold({
      id,
      adminId,
      parameterName: parameter_name,
      warningValue: warning_value,
      criticalValue: critical_value,
      operator: operator || '>',
      isActive: is_active !== false,
    });
    return alertRepo.getThresholdById(id);
  },

  updateThreshold(id, { parameter_name, warning_value, critical_value, operator, is_active }) {
    const existing = alertRepo.getThresholdById(id);
    if (!existing) throw ApiError.notFound('THRESHOLD_NOT_FOUND', 'Threshold not found.');
    const next = {
      parameterName: parameter_name || existing.parameter_name,
      warningValue: warning_value ?? existing.warning_value,
      criticalValue: critical_value ?? existing.critical_value,
      operator: operator || existing.operator,
      isActive: is_active !== undefined ? is_active : !!existing.is_active,
    };
    if (!ALLOWED_PARAMS.includes(next.parameterName)) {
      throw ApiError.badRequest('VALIDATION_FAILED', `parameter_name must be one of: ${ALLOWED_PARAMS.join(', ')}`);
    }
    if (!ALLOWED_OPERATORS.includes(next.operator)) {
      throw ApiError.badRequest('VALIDATION_FAILED', `operator must be one of: ${ALLOWED_OPERATORS.join(', ')}`);
    }
    alertRepo.updateThreshold(id, next);
    return alertRepo.getThresholdById(id);
  },

  deleteThreshold(id) {
    const existing = alertRepo.getThresholdById(id);
    if (!existing) throw ApiError.notFound('THRESHOLD_NOT_FOUND', 'Threshold not found.');
    alertRepo.deleteThreshold(id);
    return { id, deleted: true };
  },

  // ── Alerts list + lifecycle (admin) ──
  listAlerts({ page = 1, limit = 50, status, severity, patient_id } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = alertRepo.listAlertsJoined({
      status, severity, patientId: patient_id, limit: safeLimit, offset: safeOffset,
    });
    const total = alertRepo.countAlerts({ status, severity, patientId: patient_id });
    return { alerts: rows, total, page, limit: safeLimit };
  },

  unreadCount() {
    return { unread_count: alertRepo.unreadCount() };
  },

  markRead(id) {
    const existing = alertRepo.getById(id);
    if (!existing) throw ApiError.notFound('ALERT_NOT_FOUND', 'Alert not found.');
    alertRepo.markRead(id);
    return { id, status: 'read' };
  },

  markResolved(id, { actorId, actorIp } = {}) {
    const existing = alertRepo.getById(id);
    if (!existing) throw ApiError.notFound('ALERT_NOT_FOUND', 'Alert not found.');
    alertRepo.markResolved(id);
    if (actorId) {
      audit.log({
        actorId, actorIp,
        action: 'ALERT_RESOLVED', target: String(id), status: 'success',
        meta: { parameter_name: existing.parameter_name, severity: existing.severity },
      });
    }
    return { id, status: 'resolved' };
  },

  // ── Threshold EVALUATION ──
  // Called by healthRecordService AFTER inserting the health_record row.
  // patientId = users.id; healthRecordId = the just-inserted health_record.id.
  // vitals = { bp_systolic, bp_diastolic, heart_rate }.
  // Returns the list of triggered alerts (without re-fetching).
  evaluateRecord(patientId, healthRecordId, vitals) {
    const paramNames = Object.keys(vitals || {}).filter(
      (k) => vitals[k] != null && ALLOWED_PARAMS.includes(k)
    );
    if (!paramNames.length) return [];
    const thresholds = alertRepo.listActiveByParams(paramNames);
    const triggered = [];
    for (const t of thresholds) {
      const value = vitals[t.parameter_name];
      if (value == null) continue;
      let severity = null;
      let thresholdValue = null;
      if (crosses(value, t.critical_value, t.operator)) {
        severity = 'critical';
        thresholdValue = t.critical_value;
      } else if (crosses(value, t.warning_value, t.operator)) {
        severity = 'warning';
        thresholdValue = t.warning_value;
      }
      if (severity) {
        const alert = alertRepo.insertAlert({
          patientId,
          healthRecordId,
          symptomLogId: null,
          parameterName: t.parameter_name,
          value,
          thresholdValue,
          severity,
        });
        triggered.push(alert);
        // Fire Telegram notification for CRITICAL alerts (non-blocking)
        if (severity === 'critical') {
          notifyTelegramCritical(patientId, `🚨 *Critical alert*\n*Patient:* ${patientNameSafe(patientId)}\n*Parameter:* ${t.parameter_name}\n*Value:* ${value}\n*Threshold:* ${thresholdValue} ${t.operator}\nReview in the admin dashboard.`);
        }
      }
    }
    return triggered;
  },

  // Called by symptomLogService AFTER inserting the symptom_log row.
  // symptoms = array of { symptom_id, custom_name } OR catalog rows. We check
  // whether the catalog symptom is_critical and emit a 'critical' alert per
  // critical symptom. (custom_name-only entries have no catalog flag, so
  // they never trigger an alert here — the doctor can review them manually.)
  evaluateSymptoms(patientId, symptomLogId, symptoms) {
    if (!Array.isArray(symptoms) || !symptoms.length) return [];
    // Only catalog-linked symptoms can be critical-flagged
    const ids = symptoms.map((s) => s && s.symptom_id).filter(Boolean);
    if (!ids.length) return [];
    // Use a small inline query — this is hot but bounded (a symptom log
    // carries typically 1-5 symptoms).
    const db = require('../db');
    const rows = db
      .prepare(`SELECT id, name, is_critical FROM symptoms WHERE id IN (SELECT value FROM json_each(?)) AND is_critical = 1`)
      .all(JSON.stringify(ids));
    const triggered = [];
    for (const r of rows) {
      triggered.push(
        alertRepo.insertAlert({
          patientId,
          healthRecordId: null,
          symptomLogId,
          parameterName: r.name,
          value: r.name,
          thresholdValue: null,
          severity: 'critical',
        })
      );
      // Fire Telegram notification for critical-symptom alerts (non-blocking)
      notifyTelegramCritical(patientId, `🚨 *Critical symptom alert*\n*Patient:* ${patientNameSafe(patientId)}\n*Symptom:* ${r.name}\nThe patient reported a critical symptom — review immediately in the admin dashboard.`);
    }
    return triggered;
  },

  // Exposed for reuse by consultationService when building context.
  freshness,
};

// ── Helpers (not exported) ──

// Fetch patient name by id (cached per-request; cheap indexed lookup).
// Returns the name or the id if not found.
function patientNameSafe(patientId) {
  try {
    const u = userRepo.findById(patientId);
    return u ? u.name : patientId;
  } catch {
    return patientId;
  }
}

// Fire-and-forget Telegram alert. Never throws, never blocks the request.
function notifyTelegramCritical(patientId, text) {
  // Fire the promise but don't await — the request must return immediately.
  telegramService.sendAlertMessage(settingsRepo, text).catch((err) => {
    logger.warn('alertService', `Telegram notify failed: ${err.message}`);
  });
}
