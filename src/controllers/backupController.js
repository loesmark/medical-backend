/**
 * BackupController — SECURE database download.
 *
 * Security pipeline (all must pass before the snapshot is taken):
 *   1. authenticate  (JWT required)
 *   2. authorize('admin')  (ROLE_ADMIN only)
 *   3. backupLimiter  (strict per-IP rate limit, e.g. 3 / 15min)
 *   4. body passcode  (secondary secret from admin)
 *   5. bcrypt.compare(passcode, ADMIN_BACKUP_PASSCODE_HASH)
 *   6. audit log success/failure with actor_id + ip
 *
 * Snapshot strategy:
 *   - Use better-sqlite3's native .backup() (SQLite online backup API) to write a
 *     consistent page-level snapshot to a temp file WITHOUT blocking writes.
 *   - Stream that temp file to the client.
 *   - Delete the temp file in a finally block (success or failure).
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const logger = require('../utils/logger');
const config = require('../config');
const audit = require('../middleware/auditLog');
const { createSnapshot } = require('../db/backup');

function clientIp(req) {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

module.exports = {
  // GET → metadata only (does NOT download). Lets the dashboard show backup info.
  info: asyncHandler(async (req, res) => {
    const size = require('../db').getDbFileSizeBytes();
    return ok(res, {
      enabled: Boolean(config.backup.passcodeHash && config.backup.passcodeHash.startsWith('$2')),
      db_path: require('../db').dbPath,
      db_size_bytes: size,
      rate_limit_max: config.backup.rateLimitMax,
      rate_limit_window_ms: config.backup.rateLimitWindowMs,
    }, 'Backup service info.');
  }),

  // POST /api/v1/admin/backup-db  { passcode: "..." }
  // → streams the snapshot file to the browser as application/octet-stream.
  download: asyncHandler(async (req, res) => {
    const actorId = req.user?.id || null;
    const ip = clientIp(req);
    const passcode = req.body?.passcode;

    if (!passcode || typeof passcode !== 'string') {
      audit.log({ actorId, actorIp: ip, action: 'BACKUP_DOWNLOAD_FAILURE', target: 'database', status: 'failure', meta: { reason: 'missing_passcode' } });
      throw ApiError.badRequest('BACKUP_PASSCODE_REQUIRED', 'A backup passcode is required.');
    }

    if (!config.backup.passcodeHash || !config.backup.passcodeHash.startsWith('$2')) {
      audit.log({ actorId, actorIp: ip, action: 'BACKUP_DOWNLOAD_FAILURE', target: 'database', status: 'failure', meta: { reason: 'passcode_not_configured' } });
      throw ApiError.internal('BACKUP_NOT_CONFIGURED', 'Backup passcode is not configured on the server. Run `npm run hash:passcode` and set ADMIN_BACKUP_PASSCODE_HASH.');
    }

    const match = bcrypt.compareSync(passcode, config.backup.passcodeHash);
    if (!match) {
      audit.log({ actorId, actorIp: ip, action: 'BACKUP_DOWNLOAD_FAILURE', target: 'database', status: 'failure', meta: { reason: 'invalid_passcode' } });
      throw ApiError.forbidden('BACKUP_PASSCODE_INVALID', 'Invalid backup passcode.');
    }

    // Passcode OK → create safe snapshot (await — .backup() is async in v9+)
    let snapshot;
    try {
      snapshot = await createSnapshot();
    } catch (err) {
      audit.log({ actorId, actorIp: ip, action: 'BACKUP_DOWNLOAD_FAILURE', target: 'database', status: 'failure', meta: { reason: 'snapshot_failed', error: err.message } });
      logger.error('backupController', `Snapshot creation failed: ${err.message}`);
      throw ApiError.internal('BACKUP_SNAPSHOT_FAILED', 'Failed to create database snapshot.', { error: err.message });
    }

    const filename = `medical-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    logger.info('backupController', `Streaming ${snapshot.path} (${snapshot.size} bytes) to admin ${actorId} @ ${ip}`);
    audit.log({ actorId, actorIp: ip, action: 'BACKUP_DOWNLOAD_SUCCESS', target: 'database', status: 'success', meta: { file: filename, size: snapshot.size } });

    // Stream + cleanup on finish/error/aborted
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(snapshot.size));
    res.setHeader('X-Backup-File', filename);

    const stream = fs.createReadStream(snapshot.path);
    // Idempotent cleanup — bound to every plausible terminal event so the temp
    // file can never leak even if the client disconnects mid-stream.
    const cleanup = () => snapshot.cleanup();
    stream.on('error', (err) => {
      logger.error('backupController', `Stream error: ${err.message}`);
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: { code: 'BACKUP_STREAM_FAILED', message: 'Failed to stream backup.' } });
      } else {
        try { res.end(); } catch { /* noop */ }
      }
    });
    stream.on('end', () => {
      logger.info('backupController', `Stream finished, cleaning up temp snapshot`);
      cleanup();
    });
    stream.on('close', cleanup);
    res.on('finish', cleanup);   // response fully sent to client
    res.on('close', cleanup);    // client disconnected early
    stream.pipe(res);
  }),
};
