# QA record

All numbers below are from runs in this repository. The same suites run in GitHub Actions on
every push to `main` (see `.github/workflows/ci.yml`).

## Test inventory

| Suite                   | Where                       | Tests | What it proves                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                  | `packages/engine/test`      |   105 | Exact 97% at all 25 points; exhaustive floor + RTP check of 2.5M (bet, pump) cases; fairness vectors from an independent HMAC; rejection sampling; state machine; fast-check properties; 100k-round simulation; independent verifier agrees on 300 random rounds and refuses malformed input |
| Contracts               | `packages/contracts/test`   |    73 | Every malformed input class is rejected (NaN, ∞, negatives, >2 dp, whitespace, separators, overflow, unknown fields); output schemas refuse a leaked seed or pop point                                                                                                                       |
| API on PostgreSQL       | `apps/api/test`             |    68 | Database constraints; gameplay; concurrency races; idempotency; session isolation; CSRF; no secret leakage; 24 h expiry (including racing a cash-out); restart persistence; verification; rotation; rate limits (forged X-Forwarded-For ignored); config refusals; secret-free error logs    |
| Web unit                | `apps/web/src/**/*.test.ts` |     5 | Auto-bet stop rules (profit, loss limit before the bet, balance, round count)                                                                                                                                                                                                                |
| End to end (Playwright) | `apps/web/e2e`              |    41 | Production build + real API + PostgreSQL on desktop Chromium, Pixel 7 (Chromium) and iPhone 14 (WebKit); axe-core WCAG 2.1 A/AA scans of the game, verify and history screens                                                                                                                |

That is **251 unit/integration tests and 41 end-to-end tests**.

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
| Engine                                                  | 105 / 105 passed                                                                     |
| Contracts                                               | 73 / 73 passed                                                                       |
| Web unit                                                | 5 / 5 passed                                                                         |
| API integration                                         | 68 / 68 passed                                                                       |
| E2E                                                     | 41 / 41 passed (no retries)                                                          |
| Production Docker image                                 | built; migrations, health, SPA, cookie flags and restart persistence checked by hand |

## Do the tests have teeth? (mutation checks)

| Deliberate bug                              | Result                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Round payouts half-up instead of flooring   | Exhaustive test fails on 1,249,612 cases (e.g. $0.10 at pump 1 → 101.2% RTP)     |
| Remove the player row lock                  | Concurrent-bet and parallel-retry tests fail                                     |
| Remove every row lock and the version guard | 6 of 12 concurrency tests fail; ledger unique indexes still block double payment |

Each mutation was reverted immediately and the suites re-run green.

## Bugs the tests caught during development

| Bug                                                                                                                      | Caught by                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Zod v4 runs `.refine()` after a failed `.regex()`, so `BigInt("10.00")` threw: a 500 instead of a 400                    | Contract test "rejects bet with decimals" |
| `createRateLimit()`'s `isAllowed: false` misread as "over the limit"; every new player got a 429                         | First manual smoke test (curl)            |
| Helmet's CSP `upgrade-insecure-requests` made WebKit load `http://localhost` assets over https                           | WebKit E2E project                        |
| A missing `AudioContext` threw inside the Bet click handler, so no bet was ever sent in WebKit                           | WebKit E2E project                        |
| Pressure Ladder overflowed the desktop viewport instead of scrolling                                                     | Screenshot review                         |
| "2×" button's accessible name lacked its visible text (WCAG 2.5.3); the ladder could not be scrolled by keyboard (2.1.1) | axe-core scan in E2E                      |
| A keyboard E2E test typed a space into the client-seed field (the app behaved correctly)                                 | E2E failure analysis                      |

## Independent review

After the features were done, a separate agent reviewed the whole codebase adversarially
(read-only) and reported findings with failure scenarios. It found no path to double payment,
wrong payouts, a negative balance or a secret leaking to a client. Everything it did find was
fixed, with a test where one applies:

| Finding                                                                                                | Fix                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Stopping auto-bet mid-round left an open round with no Pump/Cash out controls, so it could only expire | Manual controls appear for any open round when auto-bet isn't running; E2E test added                       |
| `TRUST_PROXY=true` trusts a forged `X-Forwarded-For`, so rate limits could be dodged                   | Only explicit proxy addresses are accepted, `true` is refused; test proves spoofed entries share one bucket |
| Drizzle errors embed bound parameters, so a failed insert could log a seed or pop point                | 5xx errors are logged through `loggableError` (kind and Postgres code only); unit test                      |
| History cursor above 2³¹−1 caused a database error (500)                                               | Cursor bounded in the contract; API test                                                                    |
| `GET /pump/current` read wallet, round and commitment in separate statements (possible torn snapshot)  | One REPEATABLE READ, read-only transaction                                                                  |
| A 5xx after commit, or a slow stale refetch, could leave the UI showing old state                      | Resync on uncertain errors; in-flight fetches cancelled before applying an action's result                  |
| Pasting verify JSON with `pumpCount` > 25 crashed the page                                             | Bounded in the contract, guarded in the page, plus an app-wide error boundary                               |
| The Node verifier accepted inputs the spec forbids (active rounds, out-of-range bets)                  | It now enforces the spec's encoding and ranges; 7 tests                                                     |
| `ALLOWED_ORIGINS` could never take effect                                                              | Removed; the app is same-origin by design                                                                   |
| `MATH.md` miscounted rounds reaching pump 25                                                           | Corrected                                                                                                   |

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
