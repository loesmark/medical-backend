/**
 * TreatmentPlanService — admin create/update plan + patient get current +
 * list versions.
 *
 * Creating a new plan: in a SINGLE transaction:
 *   1. Mark all previous plans for this patient as is_current = 0
 *   2. Insert the new plan with is_current = 1
 *   3. Write a snapshot of the new plan into treatment_plan_versions
 *
 * Updating an existing plan: same flow as create (the new version replaces
 * the old current). We keep the prior rows in the table — they just have
 * is_current=0 — so the patient + admin can browse history via /versions.
 */

const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const planRepo = require('../repositories/treatmentPlanRepository');
const userRepo = require('../repositories/userRepository');
const audit = require('../middleware/auditLog');

function planToJsonFields(plan) {
  if (!plan) return null;
  return {
    ...plan,
    recommended_medications: JSON.parse(plan.recommended_medications || '[]'),
    follow_up_dates: JSON.parse(plan.follow_up_dates || '[]'),
  };
}

module.exports = {
  // ── Admin: create / update-by-creating-new-version ──
  create({ patient_id, admin_id, recommended_medications, instructions,
           follow_up_dates, clinical_notes, actorId, actorIp }) {
    const patient = userRepo.findById(patient_id);
    if (!patient || patient.role !== 'patient') {
      throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found.');
    }
    const id = uuidv4();
    db.tx(() => {
      // Mark previous plans as not current
      planRepo.markPreviousNotCurrent(patient_id);
      // Insert the new current plan
      planRepo.insert({
        id,
        patientId: patient_id,
        createdByAdminId: admin_id,
        recommendedMedications: recommended_medications,
        instructions,
        followUpDates: follow_up_dates,
        clinicalNotes: clinical_notes,
        isCurrent: 1,
      });
      // Snapshot to versions
      planRepo.insertVersion({
        id: uuidv4(),
        patientId: patient_id,
        snapshot: JSON.stringify({
          plan_id: id,
          recommended_medications: recommended_medications || [],
          instructions: instructions || null,
          follow_up_dates: follow_up_dates || [],
          clinical_notes: clinical_notes || null,
        }),
        createdByAdminId: admin_id,
      });
    });
    if (actorId) {
      audit.log({
        actorId, actorIp,
        action: 'TREATMENT_PLAN_CREATED', target: patient_id, status: 'success',
        meta: { plan_id: id },
      });
    }
    logger.info('treatmentPlanService', `Plan created for ${patient_id}: ${id}`);
    return planToJsonFields(planRepo.getById(id));
  },

  // ── Patient: get current plan ──
  getCurrentForPatient(userId) {
    return planToJsonFields(planRepo.getCurrentForPatient(userId));
  },

  // ── Patient: list versions ──
  listVersions(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = planRepo.listVersionsByPatient(userId, safeLimit, safeOffset);
    const total = planRepo.countVersionsByPatient(userId);
    return {
      versions: rows.map((r) => ({
        id: r.id,
        patient_id: r.patient_id,
        snapshot: JSON.parse(r.snapshot || 'null'),
        created_by_admin_id: r.created_by_admin_id,
        created_at: r.created_at,
      })),
      total,
      page,
      limit: safeLimit,
    };
  },

  // ── Admin: list all versions for a patient (same data) ──
  listVersionsForPatient(userId, opts) {
    return this.listVersions(userId, opts);
  },
};
