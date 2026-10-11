/**
 * LogRepository — queries on request_logs & audit_logs (dashboard widgets).
 */

const db = require('../db');

module.exports = {
  // Total request count
  totalRequests() { return db.prepare('SELECT COUNT(*) as c FROM request_logs').get().c; },

  // Requests in the last 24h
  requestsLast24h() {
    return db
      .prepare(`SELECT COUNT(*) as c FROM request_logs WHERE created_at >= datetime('now','-24 hours')`)
      .get().c;
  },

  // HTTP status breakdown (2xx, 4xx, 5xx)
  statusBreakdown() {
    return db
      .prepare(
        `SELECT
            CASE
              WHEN status BETWEEN 200 AND 299 THEN '2xx_success'
              WHEN status BETWEEN 300 AND 399 THEN '3xx_redirect'
              WHEN status BETWEEN 400 AND 499 THEN '4xx_client'
              WHEN status BETWEEN 500 AND 599 THEN '5xx_server'
              ELSE 'other'
            END AS bucket,
            COUNT(*) AS count
         FROM request_logs GROUP BY bucket ORDER BY count DESC`
      )
      .all();
  },

  recentRequests(limit = 50, offset = 0) {
    return db
      .prepare(
        `SELECT id, method, path, status, duration_ms, user_id, ip, created_at
         FROM request_logs ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset);
  },

  // Top endpoints by request volume
  topEndpoints(limit = 10) {
    return db
      .prepare(
        `SELECT path, COUNT(*) AS hits, AVG(duration_ms) AS avg_ms
         FROM request_logs GROUP BY path ORDER BY hits DESC LIMIT ?`
      )
      .all(limit);
  },
};
