# Database

PostgreSQL is the single source of truth for balances and round state; the API holds no
authoritative state in memory. The schema is in `apps/api/src/db/schema.ts` (Drizzle). Versioned
SQL migrations live in `apps/api/drizzle/` and are applied by `apps/api/src/migrate.ts`, which
holds a session advisory lock so concurrent deploys cannot race.

## Tables

| Table                 | Purpose                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `players`             | One anonymous player per session: SHA-256 of the session token, balance in cents, next nonce                    |
| `seed_commitments`    | Server seeds prepared before betting. The id is the future round id; status `PREPARED → CONSUMED \| REVOKED`    |
| `rounds`              | Bet, client seed, status, settlement reason, pump count, **server-only pop point**, version, payout, timestamps |
| `wallet_transactions` | Append-only ledger: `INITIAL_GRANT`, `BET_DEBIT`, `PAYOUT_CREDIT`, each with the resulting balance              |
| `action_requests`     | Stored outcome of each mutating request, keyed by (player, Idempotency-Key), with a request hash                |

Money columns are `BIGINT` cents. Timestamps are `timestamptz`.

## Invariants enforced by the database

The service layer maintains all of these, and the database enforces them again, so a bug in
the service cannot break them. `apps/api/test/schema-constraints.test.ts` proves each one with
raw SQL. They are not a defence against someone with owner rights on the database: that role can
disable triggers or truncate tables (see "Limits of the database checks" below).

| Invariant                                                               | Enforced by                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Balance never negative                                                  | `CHECK (balance_cents >= 0)`                                                                                                                   |
| At most one active round per player                                     | partial unique index `rounds_one_active_per_player`                                                                                            |
| At most one prepared commitment per player                              | partial unique index                                                                                                                           |
| One debit and at most one credit per round                              | unique index on `(round_id, entry_type)`                                                                                                       |
| One starting grant per player                                           | partial unique index                                                                                                                           |
| Debits negative, credits and grants positive, round link where required | `CHECK wallet_entry_shape`                                                                                                                     |
| Ledger rows never edited or deleted                                     | `BEFORE UPDATE OR DELETE` row trigger (migration 0001); `TRUNCATE` is not covered                                                              |
| A round's fields match its status                                       | `CHECK rounds_*_shape` (e.g. `POPPED` ⇒ `pop_point = pump_count + 1`, `payout = 0`; `CASHED_OUT` ⇒ payout > 0, ≥ 1 pump, before the pop point) |
| Seeds are 32 bytes and commitments 64 hex characters                    | `CHECK` constraints                                                                                                                            |
| Each nonce used once per player                                         | unique `(player_id, nonce)`                                                                                                                    |

### Limits of the database checks

The independent review found two gaps, both confirmed on a scratch database:

- **The balance is not tied to the ledger by the database.** No constraint says the balance
  equals the sum of ledger entries, or that each entry's `balance_after_cents` continues the
  previous one. The single write path keeps them in step: `postLedgerEntry` writes the entry and
  the new balance in the same transaction, and nothing else writes either. The integration tests
  (`assertLedgerReconciles`, including under a burst of concurrent actions) and the production
  smoke test (wallet equals history to the cent) check it. A raw `UPDATE players SET balance_cents`
  would not be refused.
- **`TRUNCATE` bypasses the append-only trigger**, which is row-level. The test harness relies on
  this to reset its database.

Hardening for a real deployment would add an `AFTER INSERT` ledger trigger that maintains the
balance (or a deferred check of it), a statement-level `BEFORE TRUNCATE` trigger, and an
application role that can only `INSERT` into the ledger and doesn't own the tables.

## Transactions and lock order

Every mutation (start, pump, cash out, rotate) runs in **one** `READ COMMITTED` transaction,
which takes row locks in a fixed order:

1. `players` row (`SELECT … FOR UPDATE`). This serialises all of one player's mutations.
2. The round row (`FOR UPDATE`, always filtered by player id).
3. The prepared commitment row (`FOR UPDATE`).

Every code path follows the same order, so deadlocks cannot occur. Different players never
contend.

Inside the transaction (`runPlayerAction` in `apps/api/src/services/idempotency.ts`):

1. Lock the player.
2. **Idempotency:** look up `(player, Idempotency-Key)`. If the key is known with the same
   request hash, return the stored response. If the hash differs, return 422.
3. **Expiry housekeeping:** forfeit the player's active round if it is 24 h old. This persists
   whatever happens next.
4. Run the action **inside a savepoint.** If it throws a domain error (stale version, cash-out
   before a pump, …), the savepoint rolls back anything the action wrote, the error response is
   built with the authoritative state, and it is stored like a success.
5. Store the outcome in `action_requests` and commit.

**The single write path.** `persistTransition` applies the engine's transition with
`UPDATE rounds … WHERE id = $1 AND version = $2 AND status = 'ACTIVE'` and increments `version`.
Every settlement (manual cash-out, auto target, ladder top) credits the payout there and nowhere
else, through `postLedgerEntry`.

**Balance changes.** `postLedgerEntry` is the only code that changes a balance:
`UPDATE players SET balance = balance + Δ WHERE … AND balance + Δ >= 0 RETURNING balance`,
followed by the matching ledger row with `balance_after_cents`. The balance therefore always
equals the sum of the player's ledger, and the tests check that the running sum equals each
`balance_after_cents` too.

**Reads.** `GET /api/pump/current` reads wallet, round and next commitment in one
`REPEATABLE READ` read-only transaction, so the three always come from the same moment even
while another tab is acting.

## How each race is prevented

| Race                                         | First line                                                     | Backstops                                       |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Two bets at once / bet more than the balance | Player lock; balance checked under the lock; conditional debit | `CHECK balance >= 0`; one-active-round index    |
| Double-clicked Cash Out                      | Player lock; status check; version guard                       | Unique `(round_id, PAYOUT_CREDIT)`              |
| Pump and Cash Out together                   | Player lock + `expectedVersion`: the second sees a new version | Version-guarded `UPDATE`                        |
| Two pumps on one version                     | Same                                                           | Same                                            |
| Retry after a lost response                  | Stored outcome replayed for the same key                       | Primary key `(player_id, idempotency_key)`      |
| Expiry racing an action                      | Expiry runs under the same player lock as every action         | `rounds_expired_shape`, status-guarded `UPDATE` |
| Multiple tabs                                | Same as above (one player, one lock)                           | —                                               |

Mutation tests prove these layers matter. With every row lock and the version guard removed,
6 of the 12 concurrency tests fail. With only the player lock removed, the concurrent-bet and
parallel-retry tests fail while the round lock still protects pump/cash-out. In every mutant
the ledger's unique indexes still blocked double payment.

## Abandoned rounds

A round left `ACTIVE` for 24 hours (`expires_at`, set from the versioned rules at start) is
forfeited the next time the player loads the game state, history or a verification, places a bet, or pumps or cashes out. `GET /api/wallet` alone does not resolve it, and the balance is the same either way, because the bet was debited when the round started. The
transition is the engine's `EXPIRE`, applied under the player lock and written through
`persistTransition`. No refund entry is written, and the seed is revealed in history. There is
no background sweeper because nothing observable depends on one: another player can never see
your rounds, and your own next request resolves the expiry first.

## Operations

- **Migrations:** `node apps/api/dist/migrate.js` runs at every container start, before the
  server, because Render's free instances have no pre-deploy step. Applied migrations are
  skipped, an advisory lock serialises instances starting at once, and connecting is retried
  while a fresh database starts up (`apps/api/test/migrations.test.ts`). The test suite also
  rebuilds its database from an empty schema on every run, which proves the migrations apply
  cleanly from zero.
- **Connection pool:** `pg.Pool` (default 10, `DATABASE_POOL_MAX`), 5 s connect timeout. Idle
  connection errors are logged rather than crashing the process.
- **Restart safety:** nothing lives only in memory, so a restart loses no round, wallet or
  idempotency record (tested by rebuilding the app on the same database mid-round). Rate-limit
  counters are in memory and reset on restart.
- **Backups:** the live database is on Render's free plan, which has no backups and expires on
  2026-11-28 (`SETUP_REQUIRED.md`). Paid plans add backups; restore by pointing `DATABASE_URL`
  at the restored instance. The ledger is append-only, so a balance can always be audited from
  it.
- **Retention:** `action_requests` grows with every mutation. A scheduled delete of rows older
  than a few days would be safe, since clients only retry for seconds, but it isn't needed at
  this scale.
