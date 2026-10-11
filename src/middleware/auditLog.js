/**
 * Audit logger — records security-sensitive actions.
 *
 * Insert a row for: backup downloads (success/failure), role changes, user
 * suspension/deletion, settings updates, etc.
 *
 * Stays non-fatal: if the audit insert itself throws, we log to console but never
 * break the user's request flow.
 */

const db = require('../db');

function log({ actorId = null, actorIp = null, action, target = null, status, meta = null }) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (actor_id, actor_ip, action, target, status, meta)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(actorId, actorIp, action, target, status, meta ? JSON.stringify(meta) : null);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('auditLog write failed:', err.message);
  }
}

function listRecent({ limit = 50, offset = 0, action = null } = {}) {
  if (action) {
    return db
      .prepare(`SELECT * FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(action, limit, offset);
  }
  return db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
}

function count({ action = null } = {}) {
  if (action) return db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = ?`).get(action).c;
  return db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get().c;
}

module.exports = { log, listRecent, count };
