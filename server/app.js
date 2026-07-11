// Secretbox server — encrypted team secrets manager.
// Values are envelope-encrypted at rest (see cryptobox.js). The master key
// comes from the environment, never the DB. Plaintext values are only ever
// returned on explicit, audit-logged reveal/pull calls — and never logged.
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb, genSessionToken } = require('./db');
const { parseMasterKey, encryptSecret, decryptSecret, hashToken, genApiToken } = require('./cryptobox');

const SESSION_COOKIE = 'sbx_session';
const DEFAULT_ENVS = ['dev', 'staging', 'prod'];

function createApp({ dbPath, adminPassword, masterKeyHex, autologinToken = null } = {}) {
  const masterKey = parseMasterKey(masterKeyHex);
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.locals.db = db;

  function audit(actor, action, projectId = null, envId = null, secretKey = null) {
    db.prepare('INSERT INTO audit_log (actor, action, project_id, environment_id, secret_key, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(actor, action, projectId, envId, secretKey, Date.now());
  }

  function requireAuth(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (token && db.prepare('SELECT id FROM sessions WHERE token = ?').get(token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  }

  function createSession(res) {
    const token = genSessionToken();
    db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax' });
  }

  // Bearer-token auth for the CLI/API surface.
  function tokenAuth(req, res, minScope) {
    const header = String(req.headers.authorization || '');
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!raw) { res.status(401).json({ error: 'missing bearer token' }); return null; }
    const row = db.prepare('SELECT * FROM tokens WHERE hashed_token = ?').get(hashToken(raw));
    if (!row) { res.status(401).json({ error: 'invalid token' }); return null; }
    if (minScope === 'readwrite' && row.scope !== 'readwrite') {
      res.status(403).json({ error: 'token is read-only' });
      return null;
    }
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
    return row;
  }

  const getEnv = db.prepare('SELECT * FROM environments WHERE id = ?');
  const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');

  function currentSecrets(envId) {
    return db.prepare('SELECT * FROM secrets WHERE environment_id = ? AND is_current = 1 AND deleted = 0 ORDER BY key').all(envId);
  }

  function setSecret(envId, key, value, actor) {
    const K = String(key).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(K)) throw new Error('key must be a valid env var name (A-Z, 0-9, _)');
    const enc = encryptSecret(masterKey, value);
    const tx = db.transaction(() => {
      const prev = db.prepare('SELECT MAX(version) AS v FROM secrets WHERE environment_id = ? AND key = ?').get(envId, K);
      db.prepare('UPDATE secrets SET is_current = 0 WHERE environment_id = ? AND key = ?').run(envId, K);
      db.prepare(`
        INSERT INTO secrets (environment_id, key, ciphertext, iv, wrapped_dek, version, is_current, deleted, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
      `).run(envId, K, enc.ciphertext, enc.iv, enc.wrapped_dek, (prev.v || 0) + 1, Date.now(), actor);
    });
    tx();
    const env = getEnv.get(envId);
    audit(actor, 'secret.set', env.project_id, envId, K);
  }

  // ── auth ───────────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'secretbox' }));

  app.post('/api/login', (req, res) => {
    if ((req.body || {}).password !== adminPassword) return res.status(401).json({ error: 'wrong password' });
    createSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get('/auth/auto', (req, res) => {
    if (autologinToken && req.query.token === autologinToken) createSession(res);
    res.redirect('/');
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

  // ── projects & environments ────────────────────────────────────────────────
  app.get('/api/projects', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM projects ORDER BY name').all();
    res.json(rows.map((p) => ({
      ...p,
      environments: db.prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY id').all(p.id),
      secret_count: db.prepare(`
        SELECT COUNT(*) AS n FROM secrets s JOIN environments e ON e.id = s.environment_id
        WHERE e.project_id = ? AND s.is_current = 1 AND s.deleted = 0
      `).get(p.id).n
    })));
  });

  app.post('/api/projects', requireAuth, (req, res) => {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const info = db.prepare('INSERT INTO projects (name, created_at) VALUES (?, ?)').run(name, Date.now());
      for (const env of DEFAULT_ENVS) {
        db.prepare('INSERT INTO environments (project_id, name) VALUES (?, ?)').run(info.lastInsertRowid, env);
      }
      audit('admin', 'project.create', info.lastInsertRowid);
      res.status(201).json({ id: info.lastInsertRowid, name });
    } catch (e) {
      res.status(409).json({ error: 'project name already exists' });
    }
  });

  app.delete('/api/projects/:id', requireAuth, (req, res) => {
    const p = getProject.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const envIds = db.prepare('SELECT id FROM environments WHERE project_id = ?').all(p.id).map((e) => e.id);
    const tx = db.transaction(() => {
      for (const id of envIds) db.prepare('DELETE FROM secrets WHERE environment_id = ?').run(id);
      db.prepare('DELETE FROM environments WHERE project_id = ?').run(p.id);
      db.prepare('DELETE FROM tokens WHERE project_id = ?').run(p.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    });
    tx();
    audit('admin', 'project.delete', p.id);
    res.json({ ok: true });
  });

  app.post('/api/projects/:id/environments', requireAuth, (req, res) => {
    const p = getProject.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const name = String((req.body || {}).name || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(name)) return res.status(400).json({ error: 'invalid environment name' });
    try {
      const info = db.prepare('INSERT INTO environments (project_id, name) VALUES (?, ?)').run(p.id, name);
      res.status(201).json({ id: info.lastInsertRowid, name });
    } catch {
      res.status(409).json({ error: 'environment already exists' });
    }
  });

  // ── secrets (admin UI) ─────────────────────────────────────────────────────
  app.get('/api/environments/:id/secrets', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    res.json(currentSecrets(env.id).map((s) => ({
      key: s.key, version: s.version, updated_at: s.created_at, updated_by: s.created_by
    })));
  });

  app.post('/api/environments/:id/secrets', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if (typeof b.value !== 'string') return res.status(400).json({ error: 'value required' });
    try {
      setSecret(env.id, b.key, b.value, 'admin');
      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/environments/:id/secrets/:key/reveal', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    const row = db.prepare('SELECT * FROM secrets WHERE environment_id = ? AND key = ? AND is_current = 1 AND deleted = 0')
      .get(env.id, req.params.key);
    if (!row) return res.status(404).json({ error: 'not found' });
    audit('admin', 'secret.reveal', env.project_id, env.id, row.key);
    res.json({ key: row.key, value: decryptSecret(masterKey, row), version: row.version });
  });

  app.get('/api/environments/:id/secrets/:key/history', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    const rows = db.prepare('SELECT version, is_current, deleted, created_at, created_by FROM secrets WHERE environment_id = ? AND key = ? ORDER BY version DESC')
      .all(env.id, req.params.key);
    res.json(rows);
  });

  app.post('/api/environments/:id/secrets/:key/rollback', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    const version = Number((req.body || {}).version);
    const target = db.prepare('SELECT * FROM secrets WHERE environment_id = ? AND key = ? AND version = ?')
      .get(env.id, req.params.key, version);
    if (!target) return res.status(404).json({ error: 'version not found' });
    // Rollback = re-encrypt that version's value as a NEW head version (clean history).
    const value = decryptSecret(masterKey, target);
    setSecret(env.id, target.key, value, 'admin');
    audit('admin', 'secret.rollback', env.project_id, env.id, target.key);
    res.json({ ok: true });
  });

  app.delete('/api/environments/:id/secrets/:key', requireAuth, (req, res) => {
    const env = getEnv.get(req.params.id);
    if (!env) return res.status(404).json({ error: 'not found' });
    const info = db.prepare('UPDATE secrets SET deleted = 1 WHERE environment_id = ? AND key = ? AND is_current = 1')
      .run(env.id, req.params.key);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    audit('admin', 'secret.delete', env.project_id, env.id, req.params.key);
    res.json({ ok: true });
  });

  // Diff two environments: which keys exist where, which values differ.
  // Values themselves are never returned by this endpoint.
  app.get('/api/projects/:id/diff', requireAuth, (req, res) => {
    const p = getProject.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const envA = db.prepare('SELECT * FROM environments WHERE project_id = ? AND name = ?').get(p.id, String(req.query.a));
    const envB = db.prepare('SELECT * FROM environments WHERE project_id = ? AND name = ?').get(p.id, String(req.query.b));
    if (!envA || !envB) return res.status(400).json({ error: 'unknown environment' });
    const a = new Map(currentSecrets(envA.id).map((s) => [s.key, decryptSecret(masterKey, s)]));
    const b = new Map(currentSecrets(envB.id).map((s) => [s.key, decryptSecret(masterKey, s)]));
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
    res.json(keys.map((key) => ({
      key,
      status: !a.has(key) ? 'only_b' : !b.has(key) ? 'only_a' : a.get(key) === b.get(key) ? 'same' : 'different'
    })));
  });

  // ── API tokens ─────────────────────────────────────────────────────────────
  app.get('/api/projects/:id/tokens', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT id, name, scope, created_at, last_used_at FROM tokens WHERE project_id = ?').all(req.params.id));
  });

  app.post('/api/projects/:id/tokens', requireAuth, (req, res) => {
    const p = getProject.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const name = String(b.name || '').trim() || 'token';
    const scope = b.scope === 'readwrite' ? 'readwrite' : 'read';
    const token = genApiToken();
    db.prepare('INSERT INTO tokens (project_id, name, scope, hashed_token, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, name, scope, hashToken(token), Date.now());
    audit('admin', 'token.create', p.id, null, name);
    // token is shown exactly once; only its hash is stored
    res.status(201).json({ token, name, scope });
  });

  app.delete('/api/tokens/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM tokens WHERE id = ?').run(row.id);
    audit('admin', 'token.revoke', row.project_id, null, row.name);
    res.json({ ok: true });
  });

  // ── audit ──────────────────────────────────────────────────────────────────
  app.get('/api/audit', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
    const rows = db.prepare(`
      SELECT a.*, p.name AS project_name, e.name AS env_name
      FROM audit_log a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN environments e ON e.id = a.environment_id
      ORDER BY a.at DESC LIMIT ?
    `).all(limit);
    res.json(rows);
  });

  // ── CLI / machine API (bearer tokens) ──────────────────────────────────────
  function resolveEnvForToken(req, res, tokenRow) {
    const project = getProject.get(tokenRow.project_id);
    const envName = String(req.query.env || req.body?.env || '').trim();
    const env = db.prepare('SELECT * FROM environments WHERE project_id = ? AND name = ?').get(project.id, envName);
    if (!env) { res.status(404).json({ error: `unknown environment '${envName}'` }); return null; }
    return { project, env };
  }

  app.get('/v1/pull', (req, res) => {
    const tok = tokenAuth(req, res, 'read');
    if (!tok) return;
    const ctx = resolveEnvForToken(req, res, tok);
    if (!ctx) return;
    const secrets = {};
    for (const s of currentSecrets(ctx.env.id)) secrets[s.key] = decryptSecret(masterKey, s);
    audit(`token:${tok.name}`, 'secrets.pull', ctx.project.id, ctx.env.id);
    if (req.query.format === 'dotenv') {
      res.type('text/plain').send(
        Object.entries(secrets).map(([k, v]) => `${k}=${/[\s"'#]/.test(v) ? JSON.stringify(v) : v}`).join('\n') + '\n'
      );
    } else {
      res.json({ project: ctx.project.name, env: ctx.env.name, secrets });
    }
  });

  app.post('/v1/push', (req, res) => {
    const tok = tokenAuth(req, res, 'readwrite');
    if (!tok) return;
    const ctx = resolveEnvForToken(req, res, tok);
    if (!ctx) return;
    const secrets = (req.body || {}).secrets;
    if (!secrets || typeof secrets !== 'object') return res.status(400).json({ error: 'secrets object required' });
    try {
      for (const [k, v] of Object.entries(secrets)) setSecret(ctx.env.id, k, String(v), `token:${tok.name}`);
      res.json({ ok: true, count: Object.keys(secrets).length });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── static frontend ────────────────────────────────────────────────────────
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/v1')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp };
