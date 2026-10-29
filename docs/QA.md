# QA record

All numbers below are from runs in this repository. The same suites run in GitHub Actions on
every push to `main` (see `.github/workflows/ci.yml`).

## Test inventory

| Suite                   | Where                       | Tests | What it proves                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                  | `packages/engine/test`      |    98 | Exact 97% at all 25 points; exhaustive floor + RTP check of 2.5M (bet, pump) cases; fairness vectors from an independent HMAC; rejection sampling; state machine; fast-check properties; 100k-round simulation; independent verifier agrees on 300 random rounds |
| Contracts               | `packages/contracts/test`   |    73 | Every malformed input class is rejected (NaN, ∞, negatives, >2 dp, whitespace, separators, overflow, unknown fields); output schemas refuse a leaked seed or pop point                                                                                           |
| API on PostgreSQL       | `apps/api/test`             |    60 | Database constraints; gameplay; concurrency races; idempotency; session isolation; CSRF; no secret leakage; 24 h expiry (including racing a cash-out); restart persistence; verification; rotation; rate limits                                                  |
| Web unit                | `apps/web/src/**/*.test.ts` |     5 | Auto-bet stop rules (profit, loss limit before the bet, balance, round count)                                                                                                                                                                                    |
| End to end (Playwright) | `apps/web/e2e`              |    38 | Production build + real API + PostgreSQL on desktop Chromium, Pixel 7 (Chromium) and iPhone 14 (WebKit)                                                                                                                                                          |

That is **236 unit/integration tests and 38 end-to-end tests**.

## Commands

```bash
pnpm db:up                 # PostgreSQL in Docker (dev + test databases)
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test                  # engine, contracts, web unit, API integration
pnpm build && pnpm test:e2e
```

## Results of the final local run (2026-10-29)

| Check                                                   | Result                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Prettier                                                | all files formatted                                                                  |
| ESLint (strict, type-aware, React hooks/compiler rules) | 0 problems                                                                           |
| TypeScript (4 packages, strict)                         | 0 errors                                                                             |
| Engine                                                  | 98 / 98 passed                                                                       |
| Contracts                                               | 73 / 73 passed                                                                       |
| Web unit                                                | 5 / 5 passed                                                                         |
| API integration                                         | 60 / 60 passed                                                                       |
| E2E                                                     | 38 / 38 passed (twice in a row, no retries)                                          |
| Production Docker image                                 | built; migrations, health, SPA, cookie flags and restart persistence checked by hand |

## Do the tests have teeth? (mutation checks)

| Deliberate bug                              | Result                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Round payouts half-up instead of flooring   | Exhaustive test fails on 1,249,612 cases (e.g. $0.10 at pump 1 → 101.2% RTP)     |
| Remove the player row lock                  | Concurrent-bet and parallel-retry tests fail                                     |
| Remove every row lock and the version guard | 6 of 12 concurrency tests fail; ledger unique indexes still block double payment |

Each mutation was reverted immediately and the suites re-run green.

## Bugs the tests caught during development

| Bug                                                                                                   | Caught by                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Zod v4 runs `.refine()` after a failed `.regex()`, so `BigInt("10.00")` threw: a 500 instead of a 400 | Contract test "rejects bet with decimals" |
| `createRateLimit()`'s `isAllowed: false` misread as "over the limit"; every new player got a 429      | First manual smoke test (curl)            |
| Helmet's CSP `upgrade-insecure-requests` made WebKit load `http://localhost` assets over https        | WebKit E2E project                        |
| A missing `AudioContext` threw inside the Bet click handler, so no bet was ever sent in WebKit        | WebKit E2E project                        |
| Pressure Ladder overflowed the desktop viewport instead of scrolling                                  | Screenshot review                         |
| A keyboard E2E test typed a space into the client-seed field (the app behaved correctly)              | E2E failure analysis                      |

## Network check: nothing leaks early

`apps/web/e2e/fairness.spec.ts` records every `/api/` response a real browser receives while
playing three pumps, then reloads mid-round. It asserts that none contains the round's server
seed (read from the database by the test oracle) or a pop point, and that the seed does appear
once the round has popped. `apps/api/test/security.test.ts` checks the same at the HTTP level,
and the contract schema refuses to serialise an active round with a seed.

## Known limitations

- **Not yet deployed.** Railway needs the owner's login (`SETUP_REQUIRED.md`). The production
  image has been built and exercised locally instead.
- **Rate limits are in memory, per instance.** That's fine for one instance; several would
  need a shared store.
- **`action_requests` is never pruned.** That's harmless at this scale; a periodic delete of
  old rows would be the fix.
- **Seeds are stored in the database until revealed** (see `docs/FAIRNESS.md`).
- **Sound depends on Web Audio.** Playwright's WebKit build on Windows has none; the game then
  runs silently and the settings menu says so.
- **Visual review used Playwright screenshots.** The Chrome extension could not capture its
  window during this session.
