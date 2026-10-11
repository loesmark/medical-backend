/**
 * PatientProfileService — the FULL patient profile (basic row + selections +
 * version snapshots).
 *
 * getProfile(userId) → the basic row + all selections (with catalog names
 *   joined so the patient sees "Diabetes" rather than just an id).
 *
 * updateProfile(userId, { birth_date, smoking_status, additional_info,
 *   diseases[], surgeries[], symptoms[], medications[] }) — ONE transaction:
 *   1. Update the basic patient_profiles row (require birth_date on first
 *      completion — i.e. when the existing row has a NULL birth_date).
 *   2. REPLACE the selections (diseases / surgeries / symptoms / medications)
 *      by deleting the old rows and inserting the new ones.
 *   3. Create a patient_profile_versions snapshot of the full state so the
 *      admin can later browse the patient's history.
 *
 * listVersions(userId, opts) → paginated version snapshots (newest first).
 *
 * Note: the `name` and `phone_number` fields live on `users`, not on
 * patient_profiles. Updating them goes through authService.updateProfile
 * (the doctor) or a separate patient self-management endpoint (out of scope
 * for V3-CODE — the spec only covers birth_date / smoking_status /
 * additional_info on the profile row).
 */

const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const patientRepo = require('../repositories/patientRepository');
const profileRepo = require('../repositories/patientProfileRepository');

function validDate(s) {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildFullProfile(profile) {
  if (!profile) return null;
  const selections = {
    diseases:    profileRepo.listDiseasesByProfileJoined(profile.id),
    surgeries:  profileRepo.listSurgeriesByProfileJoined(profile.id),
    symptoms:    profileRepo.listSymptomsByProfileJoined(profile.id),
    medications: profileRepo.listMedicationsByProfileJoined(profile.id),
  };
  return {
    id: profile.id,
    user_id: profile.user_id,
    birth_date: profile.birth_date,
    smoking_status: profile.smoking_status,
    additional_info: profile.additional_info,
    updated_at: profile.updated_at,
    selections,
  };
}

module.exports = {
  getProfile(userId) {
    const profile = patientRepo.getProfileByUserId(userId);
    return buildFullProfile(profile); // null if profile row doesn't exist
  },

  updateProfile(userId, payload) {
    const profile = patientRepo.getProfileByUserId(userId);
    if (!profile) throw ApiError.notFound('PROFILE_NOT_FOUND', 'Patient profile not found.');

    const birthDate = validDate(payload.birth_date);
    // First-completion rule: if the stored row has no birth_date, the request
    // must supply one. After that, birth_date can be left untouched (the
    // patient just edits smoking_status / additional_info / selections).
    if (!profile.birth_date && !birthDate) {
      throw ApiError.badRequest(
        'BIRTH_DATE_REQUIRED',
        'birth_date is required on first profile completion.'
      );
    }

    const nextBirthDate = birthDate || profile.birth_date;
    const nextSmoking = payload.smoking_status !== undefined ? (payload.smoking_status || null) : profile.smoking_status;
    const nextInfo = payload.additional_info !== undefined ? (payload.additional_info || null) : profile.additional_info;

    const diseases = Array.isArray(payload.diseases) ? payload.diseases : [];
    const surgeries = Array.isArray(payload.surgeries) ? payload.surgeries : [];
    const symptoms = Array.isArray(payload.symptoms) ? payload.symptoms : [];
    const medications = Array.isArray(payload.medications) ? payload.medications : [];

    // ── Transaction: update row → replace selections → write snapshot ──
    db.tx(() => {
      patientRepo.updateProfile({
        userId,
        birthDate: nextBirthDate,
        smokingStatus: nextSmoking,
        additionalInfo: nextInfo,
      });

      if (diseases.length) {
        profileRepo.replaceDiseases(profile.id, diseases, uuidv4);
      } else {
        profileRepo.replaceDiseases(profile.id, [], uuidv4);
      }
      if (surgeries.length) profileRepo.replaceSurgeries(profile.id, surgeries, uuidv4);
      else profileRepo.replaceSurgeries(profile.id, [], uuidv4);
      if (symptoms.length) profileRepo.replaceSymptoms(profile.id, symptoms, uuidv4);
      else profileRepo.replaceSymptoms(profile.id, [], uuidv4);
      if (medications.length) profileRepo.replaceMedications(profile.id, medications, uuidv4);
      else profileRepo.replaceMedications(profile.id, [], uuidv4);

      // ── Snapshot for the version history (full state at save time) ──
      const fresh = patientRepo.getProfileByUserId(userId);
      const snapshot = JSON.stringify({
        profile: {
          id: fresh.id,
          birth_date: fresh.birth_date,
          smoking_status: fresh.smoking_status,
          additional_info: fresh.additional_info,
        },
        diseases:    profileRepo.listDiseasesByProfile(fresh.id),
        surgeries:  profileRepo.listSurgeriesByProfile(fresh.id),
        symptoms:    profileRepo.listSymptomsByProfile(fresh.id),
        medications: profileRepo.listMedicationsByProfile(fresh.id),
      });
      profileRepo.insertVersion({
        id: uuidv4(),
        patientId: userId,
        snapshot,
      });
    });

    logger.info('patientProfileService', `Profile updated: ${userId}`);
    return buildFullProfile(patientRepo.getProfileByUserId(userId));
  },

  listVersions(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = profileRepo.listVersionsByPatient(userId, safeLimit, safeOffset);
    const total = profileRepo.countVersionsByPatient(userId);
    return {
      versions: rows.map((r) => ({
        id: r.id,
        patient_id: r.patient_id,
        snapshot: JSON.parse(r.snapshot || 'null'),
        created_at: r.created_at,
      })),
      total,
      page,
      limit: safeLimit,
    };
  },
};
