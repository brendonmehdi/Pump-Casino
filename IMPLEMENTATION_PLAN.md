# PUMP — Implementation Plan

Source of truth: `takehome-C-originals-pump.pdf` (Betstamp take-home). Expanded spec:
`Pump_Casino_Claude_Code_Master_Brief_Complete.md` (sections 1–24). The file
`Pump_Casino_Continuation_Sections_17_to_24.md` duplicates sections 17–24 of the master brief
verbatim, so both are treated as one specification and nothing is implemented twice.

Status legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started · `[!]` blocked (see `SETUP_REQUIRED.md`)

Session start: 2026-10-29 00:06 EDT.

---

## 0. Reconciled requirements checklist

Each item names where it is satisfied once done. "PDF" = original assignment, "MB §n" = master brief section.

### Game rules (PDF, MB §4)

- [ ] R1 Bet starts a round with an empty balloon; min $0.10, max $1,000, $0.01 increments
- [ ] R2 Pump raises multiplier and pop chance; Cash Out pays bet × current multiplier; pop loses bet
- [ ] R3 Round ends on pop, cash out, or top of ladder (25 pumps or 1,000×, whichever first); top auto-cashes out
- [ ] R4 New player gets $10,000, created on first visit, stored in DB
- [ ] R5 RTP 97% at every cash-out point; rounding may push under, never over
- [ ] R6 Pop curve designed and explained in README
- [ ] R7 Cash Out before the first pump is rejected with a clear error (MB §5, §20)

### Engine (PDF, MB §6)

- [ ] E1 `packages/engine/src/PumpEngine.ts` pure: no DB/HTTP, randomness in → outcome out, deterministic
- [ ] E2 Discriminated unions for states/actions; invalid transitions rejected; no `any`

### Endpoints (PDF, MB §9)

- [ ] A1 `POST /api/pump/start`, `POST /api/pump/pump`, `POST /api/pump/cashout`, `GET /api/wallet`, `GET /api/history`
- [ ] A2 Restore in-progress round after refresh: `GET /api/pump/current`
- [ ] A3 `GET /api/rounds/:id/verify`, `GET /api/health`, `POST /api/session`, `POST /api/fairness/rotate`

### Frontend (PDF, MB §10)

- [ ] F1 Balloon visibly inflates; pop animation
- [ ] F2 Current multiplier + payout if cashed out now; chance next pump pops
- [ ] F3 Running balance; last 10 rounds
- [ ] F4 Loading / empty / error / reconnecting / disabled states; never fabricate results

### Key concepts (PDF)

- [ ] K1 Math proof: exact RTP at all 25 points + 100k-round seeded simulation; integer cents; rounding direction explained
- [ ] K2 Atomic bet+balance check; one active round; Pump vs Cash Out race; double Cash Out pays once; abandon rule defended
- [ ] K3 Pop point decided at start from server seed; SHA-256 commitment before first pump; seed revealed at end; nothing leaks in Network tab
- [ ] K4 Engine / service / HTTP separation; typed interfaces; no `any`
- [ ] K5 Feel: rising tension, sharp wins, quiet losses, fast balance updates

### Above & Beyond — all mandatory per MB §1, §13

- [ ] B1 Auto Cash Out at target multiplier, settled server-side inside the Pump transaction
- [ ] B2 Auto-bet: wager, rounds, target, stop-on-profit, stop-on-loss, stop-on-insufficient, pause, stop
- [ ] B3 Keyboard: Space pump, Enter cash out, Escape cancel/close; ignored in inputs; no key-repeat
- [ ] B4 Sound (pump, cash out, pop, top) with mute + volume; mobile layout
- [ ] B5 Verify page: recompute any past round from its revealed seed, independently of server verdict
- [ ] B6 Signature feature: 25-step Pressure Ladder

### Deliverables (PDF, MB §17)

- [ ] D1 Public GitHub repo with incremental history (no squash)
- [ ] D2 Live URL (Railway + persistent Postgres)
- [ ] D3 README: run locally, architecture, pop curve + why, tradeoffs, more-time list, honest hours
- [ ] D4 AI_USAGE.md with one real, observed AI mistake
- [ ] D5 docs/MATH, FAIRNESS, DATABASE, ARCHITECTURE, API, UX_RESEARCH, QA, ASSETS

---

## 1. Key design decisions (decided up front; details in docs/)

| Topic                   | Decision                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hazard curve            | `popBasisPoints(n) = 800 + 125·(n−1)`, n = 1..25 (8% → 38%). Verified with exact BigInt arithmetic before adoption: all multipliers < 1,000× (top = 794.0195×), so the 25-pump cap binds first. |
| Multiplier              | Exact rational `0.97 / S(n)`, `S(n) = Π(1 − p_i)`. Never stored as float.                                                                                                                       |
| Payout                  | `floor(betCents × 0.97 / S(n))` with BigInt. Floor guarantees E[payout] ≤ 97% for every bet and every step. Display multiplier floored to 2 dp so the UI never promises more than is paid.      |
| Pre-first-pump cash out | Rejected (`CASHOUT_REQUIRES_PUMP`). A 1.00× refund at step 0 would be 100% RTP.                                                                                                                 |
| Money                   | Integer cents: BIGINT in Postgres, `bigint` in TS, decimal strings in JSON.                                                                                                                     |
| RNG                     | `HMAC-SHA256(serverSeed, "pump:v1                                                                                                                                                               | roundId | nonce | clientSeed | i   | c")`, first 4 bytes big-endian, rejection sampling to 0..9999. `@noble/hashes` so the same code runs in Node and the browser verifier. |
| Grinding defence        | Round ID and nonce are allocated **with** the commitment, before the client seed is chosen, so the server cannot re-roll a server-chosen input after seeing the client seed.                    |
| Identity                | Anonymous session: 32-byte random token in an HttpOnly, SameSite=Strict cookie; only SHA-256(token) stored.                                                                                     |
| Concurrency             | One transaction per mutation; lock order player → round; optimistic `version` required on pump/cashout; idempotency keys stored per player; DB constraints as second line of defence.           |
| Abandoned rounds        | Expire after 24 h; wager forfeited; seed revealed; resolved lazily under the same locks.                                                                                                        |
| Stack                   | pnpm workspaces · TypeScript strict · Fastify 5 · Zod · Drizzle + PostgreSQL · React + Vite + Tailwind + Motion + TanStack Query · Vitest + fast-check · Playwright · Railway.                  |

---

## 2. Tasks (dependency-ordered)

### Phase 0 — Audit and workspace

- [x] **T0.1 Read all documents, audit environment.** Node 24.22, pnpm 11.13, gh authenticated (repo+workflow), Docker 29.9 running, target repo empty+public, Railway CLI absent.
- [x] **T0.2 Workspace scaffold.** git init → `main`, remote, `.gitignore`, local-only exclusion of brief/PDF, pnpm workspace, strict tsconfig base, ESLint flat config, Prettier, Vitest, root scripts, `.nvmrc`, `.editorconfig`.
  - Accept: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` pass; first commit pushed to `main`.
- [x] **T0.3 External access audit.** Railway CLI install + login status; Higgsfield capability/balance (read-only); REA reachability of public Stake pages. Blockers → `SETUP_REQUIRED.md`.

### Phase 1 — Engine (highest priority)

- [x] **T1.1 Versioned rules** `rules.ts`: `PUMP_RULES_V1` (RTP 97/100, 10,000 bp scale, hazard schedule, 25 pumps, 1,000× cap, bet limits, 24 h expiry) + `buildRuleSet` validation.
  - Accept: validation rejects bad schedules (non-increasing, ≥100%, multiplier > cap).
- [x] **T1.2 Exact math** `ratio.ts` + ladder in `rules.ts`: survival, multiplier, payout (floor), display formatting, auto-target comparison — BigInt only.
  - Accept: `S(n)·M(n) = 97/100` exactly for n = 1..25; payout ≤ exact for all inputs.
- [x] **T1.3 Fairness** `fairness.ts` + `verify.ts`: commitment, message encoding, rejection sampler, pop-point derivation, replay-based verification report; independent `tools/verify-round.mjs`.
  - Accept: published test vectors reproduce; rejection branch exercised; cross-checked against an independent `node:crypto` implementation.
- [x] **T1.4 PumpEngine.ts** state machine: `createRound`, `applyAction` (PUMP / CASH_OUT / EXPIRE), `viewRound`; discriminated unions; `EngineResult` errors.
  - Accept: all transitions + invalid transitions tested; no mutation of inputs.
- [x] **T1.5 Proof + simulation tests**: exact RTP at 25 points; exhaustive check of every permitted bet (10..100,000 ¢) × 25 steps; fast-check properties; 100k seeded rounds (per-step RTP within statistical bounds, empirical hazard per pump); termination; ≤1,000×; determinism.
- [ ] **T1.6 docs/MATH.md + docs/FAIRNESS.md** (curve, proof, rounding table incl. $0.10 distortion, protocol, test vectors, guarantees and limitations).

### Phase 2 — Contracts

- [x] **T2.1 `packages/contracts`**: Zod schemas for every request/response, error codes, strict money/bet/client-seed/target parsing (rejects NaN, ∞, negatives, >2 dp, whitespace, oversize, overflow).
  - Accept: unit tests for every malformed-input class.

### Phase 3 — Persistence

- [ ] **T3.1 Local Postgres**: `docker-compose.yml` (dev + test DBs), `.env.example`, Zod env validation.
- [ ] **T3.2 Schema + migrations** (Drizzle): `players`, `seed_commitments`, `rounds`, `wallet_transactions`, `action_requests`; CHECKs, FKs, partial unique indexes (one ACTIVE round/player, one PREPARED commitment/player, one debit + ≤1 credit/round, one grant/player).
  - Accept: migrations apply cleanly from zero; constraint tests prove each guard independently of app code.
- [ ] **T3.3 Services**: session, fairness (prepare/consume/rotate/reveal), game (start/pump/cashout/current/expire, one shared `settle`), wallet ledger, idempotency, history.
- [ ] **T3.4 PostgreSQL integration tests**: concurrent bets cannot overspend; one active round; double cash-out pays once; pump vs cash-out race; same-version double pump; idempotent replay of committed-but-lost responses; conflicting payload on reused key; expiry (injected clock) cannot be revived or race; ledger reconciles with balances; restart persistence; fresh vs returning player; session isolation.

### Phase 4 — HTTP API

- [ ] **T4.1 Fastify app**: env, cookies, security headers, Origin/Sec-Fetch-Site checks, JSON-only bodies, body limit, rate limits, structured Pino logs with redaction, typed error handler (no stack traces).
- [ ] **T4.2 Routes**: all endpoints in A1–A3; responses validated against contracts.
- [ ] **T4.3 HTTP tests**: status codes, idempotency header semantics, no secret leakage while active (scan every response), cross-session access denied, CSRF/origin rejection.
- [ ] **T4.4 docs/API.md + docs/DATABASE.md**.

### Phase 5 — Minimal vertical slice

- [ ] **T5.1 Web scaffold**: Vite + React + strict TS + Tailwind + TanStack Query; typed API client with idempotency keys and retry of the same key on network failure.
- [ ] **T5.2 Simple game screen** wired to the real API: bet, pump, cash out, balance, multiplier, payout, next risk, last 10, refresh restore.
- [ ] **T5.3 Single-origin production serving** (Fastify serves `apps/web/dist`).
- [ ] **T5.4 Playwright smoke**: new player → start → pump → cash out / pop → refresh restore.

### Phase 6 — Above & Beyond

- [ ] **T6.1 Auto Cash Out** UI (server logic from T3.3) + E2E.
- [ ] **T6.2 Auto-bet** pure controller + hook + UI; bounded (max rounds), never overlaps; all stop conditions; unit + E2E.
- [ ] **T6.3 Keyboard** Space/Enter/Escape; ignores inputs/dialogs and key repeat; E2E.
- [ ] **T6.4 Sound** Web Audio synthesis (no copied assets), mute/volume persisted, unlocked on first gesture.
- [ ] **T6.5 Verify page** `/verify/:roundId` + manual entry; recomputes in-browser with the engine; shows commitment check, per-pump samples, payout.
- [ ] **T6.6 Pressure Ladder** (signature): 25 rungs, completed/current/next, upcoming multipliers and payouts, remaining steps, tension colouring; no hidden data.
- [ ] **T6.7 Fairness panel**: next commitment, editable client seed, rotate commitment with invalidation notice.

### Phase 7 — Polish

- [ ] **T7.1 UX research** with REA on public Stake pages → `docs/UX_RESEARCH.md` (observed vs assumed).
- [ ] **T7.2 Higgsfield evaluation** (capabilities, exportability, cost) → `docs/ASSETS.md`; no paid generation without approval.
- [ ] **T7.3 Visual design**: original SVG balloon, tension (colour/stretch/wobble), pop + win effects, responsive desktop/mobile/landscape, safe areas, reduced motion, a11y labels, focus styles.

### Phase 8 — QA

- [ ] **T8.1 E2E matrix**: desktop Chromium, mobile Chromium (Pixel), mobile WebKit (iPhone); network-leak test; reconnect/error.
- [ ] **T8.2 CI** GitHub Actions (lint, typecheck, format, unit, Postgres integration, build, E2E) green on `main`.
- [ ] **T8.3 Security + code review**: headers, cookies, CSRF, rate limits, log redaction, secrets audit, dead code, duplication, unused deps.

### Phase 9 — Release

- [ ] **T9.1 Deployment config**: Dockerfile, `railway.json`, migrate-on-deploy, health check.
- [ ] **T9.2 Railway deploy + production smoke** (expected blocker: Railway login).
- [ ] **T9.3 Docs**: README, AI_USAGE.md, docs/ARCHITECTURE.md, docs/QA.md, honest hours.
- [ ] **T9.4 Final audit** against this checklist, push, handoff report.
