# MediCare Backend v2.0

Production-ready Node.js backend for the **MediCare Flutter app**. Express + `better-sqlite3` + JWT RBAC + admin dashboard + secure database backup.

> Refactored from a flat 5-file prototype into a clean modular architecture (Routes → Controllers → Services → Repositories → DB), with centralized error handling, request logging, audit logging, rate limiting, security headers, and a complete admin dashboard.

---

## Table of Contents
1. [Architecture](#architecture)
2. [Quick Start (Local)](#quick-start-local)
3. [The Secure DB Backup Pipeline](#the-secure-db-backup-pipeline)
4. [API Reference](#api-reference)
5. [Admin Dashboard](#admin-dashboard)
6. [Flutter Integration](#flutter-integration)
7. [Deployment (Free Tiers)](#deployment-free-tiers)
8. [Migration to Turso/PostgreSQL](#migration-to-tursopostgresql)

---

## Architecture

```
medical-backend/
├── .env.example              # All required env vars (copy → .env)
├── Dockerfile                # Production image (Fly.io / Render / Railway)
├── fly.toml                  # Fly.io config with persistent volume
├── package.json
├── data/                     # Persistent SQLite storage (gitignored)
│   ├── medical.db
│   └── backups/              # Temp snapshot files (auto-cleaned)
├── public/admin/             # Admin dashboard (static HTML + Tailwind CDN + vanilla JS)
│   ├── index.html
│   ├── dashboard.css
│   └── dashboard.js
├── scripts/
│   ├── create-admin.js       # Idempotent admin creator
│   ├── hash-passcode.js      # Bcrypt-hashes the backup passcode
│   └── migrate.js            # Re-applies schema (idempotent)
└── src/
    ├── server.js              # Entry — boots app + graceful shutdown
    ├── app.js                 # Express app factory (helmet, compression, cors, routes)
    ├── config/index.js        # dotenv + boot-time validation
    ├── db/
    │   ├── index.js           # Single DB access point (pragmas, schema, tx wrapper)
    │   └── backup.js          # Safe snapshot service (SQLite online backup API)
    ├── middleware/
    │   ├── auth.js            # authenticate + authorize (RBAC)
    │   ├── errorHandler.js    # Centralized → standard error envelope
    │   ├── rateLimit.js        # auth / api / backup limiters
    │   ├── auditLog.js        # Audit-log writer
    │   └── requestLogger.js   # Per-request → request_logs table
    ├── utils/
    │   ├── response.js        # ok / created / paginate helpers
    │   ├── ApiError.js        # Throwable error → standard envelope
    │   ├── asyncHandler.js   # Catches promise rejections
    │   └── logger.js          # Leveled logger
    ├── repositories/          # Data access (swap for Turso/PG here)
    │   ├── userRepository.js
    │   ├── patientRepository.js
    │   ├── settingsRepository.js
    │   └── logRepository.js
    ├── services/              # Business logic (no SQL)
    │   ├── authService.js
    │   ├── patientService.js
    │   ├── adminService.js
    │   ├── metricsService.js
    │   └── telegramService.js
    ├── controllers/          # Thin HTTP layer
    │   ├── authController.js
    │   ├── patientController.js
    │   ├── adminController.js
    │   ├── healthController.js
    │   └── backupController.js
    ├── validators/           # express-validator chains
    │   ├── authValidator.js
    │   ├── patientValidator.js
    │   └── adminValidator.js
    └── routes/               # Route mounting
        ├── index.js
        ├── health.js
        ├── auth.js
        ├── patient.js
        └── admin.js
```

**Layered data flow:** `HTTP → route → middleware (auth/ratelimit/validator) → controller → service → repository → db`

Every response uses one envelope:
```json
{ "success": true,  "data": ..., "message": "...", "pagination": {...} }
{ "success": false, "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "..." } }
```

---

## Quick Start (Local)

```bash
# 1. Install deps
cd medical-backend
npm install        # or: bun install

# 2. Configure env
cp .env.example .env
# Edit .env:
#   - Set JWT_SECRET to a long random hex:
#       node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   - Set ADMIN_NAME / ADMIN_PHONE / ADMIN_PASSWORD

# 3. Generate the backup passcode hash (REQUIRED before backups work in prod)
npm run hash:passcode
#   → prompts for a passcode (min 8 chars)
#   → prints: ADMIN_BACKUP_PASSCODE_HASH=$2a$10$...
#   → paste that line into .env

# 4. Create the initial admin user
npm run setup:admin
#   → "✅ Admin created: id=... phone=01000000000"

# 5. Run the schema migrations (idempotent)
npm run db:migrate

# 6. Start the server (dev with auto-reload)
npm run dev
#   → "MediCare backend v2.0.0 running on http://0.0.0.0:4000"

# 7. Open the admin dashboard
#    http://localhost:4000/admin/
#    Log in with the admin phone + password from .env
```

Verify:
```bash
curl http://localhost:4000/health
# {"success":true,"data":{"status":"ok","db":"ok","version":"2.0.0",...}}
```

---

## The Secure DB Backup Pipeline

`POST /api/v1/admin/backup-db` is the most security-sensitive endpoint. The pipeline (all must pass before any DB bytes touch the network):

| Step | Layer | What it does |
|------|-------|--------------|
| 1 | `authenticate` | Verifies the Bearer JWT (admin must be logged in) |
| 2 | `authorize('admin')` | Rejects non-admin tokens with 403 |
| 3 | `backupLimiter` | Per-IP rate limit (default **3 / 15 min**) — blocks brute force |
| 4 | body validation | `passcode` is required (4-256 chars) |
| 5 | `bcrypt.compare(passcode, ADMIN_BACKUP_PASSCODE_HASH)` | Secondary passcode check |
| 6 | `audit.log(BACKUP_DOWNLOAD_FAILURE/SUCCESS)` | Every attempt recorded with actor_id + IP |
| 7 | `db.backup(tempFile)` | SQLite **online backup API** — consistent point-in-time snapshot, writes not blocked |
| 8 | `fs.createReadStream(temp).pipe(res)` | Stream the snapshot to the admin browser |
| 9 | cleanup on `end`/`error`/`close` | Temp file deleted immediately |

**Why not just copy `medical.db`?** With WAL mode, the live `.db` file plus its `-wal` and `-shm` sidecars are mid-write. Copying the main file alone can produce a corrupt snapshot. SQLite's online backup API copies page-by-page under its own lock, yielding a file that opens cleanly.

**Brute-force protection:** the rate limiter keys on IP, so even a leaked admin JWT + many passcode guesses is throttled to 3 per 15 minutes. The audit log gives full visibility on attempts:

```
GET /api/v1/admin/audit-logs?action=BACKUP_DOWNLOAD_FAILURE
```

---

## API Reference

All under `/api/v1`. Standard envelope `{ success, data, message }`.

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health (no auth) |
| POST | `/api/v1/setup` | Idempotent initial-admin creation (only works if no admin exists → 409 otherwise) |

### Auth
| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/v1/auth/doctor-login` | `{ phone_number, password }` | `{ token, user }` |
| POST | `/api/v1/auth/patient-register` | `{ name, phone_number, age?, smoking_status?, medical_history? }` | `{ patient_token, jwt, profileId, user }` |
| POST | `/api/v1/auth/patient-login` | `{ patient_token }` | `{ jwt, user, profileId }` |
| GET | `/api/v1/auth/me` | — (Bearer) | current user |

### Patient (Bearer, role: patient)
| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/v1/patient/profile` | — | patient profile |
| POST | `/api/v1/patient/records` | multipart: `files[]` + fields | `{ recordId, files_uploaded }` |
| GET | `/api/v1/patient/records?page=&limit=` | — | paginated records |
| POST | `/api/v1/patient/consultation` | `{ notes }` | `{ whatsapp_link, consultationId }` |

### Admin (Bearer, role: admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/metrics` | Server snapshot (users, requests, DB size, uptime) |
| GET | `/api/v1/admin/patients?page=&limit=&search=` | Paginated patients |
| GET | `/api/v1/admin/users/:userId` | User detail + profile |
| GET | `/api/v1/admin/patients/:userId/records` | Patient's records |
| PATCH | `/api/v1/admin/users/:id/role` | body `{ role }` |
| PATCH | `/api/v1/admin/users/:id/status` | body `{ status }` (active/suspended) |
| DELETE | `/api/v1/admin/users/:id` | Cascade delete |
| GET | `/api/v1/admin/settings` | Settings key/value map |
| PUT | `/api/v1/admin/settings` | body `{ telegram_bot_token, telegram_chat_id, doctor_whatsapp }` |
| POST | `/api/v1/admin/settings/test-telegram` | body `{ token, chat_id }` |
| GET | `/api/v1/admin/logs?page=&limit=` | Recent request logs |
| GET | `/api/v1/admin/logs/status-breakdown` | 2xx/4xx/5xx counts |
| GET | `/api/v1/admin/logs/top-endpoints` | Top 10 paths by hits |
| GET | `/api/v1/admin/audit-logs?page=&limit=&action=` | Backup + sensitive-action audit trail |
| GET | `/api/v1/admin/backup-db/info` | Backup config + DB size |
| POST | `/api/v1/admin/backup-db` | body `{ passcode }` → binary `.db` snapshot |

### Error codes (stable, Flutter can switch on these)
`AUTH_REQUIRED`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `AUTH_INVALID_CREDENTIALS`, `AUTH_SUSPENDED`, `AUTH_FORBIDDEN`, `VALIDATION_FAILED`, `CONFLICT_PHONE`, `NOT_FOUND`, `ROUTE_NOT_FOUND`, `RATE_LIMITED`, `BACKUP_PASSCODE_REQUIRED`, `BACKUP_PASSCODE_INVALID`, `BACKUP_RATE_LIMITED`, `BACKUP_NOT_CONFIGURED`, `BACKUP_SNAPSHOT_FAILED`, `FILE_TOO_LARGE`, `INTERNAL`.

---

## Admin Dashboard

Served at **`/admin/`** (no separate build step — Tailwind CDN + Chart.js CDN + vanilla JS).

**Features:**
- Login (phone + password) → JWT stored in `localStorage`
- Dashboard: KPI cards (users / patients / total requests / DB size), HTTP status donut, top endpoints bar chart, uptime + RSS
- Patients: searchable + paginated table, per-row actions (view records, change role, suspend/activate, delete)
- Logs: recent request log table + audit log table (filtered by action)
- Settings: telegram creds + doctor whatsapp, with a "test telegram" button
- **Backup modal**: secondary passcode prompt → streams `.db` snapshot to the browser
- Dark / light theme toggle, fully responsive

---

## Flutter Integration

```dart
// lib/services/api.dart
import 'package:dio/dio.dart';

class Api {
  static const _base = 'https://YOUR-DOMAIN/api/v1';
  final Dio _dio = Dio(BaseOptions(baseUrl: _base, connectTimeout: 10.seconds));

  // Store these in flutter_secure_storage after first login
  String? _jwt;
  String? _patientToken;

  Api() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (opts, handler) {
        if (_jwt != null) {
          opts.headers['Authorization'] = 'Bearer $_jwt';
        }
        handler.next(opts);
      },
    ));
  }

  Future<Map<String, dynamic>> doctorLogin(String phone, String password) async {
    final r = await _dio.post('/auth/doctor-login', data: {
      'phone_number': phone, 'password': password,
    });
    if (r.data['success'] == true) {
      _jwt = r.data['data']['token'];
    }
    return r.data;
  }

  Future<Map<String, dynamic>> patientRegister(Map<String, dynamic> body) async {
    final r = await _dio.post('/auth/patient-register', data: body);
    if (r.data['success'] == true) {
      _jwt = r.data['data']['jwt'];
      _patientToken = r.data['data']['patient_token'];
      // persist both in flutter_secure_storage
    }
    return r.data;
  }

  Future<Map<String, dynamic>> patientLogin(String token) async {
    final r = await _dio.post('/auth/patient-login', data: {'patient_token': token});
    if (r.data['success'] == true) _jwt = r.data['data']['jwt'];
    return r.data;
  }

  Future<Map<String, dynamic>> listRecords({int page = 1, int limit = 20}) async {
    final r = await _dio.get('/patient/records', queryParameters: {'page': page, 'limit': limit});
    return r.data;
  }

  // Upload a record with files (photos/PDFs → forwarded to Telegram)
  Future<Map<String, dynamic>> addRecord({
    required String bp, required int hr, String? notes,
    required List<File> files, String uploadMode = 'photo',
  }) async {
    final form = FormData();
    form.fields.add(MapEntry('blood_pressure', bp));
    form.fields.add(MapEntry('heart_rate', hr.toString()));
    if (notes != null) form.fields.add(MapEntry('notes', notes));
    form.fields.add(MapEntry('upload_mode', uploadMode));
    for (final f in files) {
      form.files.add(MapEntry('files', MultipartFile.fromFileSync(f.path)));
    }
    final r = await _dio.post('/patient/records', data: form);
    return r.data;
  }
}
```

**Branch on `success`:** every response has it. `true` → use `data`; `false` → read `error.code` for localized handling.

---

## Deployment (Free Tiers)

### Option A — Fly.io (recommended, persistent volume)

```bash
# 1. Install flyctl, sign in
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Launch (creates app + 1GB volume)
cd medical-backend
fly launch --no-deploy          # accept defaults, fly.toml already exists
fly volumes create medical_data --size 1   # persistent SQLite storage

# 3. Set secrets (NEVER put these in fly.toml)
fly secrets set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
fly secrets set ADMIN_NAME="Dr. Admin" ADMIN_PHONE="01000000000" ADMIN_PASSWORD="ChangeThisNow!"
fly secrets set ADMIN_BACKUP_PASSCODE_HASH='$2a$10$...'   # from `npm run hash:passcode`
fly secrets set CORS_ORIGINS="https://admin.yourdomain.com"

# 4. Deploy
fly deploy

# 5. Create the initial admin (one-time, against the live DB)
fly ssh console --command "node scripts/create-admin.js"

# 6. Open the dashboard
fly apps open    # → https://<app>.fly.dev/admin/
```

### Option B — Render

1. New → Web Service → connect repo → root `medical-backend/`
2. Build: `npm install`
3. Start: `npm start`
4. Add a **Disk** (Render persistent disk) mounted at `/app/data` (1 GB on the free tier for the first 90 days)
5. Set env vars in the Render dashboard (JWT_SECRET, ADMIN_BACKUP_PASSCODE_HASH, etc.)
6. Set `DB_PATH=/app/data/medical.db`

### Option C — Railway

1. New project → deploy from repo → root `medical-backend/`
2. Add a **Volume** mounted at `/app/data`
3. Set variables (same as above)
4. `railway up`

### Important — the SQLite file must persist

All three options need a **persistent volume** mounted at `/app/data` (or wherever `DB_PATH` points). Without it, every redeploy wipes the database. The `.env` sets `DB_PATH=./data/medical.db` for local; on Fly/Render/Railway set `DB_PATH=/app/data/medical.db`.

---

## Migration to Turso / PostgreSQL

The entire SQL surface lives in `src/repositories/*`. Business logic in `src/services/*` never writes SQL.

- **Turso (libSQL):** swap `better-sqlite3` for `@libsql/client` in `src/db/index.js` only — repositories already use simple `prepare().get()/all()/run()` patterns. The `.backup()` call in `src/db/backup.js` becomes a Turso dump or replica read.
- **PostgreSQL:** replace each repository's prepared statements with `pg` queries. The controller/service layers stay untouched.

No other files change.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run in production |
| `npm run dev` | Run with `node --watch` (auto-reload) |
| `npm run setup:admin` | Create / reset the initial admin |
| `npm run hash:passcode` | Hash the backup passcode → put in `.env` |
| `npm run db:migrate` | Re-apply schema (idempotent) |

---

## License

MIT
