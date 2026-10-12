/**
 * App factory — builds the Express app.
 *
 * Separated from server.js so the app can be imported for tests/supergiants
 * without binding to a port.
 *
 * Pipeline (top → bottom):
 *   helmet  → security headers
 *   compression  → gzip responses (great for mobile JSON payloads)
 *   cors  → strict origin check (Flutter has no origin, dashboard does)
 *   json + raw(multipart)  → body parsers
 *   requestLogger  → writes request_logs row on finish
 *   /health aliases  → public health probe
 *   static  → serves /admin dashboard
 *   /api/v1/*  → business routes
 *   /api/v1/setup  → idempotent initial admin creation (POST, not GET)
 *   notFound → 404 for unknown routes
 *   errorHandler → central error envelope
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const { requestLogger } = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const ApiError = require('./utils/ApiError');
const asyncHandler = require('./utils/asyncHandler');
const { ok } = require('./utils/response');

function createApp() {
  const app = express();

  // ── Security & perf middleware ──
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off so Tailwind CDN works on the dashboard
  app.use(compression());

  // CORS — allow configured origins, no credentials (stateless JWT).
  // In development, allow ALL origins so local previews / different ports work.
  // In production, restrict strictly to CORS_ORIGINS (the admin dashboard + Flutter has no Origin).
  const corsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true); // Flutter requests have no Origin header
      if (config.isDev) return cb(null, true); // dev: allow everything
      if (config.cors.origins.length === 0) return cb(null, true);
      if (config.cors.origins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Transform-Port'],
    maxAge: 86400,
  };
  app.use(cors(corsOptions));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Trust the Caddy gateway (1 hop) so req.ip and rate-limit keying use the
  // real client IP from X-Forwarded-For instead of the proxy's IP.
  // Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
  app.set('trust proxy', true);

  if (config.isDev) {
    app.use(morgan('dev'));
  }

  // UTF-8 JSON content type for all API responses
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });

  // Request logging to DB (dashboard metrics)
  app.use(requestLogger);

  // ── Health aliases (public) ──
  app.use('/health', require('./routes/health'));
  app.use('/api/health', require('./routes/health'));

  // ── Static admin dashboard ──
  app.use('/admin', express.static(path.join(config.rootDir, 'public', 'admin'), {
    extensions: ['html'],
    index: 'index.html',
  }));

  // ── API v1 ──
  app.use('/api/v1', require('./routes'));

  // ── Idempotent setup endpoint (POST, more secure than original GET) ──
  // Creates the initial admin ONLY if no admin exists. Otherwise 409.
  app.post(
    '/api/v1/setup',
    asyncHandler(async (req, res) => {
      const { v4: uuidv4 } = require('uuid');
      const bcrypt = require('bcryptjs');
      const db = require('./db');
      const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
      if (count > 0) {
        throw ApiError.conflict('SETUP_DONE', 'System is already set up. Log in via /api/v1/auth/doctor-login.');
      }
      const id = uuidv4();
      const hash = bcrypt.hashSync(config.initialAdmin.password, config.bcrypt.saltRounds);
      db.prepare(
        `INSERT INTO users (id, name, phone_number, password_hash, role, status)
         VALUES (?, ?, ?, ?, 'admin', 'active')`
      ).run(id, config.initialAdmin.name, config.initialAdmin.phone, hash);
      logger.info('setup', `Initial admin created: ${config.initialAdmin.phone}`);
      return ok(
        res,
        {
          id,
          name: config.initialAdmin.name,
          phone_number: config.initialAdmin.phone,
          role: 'admin',
        },
        'Initial admin created. Please change the password immediately.'
      );
    })
  );

  // ── 404 + error handler (LAST) ──
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
