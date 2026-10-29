# Progress log

Resumption file: read this, then `IMPLEMENTATION_PLAN.md`, then `SETUP_REQUIRED.md`.

## Current state

- **Done and verified:** every requirement in `IMPLEMENTATION_PLAN.md` except the live URL.
  That means the engine, contracts, database, API, web client with all bonus features, E2E
  across three browser profiles, CI (green on GitHub), an independent adversarial review with
  all findings fixed, a secrets audit of the full history, the Docker image and Railway config
  (verified locally), and all docs.
- **Blocked:** T9.2 / D2, the Railway deploy. It needs the owner's `railway login`
  (`SETUP_REQUIRED.md`).
- **Exact next task:** once logged in, create the Railway project and PostgreSQL, set the
  variables, deploy, run the production smoke checks against the public URL, put the URL in the
  README, commit and push.

## Environment facts

- Windows 11, Node 24.22.0, pnpm 11.13.1, git 2.53, gh authenticated as `brendonmehdi`.
- Docker Desktop 29.9.2. `docker compose up -d --wait` starts PostgreSQL 18 on
  127.0.0.1:55432 with databases `pump` (dev), `pump_test` (API tests + E2E) and, created by
  hand for the production-image check, `pump_prodcheck`.
- A native PostgreSQL 18 service also runs on port 5434 (unknown credentials, unused).
- TypeScript pinned to `~6.0.3` (typescript-eslint supports `<6.1`; TS 7 is `latest`).
- Playwright browsers (Chromium, WebKit) installed under `%LOCALAPPDATA%\ms-playwright`.
- The Chrome extension cannot capture screenshots of the user's window (timeouts), so visual
  review uses Playwright screenshots (a scratch script, not in the repo).
- `@fastify/static` with `wildcard: false` registers routes at startup: restart any long-running
  server after `pnpm --filter @pump/web build`, or new asset hashes will 404.

## Verified results (latest)

| Check                                          | Result                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Engine / contracts / web unit / API            | 105 / 73 / 5 / 68 tests passing                                                      |
| E2E (desktop Chromium, Pixel 7, iPhone WebKit) | 39 / 39                                                                              |
| Lint, typecheck, format                        | clean                                                                                |
| GitHub Actions (incl. E2E on Linux)            | green on every push to main                                                          |
| Production Docker image                        | migrations, health, SPA, cookie flags, restart persistence checked by hand           |
| Mutation checks                                | rounding mutant: 1,249,612 failures; lock mutants: up to 6/12 concurrency tests fail |

## Architectural decisions (see IMPLEMENTATION_PLAN.md §1 and docs/)

- Round id and nonce are allocated with the seed commitment, before the client seed is chosen
  (closes a re-roll vector in the brief's message format).
- One transaction per action: player lock → idempotency → expiry → savepoint(action) → store.
- Responses are validated against strict contracts server-side (fail closed on leaks).
- Audio is optional and must never block gameplay (WebKit lacked AudioContext).
- CSP `upgrade-insecure-requests` only when served over HTTPS (WebKit + localhost).

## AI mistakes caught (all real, observed in this session)

1. `@fastify/rate-limit` `isAllowed` misread: every new player got a 429 (smoke test). Used as
   the example in `AI_USAGE.md`.
2. Zod v4 refinement ran after a failed regex, so `BigInt("10.00")` threw: a 500 instead of a
   400 (contract test).
3. Helmet CSP `upgrade-insecure-requests` broke WebKit on http localhost (E2E).
4. A missing `AudioContext` aborted the Bet click in WebKit (E2E).
5. The first version of the exhaustive sweep called `expect()` in its inner loop (25 s → 1.7 s).
6. A keyboard E2E test typed into the client-seed field (test bug; the app was right).

## Time log (wall clock, America/New_York, 2026-10-29)

- 00:06 session start (documents, environment audit)
- 00:36 engine and proof tests
- 00:43 contracts
- 01:15 database, services, HTTP API, integration tests
- 01:42 web client, E2E suite, CI with E2E
- 01:50 Docker/Railway config verified locally; docs written
- 02:15 independent review: 11 findings, all fixed and tested; landscape layout fix
- 02:23 final audit; secrets audit of full history clean
