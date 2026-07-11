// Desktop mode: boots the same Express server on a free local port,
// stores data + master key in Electron's userData dir, auto-logs-in as admin.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let win;

app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'master.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  const autologinToken = crypto.randomBytes(24).toString('hex');

  const { createApp } = require(path.join(__dirname, '..', 'server', 'app.js'));
  const server = createApp({
    dbPath: path.join(dataDir, 'secretbox.db'),
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    masterKeyHex: fs.readFileSync(keyFile, 'utf8').trim(),
    autologinToken
  });

  const listener = server.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    win = new BrowserWindow({
      width: 1320,
      height: 880,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      title: 'Secretbox',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadURL(`http://127.0.0.1:${port}/auth/auto?token=${autologinToken}`);
  });

  app.on('window-all-closed', () => {
    listener.close();
    app.quit();
  });
});
