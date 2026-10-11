/**
 * Centralized configuration loader.
 *
 * All environment variables are read here and validated at boot.
 * Nothing else in the codebase should call process.env directly — import `config` instead.
 * This single point of truth makes migrating to Turso/PostgreSQL or cloud config trivial.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env (fails silently if missing — we validate below)
dotenv.config();

const rootDir = path.resolve(__dirname, '..', '..');

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(value, def = false) {
  if (value === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseInt(value, def) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : def;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  server: {
    port: parseInt(process.env.PORT, 4000),
    host: process.env.HOST || '0.0.0.0',
  },

  rootDir,

  db: {
    path: process.env.DB_PATH
      ? path.resolve(rootDir, process.env.DB_PATH)
      : path.join(rootDir, 'data', 'medical.db'),
    verbose: parseBool(process.env.DB_VERBOSE, false),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    patientExpiresIn: process.env.JWT_PATIENT_EXPIRES_IN || '30d',
  },

  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10),
  },

  cors: {
    origins: parseCsv(process.env.CORS_ORIGINS),
  },

  backup: {
    // Bcrypt hash of the secondary passcode — verified before any DB download
    passcodeHash: process.env.ADMIN_BACKUP_PASSCODE_HASH || '',
    rateLimitMax: parseInt(process.env.BACKUP_RATE_LIMIT_MAX, 3),
    rateLimitWindowMs: parseInt(process.env.BACKUP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    // Temp snapshot directory (cleaned after each download)
    tempDir: path.join(rootDir, 'data', 'backups'),
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    doctorWhatsapp: process.env.DOCTOR_WHATSAPP_NUMBER || '',
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Initial admin (used by scripts/create-admin.js and the /setup endpoint)
  initialAdmin: {
    name: process.env.ADMIN_NAME || 'Dr. Admin',
    phone: process.env.ADMIN_PHONE || '01000000000',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe!2025',
  },
};

// Boot-time validation — fail fast on misconfiguration
function validateConfig(cfg) {
  const errors = [];

  if (cfg.isProd) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('replace-with') || process.env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
      errors.push('JWT_SECRET must be set to a strong random value in production.');
    }
    if (!cfg.backup.passcodeHash || cfg.backup.passcodeHash.startsWith('$2a$10$replaceWithRealBcryptHash')) {
      errors.push('ADMIN_BACKUP_PASSCODE_HASH must be a real bcrypt hash in production. Run: npm run hash:passcode');
    }
    if (!cfg.backup.passcodeHash.startsWith('$2')) {
      errors.push('ADMIN_BACKUP_PASSCODE_HASH does not look like a bcrypt hash.');
    }
  }

  if (errors.length) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}\nFix your .env file and restart.`);
  }
}

validateConfig(config);

// Ensure data directories exist
const fs = require('fs');
const dbDir = path.dirname(config.db.path);
const backupDir = config.backup.tempDir;
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

module.exports = config;
