require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5345;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'secretbox.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Master key: prefer .env. For first local runs, generate one into data/master.key
// (chmod 600) so `npm start` works out of the box — production should set MASTER_KEY.
let masterKeyHex = process.env.MASTER_KEY;
if (!masterKeyHex) {
  const keyFile = path.join(path.dirname(DB_PATH), 'master.key');
  if (fs.existsSync(keyFile)) {
    masterKeyHex = fs.readFileSync(keyFile, 'utf8').trim();
  } else {
    masterKeyHex = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, masterKeyHex, { mode: 0o600 });
    console.log(`⚠ No MASTER_KEY in .env — generated one at ${keyFile}. Back it up! Without it your secrets are unrecoverable.`);
  }
}

const app = createApp({ dbPath: DB_PATH, adminPassword: ADMIN_PASSWORD, masterKeyHex });

app.listen(PORT, () => {
  console.log(`Secretbox listening on http://localhost:${PORT}`);
  if (ADMIN_PASSWORD === 'admin') {
    console.log('⚠ Using default admin password — set ADMIN_PASSWORD in .env for production.');
  }
});
