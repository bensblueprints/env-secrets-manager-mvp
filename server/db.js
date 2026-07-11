const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const db = new Database(dbPath, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      ciphertext TEXT NOT NULL,           -- AES-256-GCM(value, DEK)
      iv TEXT NOT NULL,
      wrapped_dek TEXT NOT NULL,          -- AES-256-GCM(DEK, MASTER_KEY from .env)
      version INTEGER NOT NULL DEFAULT 1,
      is_current INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'admin'
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'read',  -- read | readwrite
      hashed_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,                 -- 'admin' | 'token:<name>'
      action TEXT NOT NULL,                -- secret.set|secret.reveal|secret.delete|secret.rollback|secrets.pull|...
      project_id INTEGER,
      environment_id INTEGER,
      secret_key TEXT,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secrets_env ON secrets(environment_id, key, is_current);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
  `);

  return db;
}

function genSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { openDb, genSessionToken };
