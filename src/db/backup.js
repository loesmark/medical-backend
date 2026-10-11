/**
 * Secure Database Backup Service
 * ─────────────────────────────────
 * Why this exists:
 *   Streaming the live `.db` file while the server writes risks corruption
 *   (WAL + reader/writer races). Instead we:
 *
 *   1. Call better-sqlite3's native `.backup()` — which uses SQLite's online
 *      backup API to produce a consistent, point-in-time snapshot to a temp file
 *      WITHOUT blocking writes (copy happens at page granularity).
 *      NOTE: in better-sqlite3 v9+, `.backup()` returns a PROMISE and runs async.
 *   2. Stream that temp file to the client.
 *   3. Delete the temp file immediately after the stream closes (success or fail).
 *
 *   The whole flow is wrapped by (in the route layer):
 *     - JWT + ROLE_ADMIN auth
 *     - secondary passcode verification (bcrypt)
 *     - strict rate limiting (e.g. 3 / 15min per IP)
 *     - audit logging (success + failure)
 */

const fs = require('fs');
const path = require('path');
const db = require('./index');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Create a safe snapshot using the SQLite online backup API.
 * ASYNC — returns { path, size, cleanup }. Await it.
 *
 * better-sqlite3 v9+: `db.backup(filePath)` returns a Promise that resolves
 * once the page-by-page copy finishes.
 */
async function createSnapshot() {
  const tempDir = config.backup.tempDir;
  fs.mkdirSync(tempDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(tempDir, `medical-${stamp}.db`);

  logger.info('backup', `Creating snapshot at ${snapshotPath}`);

  // .backup() returns a Promise in v9+ — await it so the file is fully written
  // before we stat/pipe it. (Older versions returned a sync backup object; the
  // await is safe either way: awaiting a non-thenable just returns it.)
  const maybePromise = db.backup(snapshotPath);
  if (maybePromise && typeof maybePromise.then === 'function') {
    await maybePromise;
  }

  // Ensure the file exists and has size > 0
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file was not created at ${snapshotPath}`);
  }
  const size = fs.statSync(snapshotPath).size;
  if (size === 0) {
    throw new Error(`Snapshot file is empty at ${snapshotPath}`);
  }
  logger.info('backup', `Snapshot ready (${size} bytes)`);

  return {
    path: snapshotPath,
    size,
    cleanup: () => {
      try {
        if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
        logger.info('backup', `Temp snapshot removed: ${snapshotPath}`);
      } catch (err) {
        logger.warn('backup', `Failed to remove temp snapshot: ${err.message}`);
      }
    },
  };
}

module.exports = { createSnapshot };
