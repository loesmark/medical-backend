/**
 * PatientProfileRepository — the full patient profile (basic row + selections).
 *
 * Handles:
 *   - patient_profiles row (basic — actual CRUD lives in patientRepository)
 *   - patient_diseases, patient_surgeries, patient_symptoms, patient_medications
 *     (selections with optional custom_name)
 *   - patient_profile_versions (JSON snapshots for history)
 *   - listPatientsWithProfile() — admin "patients" listing joined with the
 *     basic profile row using the v3 columns (birth_date / smoking_status /
 *     additional_info). Kept HERE (not in userRepository) so userRepository
 *     stays untouched per the v3 spec.
 *
 * All write operations are wrapped in a single transaction by the service
 * (patientProfileService.updateProfile) so the snapshot always reflects the
 * exact state that was just saved.
 */

const db = require('../db');

const stmts = {
  // ── Selections: diseases ──
  deleteDiseasesByProfile: db.prepare(`DELETE FROM patient_diseases WHERE patient_profile_id = ?`),
  insertDisease: db.prepare(
    `INSERT INTO patient_diseases (id, patient_profile_id, disease_id, custom_name)
     VALUES (?, ?, ?, ?)`
  ),
  listDiseasesByProfile: db.prepare(
    `SELECT id, disease_id, custom_name, created_at
     FROM patient_diseases WHERE patient_profile_id = ?`
  ),
  // For admin detail view — join catalog names
  listDiseasesByProfileJoined: db.prepare(
    `SELECT pd.id, pd.disease_id, d.name AS disease_name, pd.custom_name, pd.created_at
     FROM patient_diseases pd
     LEFT JOIN diseases d ON d.id = pd.disease_id
     WHERE pd.patient_profile_id = ?`
  ),

  // ── Selections: surgeries ──
  deleteSurgeriesByProfile: db.prepare(`DELETE FROM patient_surgeries WHERE patient_profile_id = ?`),
  insertSurgery: db.prepare(
    `INSERT INTO patient_surgeries (id, patient_profile_id, surgery_id, custom_name)
     VALUES (?, ?, ?, ?)`
  ),
  listSurgeriesByProfile: db.prepare(
    `SELECT id, surgery_id, custom_name, created_at
     FROM patient_surgeries WHERE patient_profile_id = ?`
  ),
  listSurgeriesByProfileJoined: db.prepare(
    `SELECT ps.id, ps.surgery_id, s.name AS surgery_name, ps.custom_name, ps.created_at
     FROM patient_surgeries ps
     LEFT JOIN surgeries s ON s.id = ps.surgery_id
     WHERE ps.patient_profile_id = ?`
  ),

  // ── Selections: symptoms ──
  deleteSymptomsByProfile: db.prepare(`DELETE FROM patient_symptoms WHERE patient_profile_id = ?`),
  insertSymptom: db.prepare(
    `INSERT INTO patient_symptoms (id, patient_profile_id, symptom_id, custom_name)
     VALUES (?, ?, ?, ?)`
  ),
  listSymptomsByProfile: db.prepare(
    `SELECT id, symptom_id, custom_name, created_at
     FROM patient_symptoms WHERE patient_profile_id = ?`
  ),
  listSymptomsByProfileJoined: db.prepare(
    `SELECT ps.id, ps.symptom_id, s.name AS symptom_name, s.is_critical, ps.custom_name, ps.created_at
     FROM patient_symptoms ps
     LEFT JOIN symptoms s ON s.id = ps.symptom_id
     WHERE ps.patient_profile_id = ?`
  ),

  // ── Selections: medications (with dose / frequency / schedule / status) ──
  deleteMedicationsByProfile: db.prepare(`DELETE FROM patient_medications WHERE patient_profile_id = ?`),
  insertMedication: db.prepare(
    `INSERT INTO patient_medications
       (id, patient_profile_id, medication_id, custom_name, dose, frequency,
        schedule_times, instructions, status, started_at, stopped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  listMedicationsByProfile: db.prepare(
    `SELECT id, medication_id, custom_name, dose, frequency, schedule_times,
            instructions, status, started_at, stopped_at
     FROM patient_medications WHERE patient_profile_id = ?`
  ),
  listMedicationsByProfileJoined: db.prepare(
    `SELECT pm.id, pm.medication_id, m.brand_name, m.generic_name, pm.custom_name,
            pm.dose, pm.frequency, pm.schedule_times, pm.instructions,
            pm.status, pm.started_at, pm.stopped_at
     FROM patient_medications pm
     LEFT JOIN medications m ON m.id = pm.medication_id
     WHERE pm.patient_profile_id = ?`
  ),

  // ── Versions (JSON snapshots) ──
  insertVersion: db.prepare(
    `INSERT INTO patient_profile_versions (id, patient_id, snapshot)
     VALUES (?, ?, ?)`
  ),
  listVersionsByPatient: db.prepare(
    `SELECT id, patient_id, snapshot, created_at
     FROM patient_profile_versions
     WHERE patient_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countVersionsByPatient: db.prepare(
    `SELECT COUNT(*) as c FROM patient_profile_versions WHERE patient_id = ?`
  ),

  // ── Admin: list patients with basic profile + search ──
  // Reads birth_date / smoking_status / additional_info (the v3 columns).
  // userRepository.listPatients still selects age/medical_history and would
  // throw at runtime against the v3 schema; this query replaces it for the
  // admin list-patients flow.
  listPatientsWithProfile: db.prepare(`
    SELECT u.id, u.name, u.phone_number, u.role, u.status, u.created_at,
           p.id AS profile_id,
           p.birth_date, p.smoking_status, p.additional_info,
           p.updated_at AS profile_updated_at
    FROM users u
    LEFT JOIN patient_profiles p ON p.user_id = u.id
    WHERE u.role = 'patient'
      AND (
        ? IS NULL
        OR u.name LIKE '%' || ? || '%'
        OR u.phone_number LIKE '%' || ? || '%'
        OR u.id = ?
      )
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `),
  countPatientsWithProfile: db.prepare(`
    SELECT COUNT(*) as c
    FROM users u
    WHERE u.role = 'patient'
      AND (
        ? IS NULL
        OR u.name LIKE '%' || ? || '%'
        OR u.phone_number LIKE '%' || ? || '%'
      )
  `),
};

module.exports = {
  // ── Diseases ──
  replaceDiseases(profileId, items, uuid) {
    stmts.deleteDiseasesByProfile.run(profileId);
    for (const it of items) {
      stmts.insertDisease.run(uuid(), profileId, it.disease_id || null, it.custom_name || null);
    }
  },
  listDiseasesByProfile(profileId) { return stmts.listDiseasesByProfile.all(profileId); },
  listDiseasesByProfileJoined(profileId) { return stmts.listDiseasesByProfileJoined.all(profileId); },

  // ── Surgeries ──
  replaceSurgeries(profileId, items, uuid) {
    stmts.deleteSurgeriesByProfile.run(profileId);
    for (const it of items) {
      stmts.insertSurgery.run(uuid(), profileId, it.surgery_id || null, it.custom_name || null);
    }
  },
  listSurgeriesByProfile(profileId) { return stmts.listSurgeriesByProfile.all(profileId); },
  listSurgeriesByProfileJoined(profileId) { return stmts.listSurgeriesByProfileJoined.all(profileId); },

  // ── Symptoms ──
  replaceSymptoms(profileId, items, uuid) {
    stmts.deleteSymptomsByProfile.run(profileId);
    for (const it of items) {
      stmts.insertSymptom.run(uuid(), profileId, it.symptom_id || null, it.custom_name || null);
    }
  },
  listSymptomsByProfile(profileId) { return stmts.listSymptomsByProfile.all(profileId); },
  listSymptomsByProfileJoined(profileId) { return stmts.listSymptomsByProfileJoined.all(profileId); },

  // ── Medications ──
  replaceMedications(profileId, items, uuid) {
    stmts.deleteMedicationsByProfile.run(profileId);
    for (const it of items) {
      stmts.insertMedication.run(
        uuid(),
        profileId,
        it.medication_id || null,
        it.custom_name || null,
        it.dose || null,
        it.frequency || null,
        JSON.stringify(it.schedule_times || []),
        it.instructions || null,
        it.status || 'active',
        it.started_at || null,
        it.stopped_at || null
      );
    }
  },
  listMedicationsByProfile(profileId) { return stmts.listMedicationsByProfile.all(profileId); },
  listMedicationsByProfileJoined(profileId) { return stmts.listMedicationsByProfileJoined.all(profileId); },

  // ── Versions ──
  insertVersion({ id, patientId, snapshot }) {
    stmts.insertVersion.run(id, patientId, snapshot);
  },
  listVersionsByPatient(patientId, limit, offset) {
    return stmts.listVersionsByPatient.all(patientId, limit, offset);
  },
  countVersionsByPatient(patientId) {
    return stmts.countVersionsByPatient.get(patientId).c;
  },

  // ── Admin: patients list with profile (v3 columns) ──
  listPatientsWithProfile({ search, limit, offset }) {
    const term = search && search.trim() ? search.trim() : null;
    return stmts.listPatientsWithProfile.all(term, term, term, term, limit, offset);
  },
  countPatientsWithProfile({ search }) {
    const term = search && search.trim() ? search.trim() : null;
    return stmts.countPatientsWithProfile.get(term, term, term).c;
  },
};
