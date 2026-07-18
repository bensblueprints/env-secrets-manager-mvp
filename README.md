# 📦 Secretbox

## Demo



https://github.com/user-attachments/assets/b0a8fdc0-5b87-4db5-88c4-b9095cf8cc36



**Self-hosted team secrets & env-var manager. Envelope-encrypted at rest, a CLI that pipes straight into `.env`, full audit log. Pay once — no per-seat Doppler bill.**

![MIT](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

Doppler charges $12/user/month to store key-value pairs. For a 5-person team that's $720/year, forever. Secretbox does projects → environments → encrypted secrets, versions with rollback, environment diffs, scoped API tokens, and a zero-dependency CLI — on your own box, for $39 once.

![screenshot](docs/screenshot.png)

## Features

- 🔐 **Envelope encryption at rest** — every value gets its own random AES-256-GCM data key, which is wrapped with a master key that lives **only in your `.env`** (never in the database).
- 🗂 **Projects → dev / staging / prod** (plus custom environments), secret versioning with one-click rollback.
- 👀 **Audit-logged reveals** — every reveal, pull, edit, and rollback is recorded with who/what/when.
- 🔀 **Environment diff** — see which keys are missing or different between dev and prod without exposing values.
- 🎫 **Scoped API tokens** — per-project, read-only or read-write, shown once, stored hashed.
- ⌨️ **CLI**: `secretbox pull --env prod > .env` · `secretbox run --env dev -- npm start` (injects env, writes nothing to disk) · `secretbox push --env dev KEY=value`.
- 🖥 **Desktop mode or VPS** — run it as an Electron app, or `docker compose up -d` on a $5 VPS.

## Quick start

```bash
npm i
npm run build
cp .env.example .env   # set ADMIN_PASSWORD + MASTER_KEY
npm start              # → http://localhost:5345
```

Generate a master key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **back it up**; without it your secrets are unrecoverable. (For quick local runs Secretbox generates one into `data/master.key` automatically.)

**Run it as a desktop app, or deploy to a $5 VPS when you need it public:**

```bash
npm run desktop
# or
docker compose up -d
```

## CLI

```bash
export SECRETBOX_URL=https://secrets.your.host
export SECRETBOX_TOKEN=sbx_...

npx secretbox pull --env prod > .env
npx secretbox run --env dev -- npm start
npx secretbox push --env dev STRIPE_KEY=sk_live_x   # readwrite token
```

## Secretbox vs Doppler

| | Secretbox | Doppler Team |
|---|---|---|
| Price | **$39 once** | $12/user/**month** |
| 5-person team, 3 years | **$39** | ~$2,160 |
| Encrypted at rest | ✅ envelope AES-256-GCM | ✅ |
| Your secrets on your server | ✅ | ❌ their cloud |
| Versioning + rollback | ✅ | ✅ |
| Env diff | ✅ | ✅ |
| CLI pull / run injection | ✅ | ✅ |
| Audit log | ✅ | higher tiers |
| Works offline / air-gapped | ✅ | ❌ |

## Security model (honest version)

- Values are envelope-encrypted: per-secret DEK (AES-256-GCM) wrapped by the `MASTER_KEY` from your host environment. The DB alone is useless.
- This is **server-side** encryption — the server can decrypt (that's what lets the CLI pull plaintext into your deploys). If you need zero-knowledge client-side crypto, that's our Vaultly product; a secrets manager that feeds CI must hold the key.
- API tokens are stored as SHA-256 hashes; shown exactly once.
- Protect the box, protect the `.env`. Run behind HTTPS (reverse proxy) in production.

## Tech stack

Node 20+ · Express · better-sqlite3 · React + Vite + Tailwind + Framer Motion + Lucide · Node `crypto` (AES-256-GCM envelope) · zero-dependency CLI · Electron desktop wrapper.

## ☕ Skip the setup — get the 1-click installer

Grab the packaged version: **[https://whop.com/benjisaiempire/secretbox](https://whop.com/benjisaiempire/secretbox)** — pay once, own it forever, no subscription.

## License

MIT © 2026 Ben (bensblueprints)

## macOS build

See [MAC-BUILD.md](MAC-BUILD.md). Quickest path: GitHub **Actions** tab -> run the **Mac Build** (`mac-build.yml`) workflow to get a downloadable `.dmg` (unsigned - right-click -> Open on first launch).
