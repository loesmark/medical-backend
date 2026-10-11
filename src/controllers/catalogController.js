/**
 * CatalogController — admin CRUD + patient list (shared, methods branch on role).
 *
 * Patient (role='patient') → GET /catalogs/:catalog → listAll (read-only).
 * Admin  (role='admin')     → GET /catalogs/:catalog?page=&limit=
 *                              GET /catalogs/:catalog/:id
 *                              POST /catalogs/:catalog
 *                              PUT /catalogs/:catalog/:id
 *                              DELETE /catalogs/:catalog/:id
 *
 * The role-branching is done at the controller layer (one method per HTTP verb)
 * so the route file can stay ultra-thin.
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginate, noContent } = require('../utils/response');
const catalogService = require('../services/catalogService');
const audit = require('../middleware/auditLog');

function check(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('validation');
    err.type = 'validation';
    err.array = () => errors.array();
    throw err;
  }
}

// Reusable list — patients get all rows unpaginated, admins get paged.
module.exports = {
  list: asyncHandler(async (req, res) => {
    const { catalog } = req.params;
    if (req.user?.role === 'admin') {
      const { page = 1, limit = 50 } = req.query;
      const { rows, total } = catalogService.listPaged(catalog, {
        page: Number(page), limit: Number(limit),
      });
      return paginate(res, rows, total, req, `${catalog} catalog (admin).`);
    }
    // Patient → read-only full list
    const rows = catalogService.listAll(catalog);
    return ok(res, rows, `${catalog} catalog.`);
  }),

  getOne: asyncHandler(async (req, res) => {
    const { catalog, id } = req.params;
    return ok(res, catalogService.getById(catalog, id), 'Catalog item.');
  }),

  create: asyncHandler(async (req, res) => {
    check(req);
    if (req.user?.role !== 'admin') {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'Only admins can create catalog items.');
    }
    const { catalog } = req.params;
    const item = catalogService.create(catalog, { adminId: req.user.id, ...req.body });
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'CATALOG_CREATE', target: catalog, status: 'success',
      meta: { id: item.id },
    });
    return created(res, item, 'Catalog item created.');
  }),

  update: asyncHandler(async (req, res) => {
    check(req);
    if (req.user?.role !== 'admin') {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'Only admins can edit catalog items.');
    }
    const { catalog, id } = req.params;
    const item = catalogService.update(catalog, id, req.body);
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'CATALOG_UPDATE', target: catalog, status: 'success',
      meta: { id },
    });
    return ok(res, item, 'Catalog item updated.');
  }),

  remove: asyncHandler(async (req, res) => {
    if (req.user?.role !== 'admin') {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'Only admins can delete catalog items.');
    }
    const { catalog, id } = req.params;
    const result = catalogService.remove(catalog, id);
    audit.log({
      actorId: req.user.id, actorIp: req.ip,
      action: 'CATALOG_DELETE', target: catalog, status: 'success',
      meta: { id },
    });
    return noContent(res, 'Catalog item deleted.');
  }),
};
