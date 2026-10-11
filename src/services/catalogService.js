/**
 * CatalogService — admin CRUD for the 5 catalogs + patient-facing read.
 *
 * The patient list endpoints are READ-ONLY (just listAll — no pagination
 * needed since the catalogs are small doctor-curated lists). The admin CRUD
 * endpoints accept a `catalog` param (diseases|surgeries|symptoms|
 * medications|consultation_types) and route to the right repo method.
 *
 * The branching-on-catalog pattern is centralized here so the controller
 * (catalogController) can stay truly thin: just call `service.list(catalog)`
 * or `service.create(catalog, payload)`.
 */

const { v4: uuidv4 } = require('uuid');

const catalogRepo = require('../repositories/catalogRepository');
const ApiError = require('../utils/ApiError');

const CATALOGS = ['diseases', 'surgeries', 'symptoms', 'medications', 'consultation_types'];

function getRepo(catalog) {
  const r = catalogRepo[catalog];
  if (!r) throw ApiError.badRequest('INVALID_CATALOG', `Unknown catalog: ${catalog}. Valid: ${CATALOGS.join(', ')}.`);
  return r;
}

module.exports = {
  CATALOGS,

  // ── Patient-facing read (no pagination) ──
  listAll(catalog) {
    const repo = getRepo(catalog);
    return repo.listAll();
  },

  // ── Admin CRUD ──
  listPaged(catalog, { page = 1, limit = 50 } = {}) {
    const repo = getRepo(catalog);
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = repo.list(safeLimit, safeOffset);
    const total = repo.count();
    return { rows, total, page, limit: safeLimit };
  },

  getById(catalog, id) {
    const repo = getRepo(catalog);
    const row = repo.getById(id);
    if (!row) throw ApiError.notFound('CATALOG_ITEM_NOT_FOUND', 'Catalog item not found.');
    return row;
  },

  create(catalog, { adminId, ...payload }) {
    const repo = getRepo(catalog);
    const id = uuidv4();
    switch (catalog) {
      case 'diseases':
      case 'surgeries':
        if (!payload.name) throw ApiError.badRequest('VALIDATION_FAILED', 'name is required.');
        repo.insert({ id, name: payload.name, category: payload.category, adminId });
        break;
      case 'symptoms':
        if (!payload.name) throw ApiError.badRequest('VALIDATION_FAILED', 'name is required.');
        repo.insert({
          id, name: payload.name, category: payload.category,
          isCritical: !!payload.is_critical, adminId,
        });
        break;
      case 'medications':
        if (!payload.brand_name) throw ApiError.badRequest('VALIDATION_FAILED', 'brand_name is required.');
        repo.insert({
          id, brandName: payload.brand_name, genericName: payload.generic_name,
          form: payload.form, category: payload.category, adminId,
        });
        break;
      case 'consultation_types':
        if (!payload.name) throw ApiError.badRequest('VALIDATION_FAILED', 'name is required.');
        if (!['immediate', 'regular'].includes(payload.category)) {
          throw ApiError.badRequest('VALIDATION_FAILED', 'category must be "immediate" or "regular".');
        }
        repo.insert({ id, name: payload.name, category: payload.category, adminId });
        break;
      default:
        throw ApiError.badRequest('INVALID_CATALOG', `Unknown catalog: ${catalog}.`);
    }
    return repo.getById(id);
  },

  update(catalog, id, payload) {
    const repo = getRepo(catalog);
    const existing = repo.getById(id);
    if (!existing) throw ApiError.notFound('CATALOG_ITEM_NOT_FOUND', 'Catalog item not found.');
    switch (catalog) {
      case 'diseases':
      case 'surgeries':
        repo.update(id, {
          name: payload.name ?? existing.name,
          category: payload.category ?? existing.category,
        });
        break;
      case 'symptoms':
        repo.update(id, {
          name: payload.name ?? existing.name,
          category: payload.category ?? existing.category,
          isCritical: payload.is_critical !== undefined ? !!payload.is_critical : !!existing.is_critical,
        });
        break;
      case 'medications':
        repo.update(id, {
          brandName: payload.brand_name ?? existing.brand_name,
          genericName: payload.generic_name ?? existing.generic_name,
          form: payload.form ?? existing.form,
          category: payload.category ?? existing.category,
        });
        break;
      case 'consultation_types':
        if (payload.category && !['immediate', 'regular'].includes(payload.category)) {
          throw ApiError.badRequest('VALIDATION_FAILED', 'category must be "immediate" or "regular".');
        }
        repo.update(id, {
          name: payload.name ?? existing.name,
          category: payload.category ?? existing.category,
        });
        break;
      default:
        throw ApiError.badRequest('INVALID_CATALOG', `Unknown catalog: ${catalog}.`);
    }
    return repo.getById(id);
  },

  remove(catalog, id) {
    const repo = getRepo(catalog);
    const existing = repo.getById(id);
    if (!existing) throw ApiError.notFound('CATALOG_ITEM_NOT_FOUND', 'Catalog item not found.');
    repo.deleteById(id);
    return { id, deleted: true };
  },
};
