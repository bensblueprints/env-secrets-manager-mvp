# Product Hunt — Secretbox

**Name:** Secretbox

**Tagline (60 chars):** Self-hosted team secrets manager. $39 once, not $12/seat/mo

**Description (260 chars):**
Secretbox is a self-hosted secrets/env-var manager: projects → environments → envelope-encrypted secrets with versions, rollback, diffs, scoped tokens and an audit log. CLI pulls straight into .env or injects into any process. Pay once instead of renting Doppler.

**Full description:**
Doppler is a great product with a painful bill: $12/user/month to store key-value pairs. Secretbox is the pay-once version you host yourself:

- Envelope encryption at rest (per-secret AES-256-GCM data keys, master key only in your .env — never in the DB)
- Projects with dev/staging/prod, secret history, one-click rollback
- Diff environments without exposing values
- Per-project API tokens, read-only or read-write, stored hashed
- CLI: `secretbox pull > .env`, `secretbox run -- npm start` (in-memory injection), `secretbox push`
- Every reveal/pull/edit audit-logged
- Docker deploy or desktop app

**Maker first comment:**
Hey PH 👋 I got tired of paying $12/seat/month for what is, architecturally, an encrypted key-value store with a nice CLI. So I built Secretbox: same workflow (projects → envs → secrets → `pull` into .env or inject into a process), envelope encryption where the master key never touches the database, versioning with rollback, and an audit log of every reveal. It's $39 once, MIT source. Honest note on the crypto: this is server-side encryption by design — a secrets manager that feeds your CI has to be able to decrypt. If the box and the .env are both compromised, so are the secrets; same is true of Doppler's servers, except those aren't yours. AMA!

**Gallery shots (5):**
1. Project view — env tabs, masked secrets table with v3 badges, reveal/history buttons.
2. Terminal: `secretbox pull --env prod > .env` and `secretbox run -- npm start`.
3. Diff view — dev vs prod, "missing in prod" rows highlighted red.
4. Token creation — "Copy this token now — it is shown once and stored only as a hash."
5. Math card: "5 devs × $12/mo × 3 years = $2,160. Secretbox: $39."
