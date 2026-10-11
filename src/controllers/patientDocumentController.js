/**
 * PatientDocumentController — upload + list.
 *
 * Upload is multipart (multer in the route). The patient sends:
 *   type       ecg|echo|lab|other
 *   title?     string
 *   taken_at?  YYYY-MM-DD
 *   notes?     string
 *   upload_mode? 'photo' | 'document' (for Telegram)
 *   files      up to 10 files
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate } = require('../utils/response');
const documentService = require('../services/patientDocumentService');

function check(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('validation');
    err.type = 'validation';
    err.array = () => errors.array();
    throw err;
  }
}

module.exports = {
  upload: asyncHandler(async (req, res) => {
    check(req);
    if (!req.user?.id) throw ApiError.unauthorized();
    const data = await documentService.upload({
      userId: req.user.id,
      type: req.body.type,
      title: req.body.title,
      taken_at: req.body.taken_at,
      notes: req.body.notes,
      upload_mode: req.body.upload_mode,
      files: req.files || [],
    });
    return created(res, data, 'Document uploaded.');
  }),

  listDocuments: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const { page = 1, limit = 20 } = req.query;
    const { documents, total } = documentService.listDocuments(req.user.id, {
      page: Number(page), limit: Number(limit),
    });
    return paginate(res, documents, total, req, 'Patient documents.');
  }),

  // GET /patient/documents/:id — fetch a single document (own only).
  getDocument: asyncHandler(async (req, res) => {
    if (!req.user?.id) throw ApiError.unauthorized();
    const doc = documentService.getDocument(req.params.id);
    if (!doc) throw ApiError.notFound('DOCUMENT_NOT_FOUND', 'Document not found.');
    if (doc.patient_id !== req.user.id) {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'You can only access your own documents.');
    }
    return ok(res, doc, 'Patient document.');
  }),
};
