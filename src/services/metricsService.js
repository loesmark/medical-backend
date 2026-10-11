/**
 * MetricsService — aggregates dashboard widgets:
 *   user_count, patient_count, total_requests, requests_today, db_size, uptime
 */

const os = require('os');
const userRepo = require('../repositories/userRepository');
const logRepo = require('../repositories/logRepository');
const db = require('../db');

const startedAt = Date.now();

module.exports = {
  getSnapshot() {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const userCount = userRepo.countAll();
    const roleBreakdown = userRepo.countByRole();
    const statusBreakdown = userRepo.countByStatus();
    const patientCount =
      roleBreakdown.find((r) => r.role === 'patient')?.c || 0;
    const adminCount = roleBreakdown.find((r) => r.role === 'admin')?.c || 0;

    const totalRequests = logRepo.totalRequests();
    const requestsToday = logRepo.requestsLast24h();

    const dbSize = db.getDbFileSizeBytes();

    const memoryBytes = process.memoryUsage().rss;
    const cpus = os.cpus().length;

    return {
      uptime_seconds: uptimeSeconds,
      server_time: new Date().toISOString(),
      users: {
        total: userCount,
        patients: patientCount,
        admins: adminCount,
        by_status: statusBreakdown.reduce((acc, s) => ({ ...acc, [s.status]: s.c }), {}),
      },
      requests: {
        total: totalRequests,
        last_24h: requestsToday,
      },
      database: {
        path: db.dbPath,
        size_bytes: dbSize,
        size_human: formatBytes(dbSize),
        journal_mode: 'WAL',
      },
      system: {
        rss_bytes: memoryBytes,
        rss_human: formatBytes(memoryBytes),
        cpu_count: cpus,
        node_version: process.version,
        platform: process.platform,
      },
    };
  },
};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
