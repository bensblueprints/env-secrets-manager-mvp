// Secretbox smoke test — boots the real server and exercises:
// auth → project/envs → set secret → CIPHERTEXT AT REST (raw DB scan) →
// reveal round-trip → versioning + rollback → env diff → API tokens
// (read vs readwrite scope) → /v1/pull dotenv → real CLI `pull` subprocess →
// audit rows. Kills ONLY the spawned children.
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 5395;
const ADMIN_PASSWORD = 'smoke-admin-pw';
const MASTER_KEY = crypto.randomBytes(32).toString('hex');
const DB_PATH = path.join(__dirname, 'smoke.db');
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const SECRET_VALUE = 'sk_live_SMOKE-PLAINTEXT-MARKER-77e1';

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);

let serverProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  console.log('1. Booting Secretbox on port', TEST_PORT);
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT), ADMIN_PASSWORD, DB_PATH, MASTER_KEY },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));
  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('2. Auth gates');
  assert.strictEqual((await api('/api/projects')).status, 401, 'projects must require auth');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } })).status, 200);

  console.log('3. Project + default environments');
  const p = await api('/api/projects', { method: 'POST', body: { name: 'acme-api' } });
  assert.strictEqual(p.status, 201);
  const projects = (await api('/api/projects')).data;
  const proj = projects.find((x) => x.name === 'acme-api');
  assert.deepStrictEqual(proj.environments.map((e) => e.name), ['dev', 'staging', 'prod'], 'default envs created');
  const dev = proj.environments.find((e) => e.name === 'dev');
  const prod = proj.environments.find((e) => e.name === 'prod');

  console.log('4. Set secret → CIPHERTEXT AT REST');
  assert.strictEqual((await api(`/api/environments/${dev.id}/secrets`, { method: 'POST', body: { key: 'bad key!', value: 'x' } })).status, 400, 'invalid key rejected');
  const set1 = await api(`/api/environments/${dev.id}/secrets`, { method: 'POST', body: { key: 'STRIPE_KEY', value: SECRET_VALUE } });
  assert.strictEqual(set1.status, 201);

  const Database = require('better-sqlite3');
  const rodb = new Database(DB_PATH, { readonly: true });
  const row = rodb.prepare("SELECT * FROM secrets WHERE key = 'STRIPE_KEY' AND is_current = 1").get();
  assert.ok(row, 'secret row exists');
  assert.ok(!row.ciphertext.includes(SECRET_VALUE), 'ciphertext column must not contain plaintext');
  assert.ok(row.wrapped_dek && !row.wrapped_dek.includes(SECRET_VALUE), 'wrapped DEK must not contain plaintext');
  for (const f of [DB_PATH, DB_PATH + '-wal']) {
    if (!fs.existsSync(f)) continue;
    const raw = fs.readFileSync(f);
    assert.ok(!raw.includes(SECRET_VALUE), `raw ${path.basename(f)} must NOT contain the secret value`);
    assert.ok(!raw.includes(MASTER_KEY), `raw ${path.basename(f)} must NOT contain the master key`);
  }
  console.log('   ✓ secret value and MASTER_KEY absent from raw SQLite bytes');

  console.log('5. Reveal round-trip + versioning + rollback');
  const rev = await api(`/api/environments/${dev.id}/secrets/STRIPE_KEY/reveal`);
  assert.strictEqual(rev.data.value, SECRET_VALUE, 'reveal decrypts the exact value');
  await api(`/api/environments/${dev.id}/secrets`, { method: 'POST', body: { key: 'STRIPE_KEY', value: 'v2-value' } });
  const rev2 = await api(`/api/environments/${dev.id}/secrets/STRIPE_KEY/reveal`);
  assert.strictEqual(rev2.data.value, 'v2-value');
  assert.strictEqual(rev2.data.version, 2, 'edit bumps version');
  const hist = (await api(`/api/environments/${dev.id}/secrets/STRIPE_KEY/history`)).data;
  assert.strictEqual(hist.length, 2, 'history keeps both versions');
  await api(`/api/environments/${dev.id}/secrets/STRIPE_KEY/rollback`, { method: 'POST', body: { version: 1 } });
  const rev3 = await api(`/api/environments/${dev.id}/secrets/STRIPE_KEY/reveal`);
  assert.strictEqual(rev3.data.value, SECRET_VALUE, 'rollback restores v1 value');
  assert.strictEqual(rev3.data.version, 3, 'rollback creates a new head version');

  console.log('6. Env diff');
  await api(`/api/environments/${dev.id}/secrets`, { method: 'POST', body: { key: 'ONLY_DEV', value: 'x' } });
  await api(`/api/environments/${prod.id}/secrets`, { method: 'POST', body: { key: 'STRIPE_KEY', value: 'prod-different' } });
  const diff = (await api(`/api/projects/${proj.id}/diff?a=dev&b=prod`)).data;
  assert.strictEqual(diff.find((d) => d.key === 'STRIPE_KEY').status, 'different');
  assert.strictEqual(diff.find((d) => d.key === 'ONLY_DEV').status, 'only_a');

  console.log('7. API tokens: read vs readwrite scope, /v1/pull dotenv');
  const tokRead = (await api(`/api/projects/${proj.id}/tokens`, { method: 'POST', body: { name: 'ci-read', scope: 'read' } })).data;
  const tokRw = (await api(`/api/projects/${proj.id}/tokens`, { method: 'POST', body: { name: 'ci-rw', scope: 'readwrite' } })).data;
  assert.ok(tokRead.token.startsWith('sbx_'), 'token issued');
  const rodb2 = new Database(DB_PATH, { readonly: true });
  const tokenRows = rodb2.prepare('SELECT hashed_token FROM tokens').all();
  assert.ok(tokenRows.every((t) => t.hashed_token !== tokRead.token && t.hashed_token !== tokRw.token), 'raw tokens are never stored');
  rodb2.close();

  const noAuth = await fetch(`${BASE}/v1/pull?env=dev`);
  assert.strictEqual(noAuth.status, 401, 'pull without token 401');
  const badTok = await fetch(`${BASE}/v1/pull?env=dev`, { headers: { Authorization: 'Bearer sbx_wrong' } });
  assert.strictEqual(badTok.status, 401, 'bad token 401');
  const pull = await fetch(`${BASE}/v1/pull?env=dev&format=dotenv`, { headers: { Authorization: `Bearer ${tokRead.token}` } });
  assert.strictEqual(pull.status, 200);
  const dotenvText = await pull.text();
  assert.ok(dotenvText.includes(`STRIPE_KEY=${SECRET_VALUE}`), 'dotenv output contains decrypted value');

  const pushDenied = await fetch(`${BASE}/v1/push?env=dev`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokRead.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secrets: { HACK: 'x' } })
  });
  assert.strictEqual(pushDenied.status, 403, 'read-only token cannot push');
  const pushOk = await fetch(`${BASE}/v1/push?env=dev`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokRw.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secrets: { FROM_CI: 'pushed-value' } })
  });
  assert.strictEqual(pushOk.status, 200, 'readwrite token can push');

  console.log('8. Real CLI subprocess: secretbox pull');
  const cliOut = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['cli/secretbox.js', 'pull', '--url', BASE, '--token', tokRead.token, '--env', 'dev'],
      { cwd: ROOT }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
  assert.ok(cliOut.includes(`STRIPE_KEY=${SECRET_VALUE}`), 'CLI pull prints dotenv with decrypted secret');
  assert.ok(cliOut.includes('FROM_CI=pushed-value'), 'CLI pull includes CI-pushed secret');

  console.log('9. Audit trail');
  const audit = (await api('/api/audit')).data;
  for (const action of ['secret.set', 'secret.reveal', 'secret.rollback', 'secrets.pull', 'token.create']) {
    assert.ok(audit.some((a) => a.action === action), `audit must contain ${action}`);
  }
  assert.ok(audit.some((a) => a.actor === 'token:ci-read' && a.action === 'secrets.pull'), 'pull audit names the token');

  rodb.close();
  console.log('\n✅ All Secretbox smoke tests passed');
}

async function cleanup(code) {
  if (serverProc && !serverProc.killed) serverProc.kill();
  await sleep(300);
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* windows lock */ }
  }
  process.exit(code);
}

main()
  .then(() => cleanup(0))
  .catch(async (err) => {
    console.error('\n❌ Smoke test failed:', err.message);
    await cleanup(1);
  });
