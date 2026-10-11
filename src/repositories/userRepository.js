/**
 * UserRepository — all user-related SQL lives here.
 * Swap this file for Turso/PG equivalents later; services stay untouched.
 */

const db = require('../db');

const stmts = {
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByPhone: db.prepare('SELECT * FROM users WHERE phone_number = ?'),
  findByToken: db.prepare('SELECT * FROM users WHERE patient_token = ?'),
  findByRole: db.prepare('SELECT * FROM users WHERE role = ? LIMIT 1'),
  countAdmins: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'"),
  countAll: db.prepare('SELECT COUNT(*) as c FROM users'),
  countByRole: db.prepare('SELECT role, COUNT(*) as c FROM users GROUP BY role'),
  countByStatus: db.prepare("SELECT status, COUNT(*) as c FROM users GROUP BY status"),

  insert: db.prepare(
    `INSERT INTO users (id, name, phone_number, password_hash, role, patient_token, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  updateRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  updateStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  deleteById: db.prepare('DELETE FROM users WHERE id = ?'),
  updateProfile: db.prepare('UPDATE users SET name = ?, phone_number = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),

  // NOTE (V3-CODE): the v3 schema replaced `age` → `birth_date` and
  // `medical_history` → `additional_info` on patient_profiles. The old
  // queries here would fail to PREPARE against the new schema (better-sqlite3
  // validates column references at prepare-time), breaking the boot.
  // The admin list-patients flow now goes through
  // patientProfileRepository.listPatientsWithProfile which selects the new
  // columns. These statements are kept ONLY for legacy callers and are
  // rewritten to use the new columns so they no longer crash at boot.
  listPaged: db.prepare(`
    SELECT u.id, u.name, u.phone_number, u.role, u.status, u.created_at,
           p.id AS profile_id,
           p.birth_date, p.smoking_status, p.additional_info,
           p.updated_at AS profile_updated_at
    FROM users u
    LEFT JOIN patient_profiles p ON p.user_id = u.id
    WHERE u.role = 'patient'
      AND (
        ? IS NULL
        OR u.name LIKE '%' || ? || '%'
        OR u.phone_number LIKE '%' || ? || '%'
        OR u.id = ?
      )
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `),
  countPaged: db.prepare(`
    SELECT COUNT(*) as c
    FROM users u
    WHERE u.role = 'patient'
      AND (
        ? IS NULL
        OR u.name LIKE '%' || ? || '%'
        OR u.phone_number LIKE '%' || ? || '%'
      )
  `),
};

module.exports = {
  findById(id) { return stmts.findById.get(id) || null; },
  findByPhone(phone) { return stmts.findByPhone.get(phone) || null; },
  findByToken(token) { return stmts.findByToken.get(token) || null; },
  findFirstAdmin() { return stmts.findByRole.get('admin') || null; },
  countAdmins() { return stmts.countAdmins.get().c; },
  countAll() { return stmts.countAll.get().c; },
  countByRole() { return stmts.countByRole.all(); },
  countByStatus() { return stmts.countByStatus.all(); },

  insert({ id, name, phone, passwordHash, role, patientToken, status = 'active' }) {
    stmts.insert.run(id, name, phone, passwordHash, role, patientToken, status);
  },

  updateRole(id, role) { return stmts.updateRole.run(role, id); },
  updateStatus(id, status) { return stmts.updateStatus.run(status, id); },
  deleteById(id) { return stmts.deleteById.run(id); },
  updateProfile(id, name, phone) { return stmts.updateProfile.run(name, phone, id); },
  updatePassword(id, hash) { return stmts.updatePassword.run(hash, id); },

  // search: null/empty → no filter
  listPatients({ search, limit, offset }) {
    const term = search && search.trim() ? search.trim() : null;
    return stmts.listPaged.all(term, term, term, term, limit, offset);
  },
  countPatients({ search }) {
    const term = search && search.trim() ? search.trim() : null;
    return stmts.countPaged.get(term, term, term).c;
  },
};
