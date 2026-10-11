/**
 * SettingsRepository — key/value store for app settings (telegram creds, whatsapp).
 */

const db = require('../db');

const stmts = {
  get: db.prepare('SELECT value FROM settings WHERE key = ?'),
  all: db.prepare('SELECT key, value FROM settings'),
  upsert: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  deleteKey: db.prepare('DELETE FROM settings WHERE key = ?'),
};

module.exports = {
  get(key) { const r = stmts.get.get(key); return r ? r.value : null; },
  all() { return stmts.all.all(); },
  upsert(key, value) { return stmts.upsert.run(key, value); },
  upsertMany(items) {
    const tx = db.transaction((entries) => {
      for (const { key, value } of entries) {
        if (value !== undefined && value !== null) stmts.upsert.run(key, value);
      }
    });
    tx(items);
  },
  deleteKey(key) { return stmts.deleteKey.run(key); },
};
