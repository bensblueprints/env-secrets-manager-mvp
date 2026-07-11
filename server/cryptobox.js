// Secretbox envelope encryption — Node built-in crypto only.
//
//   MASTER_KEY (32 bytes, hex, from .env on the host — NEVER stored in the DB)
//     └─ wraps a random per-secret DEK (AES-256-GCM)
//          └─ DEK encrypts the secret value (AES-256-GCM)
//
// Rotating the master key only requires re-wrapping DEKs, not re-encrypting
// every value. Plaintext values exist only transiently in process memory and
// are never logged.
const crypto = require('crypto');

function parseMasterKey(hex) {
  const clean = String(hex || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('MASTER_KEY must be 64 hex characters (32 bytes). Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(clean, 'hex');
}

function gcmEncrypt(key, plaintextBuf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintextBuf), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('hex'), ct: ct.toString('base64') };
}

function gcmDecrypt(key, ivHex, ctB64) {
  const buf = Buffer.from(ctB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
}

function encryptSecret(masterKey, plaintextValue) {
  const dek = crypto.randomBytes(32);
  const value = gcmEncrypt(dek, Buffer.from(String(plaintextValue), 'utf8'));
  const wrapped = gcmEncrypt(masterKey, dek);
  dek.fill(0);
  return {
    ciphertext: value.ct,
    iv: value.iv,
    wrapped_dek: JSON.stringify(wrapped)
  };
}

function decryptSecret(masterKey, row) {
  const wrapped = JSON.parse(row.wrapped_dek);
  const dek = gcmDecrypt(masterKey, wrapped.iv, wrapped.ct);
  try {
    return gcmDecrypt(dek, row.iv, row.ciphertext).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function genApiToken() {
  return 'sbx_' + crypto.randomBytes(24).toString('hex');
}

module.exports = { parseMasterKey, encryptSecret, decryptSecret, hashToken, genApiToken };
