#!/usr/bin/env node
// secretbox CLI — pull secrets into .env format or run a command with them injected.
// Zero dependencies. Config via flags or env vars:
//   SECRETBOX_URL, SECRETBOX_TOKEN, SECRETBOX_ENV
//
//   secretbox pull --env prod > .env
//   secretbox run --env dev -- npm start
//   secretbox push --env dev KEY=value KEY2=value2
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = { _: [], passthrough: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args.passthrough = argv.slice(i + 1); break; }
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function fetchSecrets(base, token, env) {
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/pull?env=${encodeURIComponent(env)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.secrets;
}

function toDotenv(secrets) {
  return Object.entries(secrets)
    .map(([k, v]) => `${k}=${/[\s"'#]/.test(v) ? JSON.stringify(v) : v}`)
    .join('\n') + '\n';
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const base = args.url || process.env.SECRETBOX_URL;
  const token = args.token || process.env.SECRETBOX_TOKEN;
  const env = args.env || process.env.SECRETBOX_ENV || 'dev';

  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) {
    console.log(`secretbox — team secrets, self-hosted

  secretbox pull --url http://box:5345 --token sbx_xxx --env prod   # prints .env to stdout
  secretbox run  --env dev -- npm start                             # injects secrets as process env
  secretbox push --env dev KEY=value [KEY2=value2 ...]              # set secrets (readwrite token)

  Flags fall back to SECRETBOX_URL / SECRETBOX_TOKEN / SECRETBOX_ENV env vars.`);
    process.exit(cmd ? 0 : 1);
  }
  if (!base) throw new Error('missing --url (or SECRETBOX_URL)');
  if (!token) throw new Error('missing --token (or SECRETBOX_TOKEN)');

  if (cmd === 'pull') {
    const secrets = await fetchSecrets(base, token, env);
    process.stdout.write(toDotenv(secrets));
  } else if (cmd === 'run') {
    if (!args.passthrough.length) throw new Error('usage: secretbox run --env prod -- <command...>');
    const secrets = await fetchSecrets(base, token, env);
    const child = spawn(args.passthrough[0], args.passthrough.slice(1), {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...secrets }
    });
    child.on('exit', (code) => process.exit(code ?? 1));
  } else if (cmd === 'push') {
    const secrets = {};
    for (const pair of args._) {
      const idx = pair.indexOf('=');
      if (idx < 1) throw new Error(`invalid KEY=value pair: ${pair}`);
      secrets[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    if (!Object.keys(secrets).length) throw new Error('nothing to push — pass KEY=value pairs');
    const res = await fetch(`${base.replace(/\/$/, '')}/v1/push?env=${encodeURIComponent(env)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secrets })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    console.error(`pushed ${data.count} secret(s) to ${env}`);
  } else {
    throw new Error(`unknown command: ${cmd} (try: pull, run, push)`);
  }
}

main().catch((e) => {
  console.error('secretbox:', e.message);
  process.exit(1);
});
