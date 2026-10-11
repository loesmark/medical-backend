/**
 * Server entry — boots the app and wires graceful shutdown.
 *
 *   SIGINT / SIGTERM → stop accepting new connections, flush WAL, close DB, exit.
 *   uncaughtException / unhandledRejection → log, exit non-zero (process manager restarts).
 */

const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./db');

const app = createApp();
const server = app.listen(config.server.port, config.server.host, () => {
  logger.info('server', `MediCare backend v2.0.0 running on http://${config.server.host}:${config.server.port} [${config.env}]`);
  logger.info('server', `DB: ${config.db.path}`);
});

// ── Graceful shutdown ──
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server', `${signal} received — shutting down gracefully`);

  server.close((err) => {
    if (err) logger.error('server', `Error closing HTTP server: ${err.message}`);
    db.closeDatabase();
    logger.info('server', 'Shutdown complete.');
    process.exit(err ? 1 : 0);
  });

  // Force-exit after 10s if something hangs
  setTimeout(() => {
    logger.error('server', 'Forcing exit after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('server', `uncaughtException: ${err.message}`, { stack: err.stack });
  // Continue serving — our error handler caught most route errors already.
  // If something truly fatal happened, exit so the process manager can restart.
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('server', `unhandledRejection: ${reason}`);
});
