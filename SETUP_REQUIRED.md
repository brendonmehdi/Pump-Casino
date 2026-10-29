# Setup required from the repository owner

Everything that can be done without your accounts is being done. These items need you.

## 1. Railway login (blocks the live URL) — REQUIRED

The Railway CLI (v5.71.0) is installed, but `railway whoami` returns `Unauthorized`.
Deployment config, migrations and health checks are prepared in the repo; only authentication is missing.

Steps (about 2 minutes):

1. In this Claude Code session, run: `! railway login`
   (opens a browser; sign in with the account that should own the project).
2. Tell Claude "Railway is logged in". Claude will then:
   - `railway init` a project named `pump-casino`,
   - add a PostgreSQL database (`railway add --database postgres`),
   - link the GitHub repo `brendonmehdi/Pump-Casino` for deploys from `main`,
   - set `DATABASE_URL` as a reference to the private Postgres URL, plus `NODE_ENV=production`
     and `COOKIE_SECURE=true`,
   - generate a public domain and run the production smoke tests.

Railway's free trial/hobby usage may require a payment method on file depending on your account.
Claude will not add billing details or upgrade plans; if Railway asks for that, you decide.

## 2. Higgsfield generation (optional — not needed for a complete submission)

- Account: Plus plan, 88.37 credits available (checked read-only on 2026-10-29).
- Finding: Higgsfield "Playable"/website output runs on Higgsfield's own Cloudflare Worker runtime
  (React + TanStack Start SSR, platform-owned rooms and persistence). It cannot host this
  project's server-authoritative Fastify + PostgreSQL wallet, so it is not used for the app.
- All visuals and sounds are original hand-written SVG/CSS and synthesized Web Audio, so no
  credits are needed. If you would like generated background art anyway, reply with approval
  and a credit budget; nothing will be generated without it.
