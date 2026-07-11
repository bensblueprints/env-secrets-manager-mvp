# Launch strategy — Secretbox

## Target communities

- **r/selfhosted** — core audience. Post: "Built a self-hosted Doppler alternative — envelope encryption, CLI, audit log, MIT." Include architecture detail; the sub rewards substance and open source.
- **r/devops** — angle: secrets sprawl + per-seat pricing pain. Frame as a discussion of secrets management patterns (rule: no low-effort self-promo; lead with the envelope-encryption writeup).
- **r/docker** — the two-minute `docker compose up` deploy angle; show the compose file in the post.
- **r/ExperiencedDevs / r/webdev** — comment-level participation in ".env management" threads (they recur weekly).
- **Hacker News** — see Show HN below.

## Show HN draft

**Title:** Show HN: Secretbox – self-hosted team secrets manager with envelope encryption ($39 once)

**Body:**
Doppler-style workflow (projects → environments → secrets, CLI that pulls into .env or injects into a process env) but self-hosted and pay-once.

Crypto design: each secret value is encrypted with its own random AES-256-GCM data key; the DEK is wrapped by a master key that exists only in the host's .env — the database alone is useless. Rotation = re-wrap DEKs, not re-encrypt values. Deliberately server-side encryption, because a secrets manager that feeds CI must be able to decrypt; the honest trade-off is documented in the README.

Also: secret versioning with rollback, env diffs that never expose values, read-only vs read-write API tokens (stored hashed, shown once), audit log of every reveal/pull, zero-dependency Node CLI.

Node/Express/SQLite/React, MIT licensed. Would love feedback on the threat model section especially.

## SEO keywords (10)

1. doppler alternative self hosted
2. self hosted secrets manager
3. env variable manager team
4. secrets manager open source
5. self hosted secret store
6. .env manager for teams
7. environment variables encrypted storage
8. vault alternative simple
9. secrets manager one time price
10. dotenv secrets sync self hosted

## AppSumo / PitchGround pitch

Secretbox replaces $12-per-seat-per-month secrets managers (Doppler, Infisical Cloud) with a one-time purchase your buyers host themselves. Teams get the full modern workflow — projects and environments, envelope-encrypted values, version history with rollback, environment diffs, scoped CI tokens, and a CLI that pulls secrets straight into .env or injects them into any process — while their production keys never leave their own infrastructure. It deploys with one docker-compose command and doubles as a desktop app. Developer teams already resent renting this exact workflow; a lifetime deal is an instant yes because the seat-math is brutal: five developers on Doppler cost $720 every single year.

## Pricing math

**$39 one-time.** Doppler Team is $12/user/mo → a 5-person team pays $60/month. **Secretbox pays for itself in 20 days** for that team; even a solo dev on a $12/mo plan breaks even in just over 3 months. Three-year cost for 5 seats: Secretbox $39 vs ~$2,160.
