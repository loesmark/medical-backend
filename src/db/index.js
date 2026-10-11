/**
 * Database service — the SINGLE access point to better-sqlite3.
 *
 * Performance pragmas: WAL + synchronous=NORMAL + foreign_keys=ON + busy_timeout.
 * The schema below is the FULL v3 schema (medical-record refactor).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

const dbPath = config.db.path;
logger.info('db', `Opening SQLite at ${dbPath}`);

const db = new Database(dbPath, { verbose: config.db.verbose ? console.log : undefined });

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');

// ── Schema (v3 — full medical record refactor) ──
function applySchema() {
  db.exec(`
    -- ═══ USERS (unchanged) ═══
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      phone_number    TEXT UNIQUE,
      password_hash   TEXT,
      role            TEXT NOT NULL DEFAULT 'patient'
                        CHECK(role IN ('admin','patient')),
      patient_token   TEXT UNIQUE,
      status          TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','suspended')),
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status  ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_phone   ON users(phone_number);
    CREATE INDEX IF NOT EXISTS idx_users_token   ON users(patient_token);

    -- ═══ PATIENT PROFILES (modified: age→birth_date, medical_history→additional_info, dropped current_medications) ═══
    CREATE TABLE IF NOT EXISTS patient_profiles (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL UNIQUE,
      birth_date      DATE,                          -- ISO date, required on first profile completion
      smoking_status  TEXT,                          -- never|former|current
      additional_info TEXT,                          -- free-text "معلومات إضافية"
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ═══ PATIENT PROFILE VERSIONS (new — JSON snapshots for history) ═══
    CREATE TABLE IF NOT EXISTS patient_profile_versions (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                 -- user_id (the patient)
      snapshot        TEXT NOT NULL,                 -- JSON of the full profile at save time
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_profile_versions_patient ON patient_profile_versions(patient_id, created_at DESC);

    -- ═══ DISEASES CATALOG (new — doctor-curated) ═══
    CREATE TABLE IF NOT EXISTS diseases (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      category        TEXT,
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ═══ PATIENT DISEASES (new — junction with optional custom_name) ═══
    CREATE TABLE IF NOT EXISTS patient_diseases (
      id                  TEXT PRIMARY KEY,
      patient_profile_id TEXT NOT NULL,
      disease_id          TEXT,                          -- nullable if custom_name used
      custom_name         TEXT,                          -- nullable if disease_id used
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_profile_id) REFERENCES patient_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (disease_id) REFERENCES diseases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_patient_diseases_profile ON patient_diseases(patient_profile_id);

    -- ═══ SURGERIES CATALOG (new) ═══
    CREATE TABLE IF NOT EXISTS surgeries (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      category        TEXT,
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS patient_surgeries (
      id                  TEXT PRIMARY KEY,
      patient_profile_id TEXT NOT NULL,
      surgery_id          TEXT,
      custom_name         TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_profile_id) REFERENCES patient_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (surgery_id) REFERENCES surgeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_patient_surgeries_profile ON patient_surgeries(patient_profile_id);

    -- ═══ SYMPTOMS CATALOG (new — with is_critical flag) ═══
    CREATE TABLE IF NOT EXISTS symptoms (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      category        TEXT,
      is_critical     INTEGER NOT NULL DEFAULT 0,     -- 1 = doctor flagged as critical (auto-alert)
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ═══ PATIENT SYMPTOMS (new — selected symptoms in the profile) ═══
    CREATE TABLE IF NOT EXISTS patient_symptoms (
      id                  TEXT PRIMARY KEY,
      patient_profile_id TEXT,
      symptom_id          TEXT,
      custom_name         TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_profile_id) REFERENCES patient_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (symptom_id) REFERENCES symptoms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_patient_symptoms_profile ON patient_symptoms(patient_profile_id);

    -- ═══ HEALTH RECORDS (modified: blood_pressure→bp_systolic+bp_diastolic, +symptom_log_id) ═══
    -- NOTE: symptom_log_id is a logical back-reference to symptom_logs.id.
    -- The FK from symptom_logs→health_records is defined separately (one-directional)
    -- to avoid a circular CREATE-TIME dependency with foreign_keys=ON.
    CREATE TABLE IF NOT EXISTS health_records (
      id                  TEXT PRIMARY KEY,
      patient_id          TEXT NOT NULL,              -- patient_profile.id
      bp_systolic         INTEGER,
      bp_diastolic        INTEGER,
      heart_rate          INTEGER,
      current_medications TEXT,                       -- snapshot text (optional)
      notes               TEXT,
      attachments         TEXT DEFAULT '[]',          -- JSON array of telegram file refs
      symptom_log_id      TEXT,                       -- nullable: links to a symptom_log if symptoms were entered
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patient_profiles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_records_patient ON health_records(patient_id);
    CREATE INDEX IF NOT EXISTS idx_records_created ON health_records(created_at DESC);

    -- ═══ SYMPTOM LOGS (new — standalone symptom entries without a measurement) ═══
    CREATE TABLE IF NOT EXISTS symptom_logs (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                  -- user_id
      symptoms        TEXT DEFAULT '[]',              -- JSON array of {symptom_id, custom_name}
      custom_text     TEXT,                           -- free-text description
      health_record_id TEXT,                          -- nullable: links to a health_record if entered with a reading
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (health_record_id) REFERENCES health_records(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symptom_logs_patient ON symptom_logs(patient_id, created_at DESC);

    -- ═══ PATIENT DOCUMENTS (new — ECG/Echo/lab reports, append-only) ═══
    CREATE TABLE IF NOT EXISTS patient_documents (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                  -- user_id
      type            TEXT NOT NULL DEFAULT 'other', -- ecg|echo|lab|other
      title           TEXT,
      taken_at       DATETIME,                       -- when the document was created (patient-entered)
      notes           TEXT,
      attachments     TEXT DEFAULT '[]',              -- JSON array of telegram file refs
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_documents_patient ON patient_documents(patient_id, created_at DESC);

    -- ═══ MEDICATIONS CATALOG (new — brand + generic) ═══
    CREATE TABLE IF NOT EXISTS medications (
      id              TEXT PRIMARY KEY,
      brand_name      TEXT NOT NULL,
      generic_name    TEXT,
      form            TEXT,                           -- tablet|capsule|syrup|injection
      category        TEXT,                           -- cardiac|diabetes|...
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ═══ PATIENT MEDICATIONS (new — current meds with schedule) ═══
    CREATE TABLE IF NOT EXISTS patient_medications (
      id                  TEXT PRIMARY KEY,
      patient_profile_id TEXT NOT NULL,
      medication_id       TEXT,
      custom_name         TEXT,                       -- if not from catalog
      dose                TEXT,                       -- "75mg"
      frequency           TEXT,                       -- "مرة يومياً"
      schedule_times      TEXT DEFAULT '[]',          -- JSON: ["08:30","21:00"]
      instructions        TEXT,
      status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
      started_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      stopped_at          DATETIME,
      FOREIGN KEY (patient_profile_id) REFERENCES patient_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patient_meds_profile ON patient_medications(patient_profile_id);

    -- ═══ CONSULTATION TYPES CATALOG (new — immediate|regular) ═══
    CREATE TABLE IF NOT EXISTS consultation_types (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL CHECK(category IN ('immediate','regular')),
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ═══ CONSULTATIONS (rebuilt — type + reason + category + context + doctor_response) ═══
    CREATE TABLE IF NOT EXISTS consultations (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                  -- user_id
      type_id         TEXT,                           -- nullable if custom
      custom_type     TEXT,                           -- nullable if type_id used
      reason          TEXT NOT NULL,
      category        TEXT NOT NULL CHECK(category IN ('immediate','regular')),
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','responded','closed')),
      context         TEXT,                           -- JSON: {latest_reading, reading_freshness, symptoms_only, latest_symptoms}
      doctor_response TEXT,                           -- JSON: {response_text, recommended_action, follow_up_date, attachment}
      whatsapp_link   TEXT,                           -- set for immediate consultations
      attachment      TEXT DEFAULT '[]',              -- JSON: telegram file refs the patient attached
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at    DATETIME,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (type_id) REFERENCES consultation_types(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consultations_status   ON consultations(status);
    CREATE INDEX IF NOT EXISTS idx_consultations_category ON consultations(category);

    -- ═══ DOCTOR WORKING HOURS (new — weekly recurring) ═══
    CREATE TABLE IF NOT EXISTS doctor_working_hours (
      id              INTEGER PRIMARY KEY,
      day_of_week     INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),  -- 0=Sun..6=Sat
      start_time      TEXT NOT NULL,                  -- "09:00"
      end_time        TEXT NOT NULL,                   -- "17:00"
      is_active       INTEGER NOT NULL DEFAULT 1,
      UNIQUE(day_of_week)
    );

    -- ═══ APPOINTMENTS (new) ═══
    CREATE TABLE IF NOT EXISTS appointments (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                  -- user_id
      scheduled_date  DATE NOT NULL,
      scheduled_time  TEXT NOT NULL,                  -- "14:30"
      status          TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','cancelled','completed')),
      whatsapp_link   TEXT,
      notes           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at    DATETIME,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_status   ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(scheduled_date, scheduled_time);

    -- ═══ TREATMENT PLANS (new — JSON for each sub-section) ═══
    CREATE TABLE IF NOT EXISTS treatment_plans (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,                  -- user_id
      created_by_admin_id TEXT NOT NULL,
      recommended_medications TEXT DEFAULT '[]',      -- JSON: [{medication_id, dose, reason}]
      instructions    TEXT,
      follow_up_dates TEXT DEFAULT '[]',             -- JSON: ["2025-02-01", ...]
      clinical_notes  TEXT,
      is_current      INTEGER NOT NULL DEFAULT 1,    -- 1 = latest version
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans(patient_id, created_at DESC);

    -- ═══ TREATMENT PLAN VERSIONS (new — snapshots for history) ═══
    CREATE TABLE IF NOT EXISTS treatment_plan_versions (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT NOT NULL,
      snapshot        TEXT NOT NULL,                  -- JSON of the full plan
      created_by_admin_id TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plan_versions_patient ON treatment_plan_versions(patient_id, created_at DESC);

    -- ═══ ALERT THRESHOLDS (rebuilt — warning + critical per parameter) ═══
    CREATE TABLE IF NOT EXISTS alert_thresholds (
      id              TEXT PRIMARY KEY,
      admin_id        TEXT NOT NULL,
      parameter_name  TEXT NOT NULL,                  -- bp_systolic|bp_diastolic|heart_rate
      warning_value   REAL,                           -- approaching threshold
      critical_value  REAL,                           -- exceed threshold
      operator        TEXT NOT NULL DEFAULT '>',      -- >|<|>=|<=
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_thresholds_param ON alert_thresholds(parameter_name, is_active);

    -- ═══ ALERTS (new — generated when thresholds are crossed) ═══
    CREATE TABLE IF NOT EXISTS alerts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT NOT NULL,
      health_record_id TEXT,                          -- nullable (symptom-only alerts have no record)
      symptom_log_id  TEXT,                           -- nullable
      parameter_name  TEXT,                           -- bp_systolic|...| or symptom name
      value           TEXT,                           -- the value that triggered (e.g. "145" or symptom name)
      threshold_value REAL,
      severity        TEXT NOT NULL CHECK(severity IN ('warning','critical')),
      status          TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','resolved')),
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at        DATETIME,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (health_record_id) REFERENCES health_records(id) ON DELETE SET NULL,
      FOREIGN KEY (symptom_log_id) REFERENCES symptom_logs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, created_at DESC);

    -- ═══ SETTINGS (key/value — includes doctor_availability_status) ═══
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- ═══ REQUEST LOGS (unchanged) ═══
    CREATE TABLE IF NOT EXISTS request_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      method      TEXT NOT NULL,
      path        TEXT NOT NULL,
      status      INTEGER NOT NULL,
      duration_ms INTEGER,
      user_id     TEXT,
      ip          TEXT,
      user_agent  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_logs_status   ON request_logs(status);
    CREATE INDEX IF NOT EXISTS idx_request_logs_path     ON request_logs(path);

    -- ═══ AUDIT LOGS (unchanged) ═══
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id    TEXT,
      actor_ip    TEXT,
      action      TEXT NOT NULL,
      target      TEXT,
      status      TEXT NOT NULL,
      meta        TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

    -- ═══ updated_at triggers ═══
    CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
      AFTER UPDATE ON users FOR EACH ROW
      BEGIN UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;

    CREATE TRIGGER IF NOT EXISTS trg_profiles_updated_at
      AFTER UPDATE ON patient_profiles FOR EACH ROW
      BEGIN UPDATE patient_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
  `);
}

applySchema();

// ── Transaction wrapper ──
function tx(fn) {
  try {
    return db.transaction(fn)();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const unique = { ...err };
      unique.constraint = 'UNIQUE';
      throw unique;
    }
    throw err;
  }
}

function getDbFileSizeBytes() {
  try { return fs.statSync(dbPath).size; } catch { return 0; }
}

function checkpoint() {
  db.pragma('wal_checkpoint(TRUNCATE)');
}

const _nativeClose = db.close.bind(db);
function closeDatabase() {
  try {
    _nativeClose();
    logger.info('db', 'Database connection closed.');
  } catch (err) {
    logger.error('db', `Error closing database: ${err.message}`);
  }
}

module.exports = db;
module.exports.db = db;
module.exports.tx = tx;
module.exports.applySchema = applySchema;
module.exports.getDbFileSizeBytes = getDbFileSizeBytes;
module.exports.checkpoint = checkpoint;
module.exports.closeDatabase = closeDatabase;
module.exports.dbPath = dbPath;
