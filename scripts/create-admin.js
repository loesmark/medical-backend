/**
 * scripts/create-admin.js
 * Idempotent CLI to create (or reset) the initial admin user.
 * Reads ADMIN_NAME / ADMIN_PHONE / ADMIN_PASSWORD from .env.
 *
 * Usage:  npm run setup:admin
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const config = require('../src/config');

const name = config.initialAdmin.name;
const phone = config.initialAdmin.phone;
const password = config.initialAdmin.password;

if (!password || password.length < 8) {
  // eslint-disable-next-line no-console
  console.error('❌ ADMIN_PASSWORD must be at least 8 characters. Set it in .env first.');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE phone_number = ?').get(phone);
const hash = bcrypt.hashSync(password, config.bcrypt.saltRounds);

if (existing) {
  db.prepare('UPDATE users SET name = ?, password_hash = ?, role = ?, status = ? WHERE id = ?').run(
    name, hash, 'admin', 'active', existing.id
  );
  // eslint-disable-next-line no-console
  console.log(`✅ Admin reset: phone=${phone} (id=${existing.id})`);
} else {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO users (id, name, phone_number, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'admin', 'active')`
  ).run(id, name, phone, hash);
  // eslint-disable-next-line no-console
  console.log(`✅ Admin created: id=${id} phone=${phone} name=${name}`);
}

db.closeDatabase();
process.exit(0);
