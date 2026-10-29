# Progress log

Resumption file: read this, then `IMPLEMENTATION_PLAN.md`, then `SETUP_REQUIRED.md`.

## Current state

- **Phase:** 3 + 4 complete (database, services, HTTP API, 60 integration tests). CI added.
- **Exact next task:** T5.1 — scaffold `apps/web` (Vite + React + Tailwind + TanStack Query),
  typed API client with idempotency keys, then the minimal playable screen (T5.2).
- **Docs still owed from finished phases:** T1.6 (MATH.md, FAIRNESS.md), T4.4 (API.md, DATABASE.md).
- **Last recorded commit:** see `git log -1` (this file is committed alongside the work it describes).

## Environment facts

- Windows 11, Node 24.22.0, pnpm 11.13.1, git 2.53, gh authenticated as `brendonmehdi`.
- Docker Desktop 29.9.2 (started manually during the session; engine at `npipe:////./pipe/docker_engine`).
- A native PostgreSQL 18 service also runs on port 5434 (credentials unknown, not used); the
  project uses its own Docker Postgres instead.
- TypeScript pinned to `~6.0.3` because typescript-eslint 8.72 supports `<6.1` (TS 7 is `latest`).
- `core.autocrlf=true` globally → `.gitattributes` forces LF.
- Private brief files and the assignment PDF are excluded locally via `.git/info/exclude`.

## Verified so far

| Item                                                                                             | Evidence                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Curve 800 + 125(n−1) bp gives exact 97% at all 25 steps; top 794.0195× < 1,000×                  | `packages/engine/test/ladder.test.ts` |
| Exhaustive floor + RTP check for every bet 10..100,000¢ × 25 steps (2.5M cases)                  | same file, ~1.7 s                     |
| Worst cent-rounding case: $0.10 at pump 3 → 89.6682%                                             | same file                             |
| Mutation check: round-half-up instead of floor → 1,249,612 violations (10¢ @ pump 1 → 101.2%)    | manual run, reverted                  |
| Fairness vectors A/B/C generated with `node:crypto`, reproduced by the engine (`@noble/hashes`)  | `fairness.test.ts`                    |
| 100k seeded rounds: per-pump hazard and per-step RTP within 5σ; 2.00× auto strategy via engine   | `simulation.test.ts`                  |
| Independent verifier `tools/verify-round.mjs` agrees with engine on 300 random rounds            | `independent-verifier.test.ts`        |
| Engine suite: 7 files, 98 tests passing, ~8 s                                                    | `pnpm --filter @pump/engine test`     |
| Contracts: strict wire formats; every malformed-input class rejected; 73 tests                   | `pnpm --filter @pump/contracts test`  |
| API: 60 tests on real PostgreSQL (constraints, gameplay, concurrency, security, lifecycle)       | `pnpm --filter @pump/api test`        |
| Concurrency suite has teeth: stripping all row locks + version guard fails 6 of 12 tests         | manual mutation run, reverted         |
| Production bundle (esbuild) serves /api/health and runs migrations from `dist/`                  | manual run                            |
| Full curl flow: session → start → pump ×2 → cash out → history → verify → independent verifier ✓ | manual run                            |

## AI mistakes caught (candidates for AI_USAGE.md — all real, observed in this session)

1. **Zod refinement ordering (contracts).** I wrote `centsSchema.refine(v => BigInt(v) …)`
   assuming the preceding `.regex()` check short-circuits. In Zod v4 refinements still run after
   a failed check, so `"10.00"` made `BigInt()` throw a `SyntaxError` out of `safeParse` — a 500
   instead of a 400. Caught by the "rejects bet with decimals" test; fixed by re-checking the
   pattern inside the refinement.
2. **Misread rate-limit API (api).** I treated `createRateLimit()`'s `isAllowed: false` as
   "over the limit"; it actually means "not on the allow list", and the limit is `isExceeded`.
   Every new player was rejected with 429. Caught by the first manual smoke test (curl), fixed by
   checking `!isAllowed && isExceeded` as the plugin README shows.
3. **Slow exhaustive test.** First version of the 2.5M-case rounding sweep called `expect()` in the
   inner loop and took 25 s; rewritten to collect violations and assert once (1.7 s).

## Architectural decisions (see IMPLEMENTATION_PLAN.md §1)

- Round ID and nonce are allocated with the seed commitment, before the client seed is chosen.
  The brief's message includes a server-chosen round ID; if that ID were picked after the client
  seed, the server could re-roll it to choose outcomes. Pre-allocation removes that freedom.
- Client seed restricted to printable ASCII without space or `|` to avoid normalisation and
  delimiter ambiguity.
- Higgsfield builder evaluated (read-only) and rejected as a runtime; no credits spent.
- REA could not observe Stake (Cloudflare bot check on every page); research is labelled secondhand.

## Known issues / blockers

- Railway login required for deployment (see `SETUP_REQUIRED.md`).

## Time log (wall clock, America/New_York)

- 2026-10-29 00:06 — session start (reading documents, environment audit).
- 2026-10-29 00:36 — engine complete with tests.
- 2026-10-29 00:43 — contracts complete.
- 2026-10-29 01:15 — database, services, HTTP API and integration tests complete.
