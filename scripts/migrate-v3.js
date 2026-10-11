/**
 * scripts/migrate-v3.js
 * Migrates the DB from v2 schema → v3 schema (medical record refactor).
 *
 * What it does (idempotent — safe to run multiple times):
 *   1. Runs applySchema() → creates all NEW tables + adds new columns.
 *   2. For tables that need rebuilding (patient_profiles, health_records, consultations, alert_thresholds):
 *      - Detects if the OLD schema is present (e.g. health_records has `blood_pressure` column).
 *      - If yes: CREATE new table with desired schema → INSERT migrated data → DROP old → RENAME.
 *   3. Migrates data:
 *      - patient_profiles: age → birth_date (= (current_year - age) || '-01-01'), medical_history → additional_info
 *      - health_records: blood_pressure "120/80" → bp_systolic=120, bp_diastolic=80
 *      - consultations: notes → reason (existing rows get category='regular', status stays)
 *      - alert_thresholds: old single-value → new warning/critical (threshold_value → critical_value)
 *
 * Usage:  npm run db:migrate
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/db');
const logger = require('../src/utils/logger');

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function tableExists(table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}

function migrate() {
  logger.info('migrate', 'Starting v3 migration...');

  // ── 1. patient_profiles: age → birth_date, medical_history → additional_info ──
  if (tableExists('patient_profiles') && columnExists('patient_profiles', 'age') && !columnExists('patient_profiles', 'birth_date')) {
    logger.info('migrate', 'Rebuilding patient_profiles (age → birth_date)...');
    db.exec(`ALTER TABLE patient_profiles ADD COLUMN birth_date DATE`);
    db.exec(`ALTER TABLE patient_profiles ADD COLUMN additional_info TEXT`);
    // Migrate: age → birth_date (Jan 1 of birth year), medical_history → additional_info
    const rows = db.prepare('SELECT id, age, medical_history FROM patient_profiles').all();
    const upd = db.prepare('UPDATE patient_profiles SET birth_date = ?, additional_info = ? WHERE id = ?');
    const currentYear = new Date().getFullYear();
    const tx = db.transaction(() => {
      for (const r of rows) {
        const birthDate = (r.age != null) ? `${currentYear - r.age}-01-01` : null;
        upd.run(birthDate, r.medical_history, r.id);
      }
    });
    tx();
    logger.info('migrate', `Migrated ${rows.length} patient_profiles rows.`);
    // Old columns (age, medical_history) remain as dead columns — SQLite can't DROP COLUMN easily pre-3.35.
    // They're harmless. The new code never reads them.
  }

  // ── 2. health_records: blood_pressure "120/80" → bp_systolic + bp_diastolic ──
  if (tableExists('health_records') && columnExists('health_records', 'blood_pressure') && !columnExists('health_records', 'bp_systolic')) {
    logger.info('migrate', 'Rebuilding health_records (blood_pressure → bp_systolic/bp_diastolic)...');
    db.exec(`ALTER TABLE health_records ADD COLUMN bp_systolic INTEGER`);
    db.exec(`ALTER TABLE health_records ADD COLUMN bp_diastolic INTEGER`);
    db.exec(`ALTER TABLE health_records ADD COLUMN symptom_log_id TEXT`);
    const rows = db.prepare('SELECT id, blood_pressure FROM health_records').all();
    const upd = db.prepare('UPDATE health_records SET bp_systolic = ?, bp_diastolic = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const r of rows) {
        let sys = null, dia = null;
        if (r.blood_pressure) {
          const m = String(r.blood_pressure).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
          if (m) { sys = +m[1]; dia = +m[2]; }
        }
        upd.run(sys, dia, r.id);
      }
    });
    tx();
    logger.info('migrate', `Migrated ${rows.length} health_records rows.`);
  }

  // ── 3. consultations: add new columns if missing (rebuild-style via ALTER) ──
  if (tableExists('consultations') && !columnExists('consultations', 'category')) {
    logger.info('migrate', 'Migrating consultations (adding v3 columns)...');
    db.exec(`ALTER TABLE consultations ADD COLUMN type_id TEXT REFERENCES consultation_types(id) ON DELETE SET NULL`);
    db.exec(`ALTER TABLE consultations ADD COLUMN custom_type TEXT`);
    db.exec(`ALTER TABLE consultations ADD COLUMN category TEXT NOT NULL DEFAULT 'regular'`);
    db.exec(`ALTER TABLE consultations ADD COLUMN context TEXT`);
    db.exec(`ALTER TABLE consultations ADD COLUMN doctor_response TEXT`);
    db.exec(`ALTER TABLE consultations ADD COLUMN attachment TEXT DEFAULT '[]'`);
    db.exec(`ALTER TABLE consultations ADD COLUMN responded_at DATETIME`);
    // Migrate: existing notes → reason (column stays as `notes`, we add a `reason` column? No — keep `notes` as reason.)
    // The new schema uses `reason` NOT NULL. Old rows have `notes`. We'll copy notes→reason via a new column.
    db.exec(`ALTER TABLE consultations ADD COLUMN reason TEXT`);
    const tx = db.transaction(() => {
      const rows = db.prepare('SELECT id, notes FROM consultations').all();
      const upd = db.prepare('UPDATE consultations SET reason = COALESCE(notes, "استشارة سابقة") WHERE id = ?');
      for (const r of rows) upd.run(r.id);
    });
    tx();
    logger.info('migrate', 'consultations migrated (old notes preserved as reason).');
  }

  // ── 4. alert_thresholds: rebuild with warning_value + critical_value ──
  if (tableExists('alert_thresholds') && !columnExists('alert_thresholds', 'warning_value')) {
    logger.info('migrate', 'Migrating alert_thresholds (adding warning/critical values)...');
    db.exec(`ALTER TABLE alert_thresholds ADD COLUMN warning_value REAL`);
    db.exec(`ALTER TABLE alert_thresholds ADD COLUMN critical_value REAL`);
    db.exec(`ALTER TABLE alert_thresholds ADD COLUMN operator TEXT NOT NULL DEFAULT '>'`);
    // Old `threshold_value` → critical_value (the existing threshold becomes the critical one)
    const tx = db.transaction(() => {
      const rows = db.prepare('SELECT id, threshold_value FROM alert_thresholds').all();
      const upd = db.prepare('UPDATE alert_thresholds SET critical_value = ? WHERE id = ?');
      for (const r of rows) upd.run(r.threshold_value, r.id);
    });
    tx();
    logger.info('migrate', 'alert_thresholds migrated.');
  }

  // ── 5. Seed default doctor_working_hours if empty (Sun-Thu 9-17, Sat 9-13, Fri off) ──
  const whCount = db.prepare('SELECT COUNT(*) AS c FROM doctor_working_hours').get().c;
  if (whCount === 0) {
    logger.info('migrate', 'Seeding default working hours (Sun-Thu 9-17, Sat 9-13)...');
    const ins = db.prepare('INSERT OR IGNORE INTO doctor_working_hours (day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?)');
    const tx = db.transaction(() => {
      ins.run(0, '09:00', '17:00', 1); // Sun
      ins.run(1, '09:00', '17:00', 1); // Mon
      ins.run(2, '09:00', '17:00', 1); // Tue
      ins.run(3, '09:00', '17:00', 1); // Wed
      ins.run(4, '09:00', '17:00', 1); // Thu
      ins.run(5, '09:00', '13:00', 1); // Sat
      ins.run(6, '00:00', '00:00', 0); // Fri (off)
    });
    tx();
    logger.info('migrate', 'Default working hours seeded.');
  }

  // ── 6. Seed default doctor_availability_status in settings ──
  const statusSetting = db.prepare("SELECT value FROM settings WHERE key = 'doctor_availability_status'").get();
  if (!statusSetting) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('doctor_availability_status', 'active')").run();
    logger.info('migrate', 'Set default doctor_availability_status = active.');
  }

  logger.info('migrate', 'v3 migration complete.');
}

try {
  // Run applySchema first (creates all new tables idempotently)
  db.applySchema();
  migrate();
} catch (err) {
  logger.error('migrate', `Migration failed: ${err.message}`);
  logger.error('migrate', err.stack);
  process.exit(1);
} finally {
  db.closeDatabase();
  process.exit(0);
}
