# Project Structure — MediCare Backend

A concise map of the **core files** the system needs to run, what each does, and how they connect. Everything lives under `medical-backend/`.

```
medical-backend/
├── src/
│   ├── server.js              ← entry point: boots HTTP server + signal handling
│   ├── app.js                 ← Express app factory: middleware pipeline + route mounting
│   ├── config/index.js        ← dotenv loader + boot-time validation
│   ├── db/
│   │   ├── index.js           ← better-sqlite3 connection (pragmas + schema)
│   │   └── backup.js          ← WAL-safe snapshot service (SQLite online backup API)
│   ├── middleware/
│   │   ├── auth.js            ← JWT verify + RBAC (authorize)
│   │   ├── errorHandler.js    ← central error → standard JSON envelope
│   │   ├── rateLimit.js        ← auth / api / backup limiters
│   │   ├── auditLog.js        ← writes audit_logs rows
│   │   └── requestLogger.js   ← writes request_logs rows (dashboard metrics)
│   ├── repositories/          ← SQL lives here ONLY (swap → Turso/PG)
│   ├── services/              ← business logic (no SQL, no HTTP)
│   ├── controllers/           ← thin HTTP layer over services
│   ├── validators/            ← express-validator chains
│   └── routes/                ← mounts controllers under /api/v1/*
├── public/admin/              ← static admin dashboard (HTML + Tailwind + JS)
├── scripts/                   ← CLI: create-admin, hash-passcode, migrate
├── data/                      ← persistent SQLite (medical.db, backups/)
├── .env.example               ← all required env vars (copy → .env)
├── package.json
└── Dockerfile + fly.toml      ← deployment
```

## Core Files — What Each Does

### `src/server.js` — **Entry point**
Boots the app: `createApp()` from `app.js`, then `app.listen(PORT, HOST)`. Wires graceful shutdown on `SIGINT`/`SIGTERM` (flushes WAL → closes DB → exits). Catches `uncaughtException`/`unhandledRejection` so the process never silently hangs.
**Connects to:** `app.js` (the app), `config/` (port/host), `db/` (close on shutdown).

### `src/app.js` — **App factory (the pipeline)**
Builds the Express app in order: `helmet` (security headers) → `compression` (gzip) → `cors` → `express.json` → `requestLogger` → static `/admin` → `/api/v1/*` routes → `/api/v1/setup` → `notFound` → `errorHandler`. Separating this from `server.js` lets the app be imported in tests without binding a port.
**Connects to:** every middleware, every route file, `config/`.

### `src/config/index.js` — **Configuration**
Loads `.env`, validates it (fails fast in prod if `JWT_SECRET` or `ADMIN_BACKUP_PASSCODE_HASH` are missing/weak), ensures `data/` + `data/backups/` exist. **The only file that reads `process.env`** — everything else imports `config`.
**Connects to:** every module that needs settings (db path, JWT secret, CORS origins, rate limits).

### `src/db/index.js` — **Database connection**
Opens `better-sqlite3`, applies pragmas (`WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout`), runs the schema (`CREATE TABLE IF NOT EXISTS` for users, patient_profiles, health_records, consultations, alert_thresholds, settings, request_logs, audit_logs + indexes + triggers). Exposes a `tx()` transaction wrapper and `getDbFileSizeBytes()`.
**Connects to:** `config/` (db path), `repositories/*` (use the prepared statements), `services/metricsService`, `backup.js`.

### `src/db/backup.js` — **Secure snapshot service**
`createSnapshot()` calls `db.backup(tempFile)` (SQLite online backup API — page-level consistent copy without blocking writes). Returns `{ path, size, cleanup }`. Used only by `backupController`.
**Connects to:** `db/index.js`, `controllers/backupController.js`.

### `src/middleware/auth.js` — **JWT + RBAC**
`authenticate` extracts the Bearer token, verifies it with `JWT_SECRET`, attaches `req.user = { id, role, name }`. `authorize(...roles)` returns 403 if the role isn't allowed. Distinguishes `TokenExpiredError` from invalid tokens.
**Connects to:** `config/` (JWT secret), mounted on patient + admin routes.

### `src/middleware/errorHandler.js` — **Central error → envelope**
Converts every thrown `ApiError`, express-validator failure, SQLite constraint, multer error, or unknown runtime error into the standard `{ success:false, error:{code,message} }`. Never leaks stack traces in production.
**Connects to:** `utils/ApiError.js`, `config/` (isProd toggle). Mounted LAST in `app.js`.

### `src/middleware/requestLogger.js` + `auditLog.js` — **Observability**
`requestLogger` times every request and writes a `request_logs` row (powers dashboard "total requests" + "status breakdown"). `auditLog.log()` writes `audit_logs` rows for security-sensitive actions (backup attempts, role changes, deletes).
**Connects to:** `db/index.js`, called by `app.js` (requestLogger) and `controllers/*` (audit).

### `src/repositories/*` — **Data access layer (the only SQL)**
`userRepository.js`, `patientRepository.js`, `settingsRepository.js`, `logRepository.js`. Each holds prepared statements (`SELECT/INSERT/UPDATE`). Services call these; controllers never touch SQL.
**Why isolated:** swapping to Turso/PostgreSQL later means editing ONLY these files.

### `src/services/*` — **Business logic**
`authService` (login/register/JWT signing), `patientService` (records, consultations, Telegram upload orchestration), `adminService` (user management, settings, logs queries), `metricsService` (dashboard snapshot), `telegramService` (file upload to Telegram). No HTTP, no SQL — pure logic.
**Connects to:** `repositories/*`, `config/`.

### `src/controllers/*` — **Thin HTTP layer**
`authController`, `patientController`, `adminController`, `healthController`, `backupController`. Each method: validate input → call a service method → return the standard envelope via `utils/response.js`. No business logic.
**Connects to:** `services/*`, `utils/response.js`, `utils/asyncHandler.js`.

### `src/routes/*` — **Route mounting**
`index.js` mounts `health`, `auth`, `patient`, `admin` under `/api/v1`. Each route file wires its controller methods + middleware (`authenticate`, `authorize`, validators, rate limiters).
**Connects to:** `controllers/*`, `middleware/*`, `validators/*`.

### `public/admin/` — **Admin dashboard (static)**
`index.html` + `dashboard.css` + `dashboard.js`. Served by `app.js` at `/admin/`. Vanilla JS + Tailwind CDN + Chart.js. Calls the same `/api/v1/admin/*` endpoints with the JWT stored in `localStorage`.
**Connects to:** the API via `fetch('/api/v1/...')`.

### `.env.example` — **Required environment variables**
Copy to `.env` and fill in: `PORT`, `JWT_SECRET`, `ADMIN_*`, `ADMIN_BACKUP_PASSCODE_HASH`, `DB_PATH`, `CORS_ORIGINS`, `TELEGRAM_*`. See `README.md` for the full setup.

### `scripts/*` — **CLI utilities**
`create-admin.js` (idempotent admin creator), `hash-passcode.js` (bcrypt-hashes the backup passcode), `migrate.js` (re-applies schema).

---

## Request Flow (one example)

`POST /api/v1/admin/backup-db` with a valid admin JWT + passcode:

1. **`app.js`** receives → `requestLogger` starts timing.
2. **`routes/admin.js`** matches → `authenticate` (JWT verified) → `authorize('admin')` → `backupLimiter` (3/15min) → `validators/adminValidator.backup` (passcode required).
3. **`backupController.download`** → `bcrypt.compare(passcode, ADMIN_BACKUP_PASSCODE_HASH)` → `auditLog.log(BACKUP_DOWNLOAD_*)`.
4. If passcode OK → **`db/backup.js`** `createSnapshot()` (online backup API) → `fs.createReadStream(snapshot).pipe(res)`.
5. On stream finish → `snapshot.cleanup()` deletes the temp file.
6. **`errorHandler`** catches any thrown `ApiError` and returns the standard envelope.
7. **`requestLogger`** writes the `request_logs` row on response finish.

## Where to Make Common Changes

| Want to… | Edit |
|---------|------|
| Add a new endpoint | `controllers/`, `services/`, `routes/` |
| Change a SQL query | `repositories/` |
| Add a new env var | `config/index.js` + `.env.example` |
| Add a DB table | `src/db/index.js` `applySchema()` |
| Change auth rules | `middleware/auth.js` |
| Migrate to Turso/PostgreSQL | `src/db/index.js` + `repositories/*` only |
