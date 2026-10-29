# Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│ apps/web  React + Vite                                          │
│   GameProvider ── one action in flight, replaces state with     │
│   │               the server's GameState; never predicts        │
│   ├─ Stage / Balloon / ActionBar / PressureLadder / History     │
│   ├─ VerifyPage ── engine.verifyRound() runs here, offline      │
│   └─ api/client ── validates every response with contracts,     │
│                    retries a mutation with the same key         │
└──────────────┬──────────────────────────────────────────────────┘
               │ same origin, JSON, HttpOnly session cookie
┌──────────────▼──────────────────────────────────────────────────┐
│ apps/api  Fastify                                               │
│   http/     security headers, CSRF/origin guard, rate limits,  │
│             input + OUTPUT validation (contracts), error map    │
│   services/ runPlayerAction: lock → idempotency → expiry →      │
│             savepoint(action) → store outcome                   │
│             rounds.ts: start / pump / cash out / rotate         │
│             ledger.ts: the only balance mutation                │
│   db/       Drizzle schema + versioned SQL migrations           │
└──────┬───────────────────────────────────────┬──────────────────┘
       │ calls (pure functions)                │ SQL, one transaction per action
┌──────▼──────────────────────┐   ┌────────────▼─────────────────┐
│ packages/engine             │   │ PostgreSQL                   │
│   rules.ts   v1 rules+ladder│   │   players, seed_commitments, │
│   ratio.ts   exact BigInt   │   │   rounds, wallet_transactions│
│   fairness.ts HMAC draws    │   │   (append-only), action_     │
│   PumpEngine.ts state machine│  │   requests; constraints as a │
│   verify.ts  replay verifier│   │   second line of defence     │
└─────────────────────────────┘   └──────────────────────────────┘
packages/contracts: Zod request/response schemas shared by api and web
tools/verify-round.mjs: dependency-free verifier written from the spec
```

## Responsibilities

| Layer                | Owns                                                                     | Must never                                                   |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `packages/engine`    | Rules, exact math, pop-point derivation, state transitions, verification | Touch a database, the network, the clock or an unseeded RNG  |
| `packages/contracts` | Wire formats, validation, error codes                                    | Contain game logic                                           |
| `apps/api` services  | Transactions, locks, idempotency, ledger, expiry, seed custody           | Decide an outcome itself; everything goes through the engine |
| `apps/api` http      | Sessions, security, request/response validation                          | Contain business rules                                       |
| `apps/web`           | Presentation, input, retries, animation of confirmed results             | Decide or predict an outcome; hold authoritative state       |

## The engine (`packages/engine/src/PumpEngine.ts`)

The engine is pure and deterministic. `createRound(rules, { bet, autoCashout, fairness })`
validates the bet and derives the pop point from the seed material. `applyAction(rules, round,
{ type: 'PUMP' | 'CASH_OUT' | 'EXPIRE' })` returns the next state and an event, or a typed
error. States (`ACTIVE`, `POPPED`, `CASHED_OUT`, `EXPIRED`) and actions are discriminated
unions; invalid transitions are errors, never exceptions. `viewRound` derives only public
numbers, so the pop point cannot reach a client through it. Same inputs, same outputs: the
property tests replay arbitrary action sequences and the verifier depends on it.

The web app imports the same engine for the ladder preview and for in-browser verification, so
the rules exist in one place in code. Two copies are deliberate:

- the standalone verifier (`tools/verify-round.mjs`) re-implements them from the published
  specification, as an independent check that the specification is complete;
- the verify page's "How each pump is drawn" text quotes a few constants for readers.

## Life of a pump

1. The browser sends `POST /api/pump/pump` with `{ roundId, expectedVersion }` and a fresh
   `Idempotency-Key`.
2. The origin guard, session lookup and schema validation pass.
3. `runPlayerAction` opens a transaction, locks the player row and checks the key. If the key
   has been seen, it replays the stored response.
4. It forfeits the round if it is 24 hours old, then runs the action in a savepoint. The action
   locks the round row (scoped to the player), checks status and version, and calls the engine
   `applyAction(PUMP)` → survived / popped / auto cash-out / top of ladder.
5. `persistTransition` writes the new state with a version-guarded `UPDATE`. If the round
   settled, `postLedgerEntry` credits the payout in the same transaction.
6. The response (`GameState`) is stored under the key, committed, then validated against the
   strict contract and sent.
7. The browser replaces its state, animates the change (inflate / pop / float away) and plays
   the matching sound.

## Deployment

One Docker image (`Dockerfile`): Fastify serves the API and the built web app on the same
origin, so cookies are first-party and no CORS is needed. The container runs the (idempotent,
lock-protected) migrations at every start and then the server. Render runs it from
`render.yaml` next to a private PostgreSQL database and health-checks `/api/health`.
Configuration is validated at startup (`apps/api/src/config.ts`); the process refuses to start
with bad settings. Details and live verification: `docs/DEPLOYMENT.md`.
