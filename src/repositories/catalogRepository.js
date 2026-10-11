/**
 * CatalogRepository — CRUD for the 5 doctor-curated catalogs:
 *   diseases, surgeries, symptoms, medications, consultation_types.
 *
 * Most catalogs share the shape (id, name, category, created_by_admin_id,
 * created_at). Medications diverges (brand_name + generic_name + form +
 * category) and consultation_types uses a CHECK constraint on category.
 *
 * The patient-facing list endpoints are READ-ONLY and join nothing — they
 * just return the catalog rows sorted by name.
 */

const db = require('../db');

// ── Diseases ──
const diseasesStmts = {
  list: db.prepare(
    `SELECT id, name, category, created_at
     FROM diseases ORDER BY name ASC LIMIT ? OFFSET ?`
  ),
  listAll: db.prepare(`SELECT id, name, category, created_at FROM diseases ORDER BY name ASC`),
  count: db.prepare(`SELECT COUNT(*) as c FROM diseases`),
  getById: db.prepare(`SELECT * FROM diseases WHERE id = ?`),
  insert: db.prepare(
    `INSERT INTO diseases (id, name, category, created_by_admin_id)
     VALUES (?, ?, ?, ?)`
  ),
  update: db.prepare(`UPDATE diseases SET name = ?, category = ? WHERE id = ?`),
  deleteById: db.prepare(`DELETE FROM diseases WHERE id = ?`),
};

// ── Surgeries ──
const surgeriesStmts = {
  list: db.prepare(
    `SELECT id, name, category, created_at
     FROM surgeries ORDER BY name ASC LIMIT ? OFFSET ?`
  ),
  listAll: db.prepare(`SELECT id, name, category, created_at FROM surgeries ORDER BY name ASC`),
  count: db.prepare(`SELECT COUNT(*) as c FROM surgeries`),
  getById: db.prepare(`SELECT * FROM surgeries WHERE id = ?`),
  insert: db.prepare(
    `INSERT INTO surgeries (id, name, category, created_by_admin_id)
     VALUES (?, ?, ?, ?)`
  ),
  update: db.prepare(`UPDATE surgeries SET name = ?, category = ? WHERE id = ?`),
  deleteById: db.prepare(`DELETE FROM surgeries WHERE id = ?`),
};

// ── Symptoms (with is_critical flag) ──
const symptomsStmts = {
  list: db.prepare(
    `SELECT id, name, category, is_critical, created_at
     FROM symptoms ORDER BY name ASC LIMIT ? OFFSET ?`
  ),
  listAll: db.prepare(
    `SELECT id, name, category, is_critical, created_at FROM symptoms ORDER BY name ASC`
  ),
  count: db.prepare(`SELECT COUNT(*) as c FROM symptoms`),
  getById: db.prepare(`SELECT * FROM symptoms WHERE id = ?`),
  insert: db.prepare(
    `INSERT INTO symptoms (id, name, category, is_critical, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?)`
  ),
  update: db.prepare(
    `UPDATE symptoms SET name = ?, category = ?, is_critical = ? WHERE id = ?`
  ),
  deleteById: db.prepare(`DELETE FROM symptoms WHERE id = ?`),
};

// ── Medications (brand_name + generic_name + form) ──
const medicationsStmts = {
  list: db.prepare(
    `SELECT id, brand_name, generic_name, form, category, created_at
     FROM medications ORDER BY brand_name ASC LIMIT ? OFFSET ?`
  ),
  listAll: db.prepare(
    `SELECT id, brand_name, generic_name, form, category, created_at
     FROM medications ORDER BY brand_name ASC`
  ),
  count: db.prepare(`SELECT COUNT(*) as c FROM medications`),
  getById: db.prepare(`SELECT * FROM medications WHERE id = ?`),
  insert: db.prepare(
    `INSERT INTO medications (id, brand_name, generic_name, form, category, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  update: db.prepare(
    `UPDATE medications
       SET brand_name = ?, generic_name = ?, form = ?, category = ?
     WHERE id = ?`
  ),
  deleteById: db.prepare(`DELETE FROM medications WHERE id = ?`),
};

// ── Consultation types (category CHECK immediate|regular) ──
const consultationTypesStmts = {
  list: db.prepare(
    `SELECT id, name, category, created_at
     FROM consultation_types ORDER BY name ASC LIMIT ? OFFSET ?`
  ),
  listAll: db.prepare(
    `SELECT id, name, category, created_at FROM consultation_types ORDER BY name ASC`
  ),
  listByCategory: db.prepare(
    `SELECT id, name, category FROM consultation_types WHERE category = ? ORDER BY name ASC`
  ),
  count: db.prepare(`SELECT COUNT(*) as c FROM consultation_types`),
  getById: db.prepare(`SELECT * FROM consultation_types WHERE id = ?`),
  insert: db.prepare(
    `INSERT INTO consultation_types (id, name, category, created_by_admin_id)
     VALUES (?, ?, ?, ?)`
  ),
  update: db.prepare(`UPDATE consultation_types SET name = ?, category = ? WHERE id = ?`),
  deleteById: db.prepare(`DELETE FROM consultation_types WHERE id = ?`),
};

module.exports = {
  // ── Diseases ──
  diseases: {
    list(limit, offset) { return diseasesStmts.list.all(limit, offset); },
    listAll() { return diseasesStmts.listAll.all(); },
    count() { return diseasesStmts.count.get().c; },
    getById(id) { return diseasesStmts.getById.get(id) || null; },
    insert({ id, name, category, adminId }) {
      diseasesStmts.insert.run(id, name, category || null, adminId || null);
    },
    update(id, { name, category }) {
      return diseasesStmts.update.run(name, category || null, id);
    },
    deleteById(id) { return diseasesStmts.deleteById.run(id); },
  },

  // ── Surgeries ──
  surgeries: {
    list(limit, offset) { return surgeriesStmts.list.all(limit, offset); },
    listAll() { return surgeriesStmts.listAll.all(); },
    count() { return surgeriesStmts.count.get().c; },
    getById(id) { return surgeriesStmts.getById.get(id) || null; },
    insert({ id, name, category, adminId }) {
      surgeriesStmts.insert.run(id, name, category || null, adminId || null);
    },
    update(id, { name, category }) {
      return surgeriesStmts.update.run(name, category || null, id);
    },
    deleteById(id) { return surgeriesStmts.deleteById.run(id); },
  },

  // ── Symptoms ──
  symptoms: {
    list(limit, offset) { return symptomsStmts.list.all(limit, offset); },
    listAll() { return symptomsStmts.listAll.all(); },
    count() { return symptomsStmts.count.get().c; },
    getById(id) { return symptomsStmts.getById.get(id) || null; },
    insert({ id, name, category, isCritical, adminId }) {
      symptomsStmts.insert.run(id, name, category || null, isCritical ? 1 : 0, adminId || null);
    },
    update(id, { name, category, isCritical }) {
      return symptomsStmts.update.run(name, category || null, isCritical ? 1 : 0, id);
    },
    deleteById(id) { return symptomsStmts.deleteById.run(id); },
  },

  // ── Medications ──
  medications: {
    list(limit, offset) { return medicationsStmts.list.all(limit, offset); },
    listAll() { return medicationsStmts.listAll.all(); },
    count() { return medicationsStmts.count.get().c; },
    getById(id) { return medicationsStmts.getById.get(id) || null; },
    insert({ id, brandName, genericName, form, category, adminId }) {
      medicationsStmts.insert.run(
        id,
        brandName,
        genericName || null,
        form || null,
        category || null,
        adminId || null
      );
    },
    update(id, { brandName, genericName, form, category }) {
      return medicationsStmts.update.run(
        brandName,
        genericName || null,
        form || null,
        category || null,
        id
      );
    },
    deleteById(id) { return medicationsStmts.deleteById.run(id); },
  },

  // ── Consultation types ──
  consultationTypes: {
    list(limit, offset) { return consultationTypesStmts.list.all(limit, offset); },
    listAll() { return consultationTypesStmts.listAll.all(); },
    listByCategory(category) { return consultationTypesStmts.listByCategory.all(category); },
    count() { return consultationTypesStmts.count.get().c; },
    getById(id) { return consultationTypesStmts.getById.get(id) || null; },
    insert({ id, name, category, adminId }) {
      consultationTypesStmts.insert.run(id, name, category, adminId || null);
    },
    update(id, { name, category }) {
      return consultationTypesStmts.update.run(name, category, id);
    },
    deleteById(id) { return consultationTypesStmts.deleteById.run(id); },
  },

  // Snake_case alias — the route param is `consultation_types` (matches the DB table
  // name + the CATALOGS allowlist in catalogService). catalogService.getRepo() looks
  // up by the string key, so both camelCase + snake_case must resolve to the same repo.
  consultation_types: null, // placeholder, assigned below to avoid self-reference
};

// Assign the snake_case alias to point to the same object as the camelCase key.
module.exports.consultation_types = module.exports.consultationTypes;
