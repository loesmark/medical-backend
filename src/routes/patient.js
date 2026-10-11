/**
 * Patient routes — /api/v1/patient/*   (auth: patient)
 *
 *   GET    /profile                      → own profile + selections
 *   PUT    /profile                      → update profile (transactional)
 *   GET    /profile/versions             → version snapshots
 *
 *   POST   /records        (multipart)  → health record (with optional symptoms + files → Telegram)
 *   GET    /records?page=&limit=         → paginated records
 *
 *   POST   /symptom-logs                 → standalone symptom log (no vitals)
 *   GET    /symptom-logs?page=&limit=    → paginated logs
 *
 *   POST   /documents      (multipart)  → upload a document (ECG/Echo/lab) → Telegram
 *   GET    /documents?page=&limit=      → paginated documents
 *   GET    /documents/:id                → fetch one (own only)
 *
 *   POST   /consultations                → create (immediate|regular)
 *   GET    /consultations?page=&limit=   → list mine
 *   GET    /consultations/:id           → get mine
 *
 *   GET    /working-hours               → doctor's recurring hours
 *   GET    /available-slots?date=        → computed free slots
 *
 *   POST   /appointments                → request
 *   GET    /appointments?page=&limit=   → list mine
 *   DELETE /appointments/:id            → cancel mine
 *
 *   GET    /treatment-plan              → current plan
 *   GET    /treatment-plan/versions     → version history
 *
 * All require authenticate + authorize('patient').
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimit');

const profileController = require('../controllers/patientProfileController');
const healthRecordController = require('../controllers/healthRecordController');
const symptomLogController = require('../controllers/symptomLogController');
const patientDocumentController = require('../controllers/patientDocumentController');
const { patientRouter: consultationRoutes } = require('./consultations');
const { patientRouter: appointmentRoutes } = require('./appointments');
const { patientRouter: treatmentPlanRoutes } = require('./treatmentPlans');

const { updateProfile } = require('../validators/patientProfileValidator');
const { addRecord } = require('../validators/healthRecordValidator');
const { addLog } = require('../validators/symptomLogValidator');

// File upload limits: 10 files, 8MB each (covers photos & PDFs)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|webp/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.test(ext) || allowed.test(file.mimetype.split('/')[1] || '')) {
      return cb(null, true);
    }
    cb(new Error(`File type not allowed: ${ext || file.mimetype}`));
  },
});

router.use(authenticate, authorize('patient'), apiLimiter);

// ── Profile ──
router.get('/profile', profileController.getProfile);
router.put('/profile', updateProfile, profileController.updateProfile);
router.get('/profile/versions', profileController.listVersions);

// ── Health records ──
router.post('/records', upload.array('files', 10), addRecord, healthRecordController.addRecord);
router.get('/records', healthRecordController.listRecords);

// ── Symptom logs ──
router.post('/symptom-logs', addLog, symptomLogController.addLog);
router.get('/symptom-logs', symptomLogController.listLogs);

// ── Documents (ECG/Echo/lab) ──
router.post('/documents', upload.array('files', 10), patientDocumentController.upload);
router.get('/documents', patientDocumentController.listDocuments);
router.get('/documents/:id', patientDocumentController.getDocument);

// ── Consultations (patient sub-router) ──
router.use('/consultations', consultationRoutes);

// ── Appointments / working hours / available slots (patient sub-router) ──
router.use('/', appointmentRoutes);

// ── Treatment plan (patient sub-router) ──
router.use('/treatment-plan', treatmentPlanRoutes);

module.exports = router;
