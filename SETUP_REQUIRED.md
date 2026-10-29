# Setup required from the repository owner

Everything that can be done without your accounts is done. One item blocks the live URL.

## 1. Railway deployment (blocks the live URL) — required

**Status:** the Railway CLI (v5.71.0) is installed, but `railway whoami` returns `Unauthorized`.
Everything else is ready and tested: the `Dockerfile`, `railway.json` (pre-deploy migrations,
health check, restart policy), environment validation, and a production image exercised
locally against PostgreSQL (migrations, health, cookie flags, restart persistence).

### Option A: let Claude finish it (about 5 minutes of your time)

1. In this Claude Code session, run `! railway login` and sign in with the account that should
   own the project.
2. Tell Claude "Railway is logged in". It will then:
   - create the project (`railway init --name pump-casino`);
   - add PostgreSQL (`railway add --database postgres`);
   - create the app service from the GitHub repo `brendonmehdi/Pump-Casino` (branch `main`);
   - set the variables below;
   - generate a public domain (`railway domain`);
   - verify the live URL (new player, bet, cash out, refresh restore, restart persistence, no
     secret leakage), then put the URL in the README and commit.

### Option B: do it in the Railway dashboard

1. **New project → Deploy from GitHub repo →** `brendonmehdi/Pump-Casino`. Railway finds
   `railway.json` and builds the `Dockerfile`.
2. **Add → Database → PostgreSQL** in the same project.
3. On the app service, set these **Variables**:

   | Name           | Value                                                  |
   | -------------- | ------------------------------------------------------ |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (the private-network URL) |
   | `NODE_ENV`     | `production`                                           |
   | `TRUST_PROXY`  | `true`                                                 |

   `PORT` comes from Railway. `COOKIE_SECURE` defaults to `true` in production.

4. **Settings → Networking → Generate domain.** The pre-deploy step runs the migrations and the
   health check waits for `/api/health`.
5. Send Claude the URL, or paste it into the README's "Live demo" line.

Railway may ask for a payment method depending on your plan. Claude will not add billing
details or change plans; that is your call.

## 2. Higgsfield generation (optional; not needed)

- Account: Plus plan, 88.37 credits (checked read-only on 2026-10-29). No credits were spent.
- Its game/website builder runs on Higgsfield's own platform and can't host this project's
  server-authoritative API and PostgreSQL wallet, so it isn't used (`docs/ASSETS.md`).
- All visuals and sounds are original SVG/CSS and synthesised Web Audio. If you'd like
  generated background art anyway, give approval and a credit budget; nothing will be
  generated without it.
