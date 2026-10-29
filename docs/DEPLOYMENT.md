# Deployment

The game runs on Render at **https://pump-casino.onrender.com**. Everything is declared in
[`render.yaml`](../render.yaml), a Render Blueprint:

| Resource        | What                                            | Plan | Region   |
| --------------- | ----------------------------------------------- | ---- | -------- |
| `pump-casino`   | Docker web service built from `Dockerfile`      | Free | Virginia |
| `pump-postgres` | PostgreSQL 18 (the same major version as local) | Free | Virginia |

The web service runs the API and serves the built web app on the same origin. The database
accepts no external connections (`ipAllowList: []`). The app reaches it over Render's private
network with the internal URL, which only works within the same region. Both plans are set to
`free` explicitly, because Render picks paid plans when `plan` is omitted.

Railway was the original target, but it wasn't available for a new account, so the owner
moved the deployment to Render. `railway.json` is gone and nothing else depended on Railway.

## Configuration

| Variable            | Value                                  | Why                                                                    |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`          | `production`                           | `Secure` cookies and `upgrade-insecure-requests` in the CSP            |
| `PORT`              | `10000`                                | Render's default port. The server binds `0.0.0.0` (Render has no IPv6) |
| `DATABASE_URL`      | from the database (`connectionString`) | The internal, private-network URL                                      |
| `TRUST_PROXY`       | `loopback,uniquelocal,cloudflare`      | Rate limits see the real visitor (below)                               |
| `WEB_DIST_DIR`      | set in the `Dockerfile`                | The built web app                                                      |
| `RENDER_GIT_COMMIT` | set by Render                          | Reported as `version` by `/api/health`                                 |

The pool size (10), log level and rate limits keep their defaults. The configuration is
validated at startup, and the process refuses to start with bad settings.

## Migrations without a pre-deploy step

Render's pre-deploy command needs a paid instance, so the image runs the migrations itself:

```dockerfile
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/server.js"]
```

- **Safe to repeat.** Applied migrations are skipped, so a restart, or a free instance waking
  up, applies nothing.
- **Safe to overlap.** A PostgreSQL advisory lock serialises two instances starting at once.
- **Patient, but not blind.** On a fresh deploy the database may not accept connections yet,
  so connecting is retried for up to two minutes. A wrong password or a missing database fails
  at once instead.
- **Clean shutdown.** `exec` makes Node PID 1, so Render's SIGTERM reaches the graceful
  shutdown, which drains requests and then closes the pool.
- **Backward compatible.** Render deploys without downtime: the new instance migrates while
  the old one still serves traffic. A migration must therefore work with the previous code: add
  first, and rename or drop in a later deploy.

`apps/api/test/migrations.test.ts` tests repeating, overlapping and waiting. The local
production image showed SIGTERM reaching Node ("shutting down" in its log). The first Render
deploy logged `Migrations applied.` against the empty database.

## Client addresses, rate limits and proxies

A request travels from the browser to Cloudflare, then to Render's load balancer, then to a
Render proxy inside the instance, and finally to the app. Where the visitor's address ends up
isn't documented, so it was measured on the live service on 2026-10-29. Marked requests, some
with forged `X-Forwarded-For`, `X-Real-IP` or `True-Client-IP` headers, were sent, and the
address the app logged for each was read back. The comparison with this machine's own address
was made by hash, to keep it out of the logs and docs.

| `TRUST_PROXY`                           | Address the app saw                                       | Effect                                     |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `uniquelocal` (first deploy)            | `127.0.0.1` for every request                             | Every visitor shared one rate-limit bucket |
| `loopback,uniquelocal`                  | A Cloudflare edge in `172.64.0.0/13`, varying per request | Limits counted per edge, not per visitor   |
| `loopback,uniquelocal,cloudflare` (now) | The visitor's own address                                 | Correct                                    |

With all three settings, forged headers had no effect. The app reads only `X-Forwarded-For`;
`X-Real-IP` and `True-Client-IP` are ignored entirely. `X-Forwarded-For` is read from the
right, and only past trusted proxies, so the entries a client adds sit to the left of its real
address and are never reached. That held even for a forged chain with a fake Cloudflare hop
and for a forged `127.0.0.1`. Cloudflare itself rejects requests that set `CF-Connecting-IP`.
The live rate-limit counter confirms it: plain and forged requests from one machine counted
down one bucket (599, 598, … 593).

`cloudflare` expands to Cloudflare's published ranges (`apps/api/src/config.ts`), as checked on
2026-10-29 against both https://www.cloudflare.com/ips-v4 / ips-v6 and Cloudflare's IP API.
`apps/api/test/lifecycle.test.ts` replays the measured chain. If Cloudflare adds a range,
requests through it are counted per edge until the list is updated: stricter, never
spoofable. `true` stays refused.

One gap remains. A request sent from a Cloudflare Worker arrives from Cloudflare's own address
space, so entries to its left would be trusted. Such a client could choose its own rate-limit
key. The limits here are a brake on abuse, not a security boundary: every money and fairness
rule is enforced by the database, whoever the client claims to be.

Rate limits (600 requests a minute and 60 new players an hour per address) live in memory. A
free instance restarts when it wakes up, which resets them. That's acceptable for a play-money
demo; scaling out would need a shared store.

## Sessions and cookies

The session cookie is `pump_session=…; HttpOnly; Secure; SameSite=Strict; Path=/api`. It is
host-only, so it is scoped to `pump-casino.onrender.com`. Render terminates TLS and redirects
plain HTTP to HTTPS with a 301. The app adds HSTS and a strict CSP. The app is same-origin, so
there's no CORS. The production smoke test checks every one of these on the live service.

## Database connections

- **Private network only.** Internal connections stay on Render's private network. Render
  offers internal TLS only with self-signed certificates, so the private network is the
  protection. External connections are refused.
- **Pool.** At most 10 connections (the free database allows 100), a 5 s connect timeout and
  a 30 s idle timeout. An idle connection dropped by a database restart is logged, not fatal.
- **Health.** `/api/health` pings the database and is Render's health check, so an instance
  that loses its database is reported unhealthy (503).

## Free-plan limits

- **Sleep.** The web service sleeps after 15 minutes without traffic. The next visit then
  takes about a minute while it wakes (Render shows a loading page). Free use is capped at
  750 instance hours a month per workspace.
- **Database expiry.** **The free database expires on 2026-11-28**, 30 days after creation.
  Render deletes it after a further 14-day grace period unless it is upgraded. It also has
  1 GB of storage and no backups.
- **Upgrading** is a dashboard change and the owner's decision: the database to a paid
  instance (from about $6 a month), and the web service to Starter (about $7 a month, no
  sleep). Nothing here requires it. See `SETUP_REQUIRED.md`.

## Deploying changes

The Blueprint was created from the public repository URL, without connecting Render to GitHub,
so Render doesn't see pushes. After pushing to `main`, use one of these:

- **Blueprints → `pump-casino` → Manual sync.** This applies changes to `render.yaml`, after an
  approval step, and redeploys.
- **The service's Manual Deploy → Deploy latest commit**, for code-only changes.

If GitHub is connected to Render, `autoDeployTrigger: commit` should deploy every push. The
build filter skips changes that only touch documentation, tools, CI or the end-to-end tests. To restart, use
**Manual Deploy → Restart service**. To roll back, use **Rollback** on an earlier deploy in
**Events**.

## Verifying a deployment

```bash
node tools/smoke-production.mjs https://pump-casino.onrender.com --save session.json
# restart or redeploy the service, then:
node tools/smoke-production.mjs https://pump-casino.onrender.com --resume session.json
cd apps/web && PUMP_BASE_URL=https://pump-casino.onrender.com \
  pnpm exec playwright test -c playwright.production.config.ts
```

The API smoke test plays real rounds and checks the wallet, bets, pumps, retries, a
double-clicked cash-out, history, restore, independent verification, headers, cookie flags
and leaks. The browser smoke test plays the same journeys in desktop Chromium, on a Pixel 7
and on an iPhone, with taps on the phones.

Results on 2026-10-29 for the deployed commit `78a29ef`:

| Check                                                    | Result                                                 |
| -------------------------------------------------------- | ------------------------------------------------------ |
| API smoke test                                           | 30/30 (also 30/30 on the first deploy)                 |
| Open round across a redeploy (`9002f49` → `de82f37`)     | 12/12: same balance and round, cashed out, verified    |
| Open round across **Manual Deploy → Restart service**    | 12/12: same balance and round, cashed out, verified    |
| Browser smoke test: desktop Chromium, Pixel 7, iPhone 14 | 12/12; each device's first journey has a clean console |
| Proxy probes                                             | Visitor's own address; forged headers ignored          |

After the final audit, `fb8802f` was deployed with Manual Deploy on 2026-10-29. CI had passed
first. Before the deploy, a session was saved on `78a29ef` with a round left open.

| Check (final audit deploy, `fb8802f`)                          | Result                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/api/health` version after the deploy                         | `fb8802f`, the GitHub head at the time                                                                    |
| Upgrade with an open round (`78a29ef` → `fb8802f`, `--resume`) | 13/13: same session, balance and round; cashed out for the amount shown; both earlier rounds still verify |
| API smoke test                                                 | 30/30                                                                                                     |
| Browser smoke test: desktop Chromium, Pixel 7, iPhone 14       | 12/12                                                                                                     |
| The audit's fixes on the live site                             | Bet fully visible at 1280×720; Enter on the focused Bet button bets; each bet uses a fresh client seed    |

Commit `0ac7724` (documentation only) was deployed the same way at 14:31. `/api/health`
reported `0ac7724`, and the API smoke test passed 30/30. Later commits change documentation only
and were not redeployed, so the running code is the same.
