# API

All endpoints live under `/api` on the same origin as the web app. Bodies are JSON
(`Content-Type: application/json`, at most 4 KiB). Every request and response shape is a Zod
schema in `packages/contracts/src/api.ts`. The server validates input with those schemas and
also validates **its own responses** before sending them, so an accidental extra field (such as
a hidden pop point) fails closed as a 500 instead of leaking.

Money is always **integer cents encoded as a decimal string** (`"1000"` = $10.00), so no JSON
number can lose precision.

## Sessions

There is no sign-up. `POST /api/session` creates an anonymous player with $10,000 of play
money and sets an `HttpOnly; SameSite=Strict; Path=/api` cookie (`Secure` in production)
holding a 256-bit random token. Only its SHA-256 is stored. Calling it again with the cookie
returns the same player. Clearing cookies or switching devices creates a new, separate player.
There is no account recovery.

Every other player endpoint requires that cookie, and the player is always taken from it. A
client-supplied player id is never accepted (strict schemas reject unknown fields).

## Mutations, versions and idempotency

`start`, `pump`, `cashout` and `fairness/rotate` are **mutations**:

- **Required header:** `Idempotency-Key`, 16–64 URL-safe characters. Use one fresh key per user
  intent (the web app uses `crypto.randomUUID()`).
- **Retrying:** send the exact same body with the same key. If the original request committed
  (for example, its response was lost on the network), the server replays the stored response
  instead of acting again, with an `Idempotent-Replayed: true` header. Stored errors replay too,
  so a retry cannot turn a refusal into an action.
- **Reusing a key for a different body** returns `422 IDEMPOTENCY_KEY_REUSED`.
- **Versions:** `pump` and `cashout` must carry `expectedVersion`, the round `version` you last
  saw. If the round has changed since (another tab, a double click), you get
  `409 STALE_ROUND_VERSION` with the authoritative state attached, and nothing happens.
- **Concurrency:** all of a player's mutations run in one database transaction that first
  locks the player row, so they apply one at a time. See `docs/DATABASE.md`.

## Endpoints

| Method | Path                     | Body                                                            | Success                           |
| ------ | ------------------------ | --------------------------------------------------------------- | --------------------------------- |
| POST   | `/api/session`           | —                                                               | 201 new / 200 existing            |
| GET    | `/api/pump/current`      | —                                                               | 200 `GameState`                   |
| POST   | `/api/pump/start`        | `{ betCents, clientSeed, commitmentId, autoCashoutMultiplier }` | 201 `GameState`                   |
| POST   | `/api/pump/pump`         | `{ roundId, expectedVersion }`                                  | 200 `GameState`                   |
| POST   | `/api/pump/cashout`      | `{ roundId, expectedVersion }`                                  | 200 `GameState`                   |
| POST   | `/api/fairness/rotate`   | `{ commitmentId }`                                              | 200 `{ revoked, nextCommitment }` |
| GET    | `/api/wallet`            | —                                                               | 200 `{ balanceCents }`            |
| GET    | `/api/history`           | query `limit` (1–50, default 10), `cursor`                      | 200 `{ rounds, nextCursor }`      |
| GET    | `/api/rounds/:id/verify` | —                                                               | 200 `{ round, verification }`     |
| GET    | `/api/health`            | —                                                               | 200 ok / 503 degraded             |

`GET /api/pump/current` is how the client **restores an in-progress round after a refresh**. It
returns the active round (or `null`), the wallet and the next commitment.

### `GameState`

Returned by `current`, `start`, `pump` and `cashout`, and attached as `state` to conflict
errors. The client replaces its state with it wholesale.

```json
{
  "round": {
    "id": "3bb0a4e6-6ecf-47a3-a893-9cd689cdf2de",
    "status": "ACTIVE",
    "settlementReason": null,
    "version": 2,
    "betCents": "1000",
    "pumpCount": 2,
    "maxPumps": 25,
    "multiplier": "1.16",
    "cashoutCents": "1161",
    "nextPopChanceBasisPoints": 1050,
    "nextMultiplier": "1.29",
    "autoCashoutMultiplier": null,
    "payoutCents": null,
    "startedAt": "2026-10-29T04:53:12.008Z",
    "endedAt": null,
    "expiresAt": "2026-10-30T04:53:12.008Z",
    "fairness": {
      "rulesVersion": "pump-v1",
      "commitment": "f0044c8faaddbaa26ce59c32f4962c20cd7e00a57b65c5a36751a4bb0041549d",
      "clientSeed": "smoke-test",
      "nonce": 1,
      "serverSeed": null
    }
  },
  "wallet": { "balanceCents": "999000" },
  "nextCommitment": {
    "id": "56d7df0a-d544-4f5b-ae3c-f0eb19a7a11a",
    "commitment": "bad84f208ae050657f6b495835119a1ef6a96b2ac25a7102593f41cfd411997e",
    "nonce": 2
  }
}
```

- `status` is `ACTIVE`, `POPPED`, `CASHED_OUT` or `EXPIRED`. `settlementReason` is `MANUAL`,
  `AUTO_TARGET` or `LADDER_TOP` for cashed-out rounds, otherwise `null`.
- `multiplier` is the multiplier reached, floored to 2 dp (`null` before the first pump).
  `cashoutCents` is the **exact** amount a cash-out pays right now (`null` unless the round is
  active with at least one pump). It is authoritative; never recompute it from the multiplier.
- `nextPopChanceBasisPoints` is the public chance that the next pump pops (`1050` = 10.50%).
- `fairness.serverSeed` is `null` while the round is active and revealed once it has ended.
  The pop point is never sent; recompute it from the revealed seed.
- After a round ends, the action's response carries the finished round. `current` then returns
  `round: null`, and the finished round appears in `history`.

### `POST /api/pump/start`

```json
{
  "betCents": "1000",
  "clientSeed": "my-seed-123",
  "commitmentId": "56d7df0a-d544-4f5b-ae3c-f0eb19a7a11a",
  "autoCashoutMultiplier": "2.00"
}
```

- `betCents`: integer cents from `"10"` to `"100000"`. No decimals, signs, whitespace or exponents.
- `clientSeed`: 1–64 printable ASCII characters without spaces or `|`.
- `commitmentId`: the `nextCommitment.id` you were shown. Starting consumes it, it becomes the
  round id, and a new `nextCommitment` is prepared.
- `autoCashoutMultiplier`: `"1.01"` to `"1000.00"` (at most 2 dp), or `null` for manual play.
  When a pump reaches it, the server cashes out **inside that pump's transaction**.

The bet is checked against the balance and debited in the same transaction that creates the
round.

### `GET /api/rounds/:id/verify`

For a finished round you played. `verification` is exactly the input format of
`tools/verify-round.mjs`:

```json
{
  "round": { "...": "the finished PublicRound" },
  "verification": {
    "rulesVersion": "pump-v1",
    "commitment": "f0044c8f…",
    "serverSeed": "4f1c…",
    "roundId": "3bb0a4e6-6ecf-47a3-a893-9cd689cdf2de",
    "nonce": 1,
    "clientSeed": "smoke-test",
    "betCents": "1000",
    "autoCashoutHundredths": null,
    "outcome": {
      "status": "CASHED_OUT",
      "pumpCount": 2,
      "settlementReason": "MANUAL",
      "payoutCents": "1161"
    }
  }
}
```

## Errors

```json
{
  "error": {
    "code": "STALE_ROUND_VERSION",
    "message": "The round changed since you last saw it (another tab or a repeated request)",
    "requestId": "7b6ec646-a824-4262-8fb2-4a0cab56265d"
  },
  "state": { "...": "GameState (on conflicts and refused actions)" }
}
```

| Status | Code                     | When                                                                     | Retry?                         |
| -----: | ------------------------ | ------------------------------------------------------------------------ | ------------------------------ |
|    400 | `VALIDATION_ERROR`       | Malformed body, query, id or `Idempotency-Key`                           | No: fix the request            |
|    401 | `SESSION_REQUIRED`       | Missing or unknown session cookie                                        | After `POST /api/session`      |
|    403 | `ORIGIN_REJECTED`        | Cross-site mutation (`Sec-Fetch-Site` / `Origin`)                        | No                             |
|    404 | `NOT_FOUND`              | Unknown route                                                            | No                             |
|    404 | `ROUND_NOT_FOUND`        | No such round **for this session** (other players' rounds look the same) | No                             |
|    409 | `ACTIVE_ROUND_EXISTS`    | Starting while a round is open                                           | Finish the open round          |
|    409 | `STALE_ROUND_VERSION`    | `expectedVersion` is behind                                              | Resync from `state`, act again |
|    409 | `ROUND_NOT_ACTIVE`       | The round already ended (e.g. second click of a double-clicked Cash Out) | No                             |
|    409 | `ROUND_EXPIRED`          | The round passed its 24 h limit and was forfeited                        | No                             |
|    409 | `ROUND_IN_PROGRESS`      | Verifying a round that is still running                                  | After it ends                  |
|    409 | `COMMITMENT_MISMATCH`    | `commitmentId` isn't the current prepared commitment                     | Review the new one, bet again  |
|    413 | `PAYLOAD_TOO_LARGE`      | Body over 4 KiB                                                          | No                             |
|    415 | `UNSUPPORTED_MEDIA_TYPE` | Body that isn't JSON                                                     | No                             |
|    422 | `INSUFFICIENT_BALANCE`   | Bet larger than the balance                                              | No                             |
|    422 | `CASHOUT_REQUIRES_PUMP`  | Cash out before the first pump                                           | After pumping                  |
|    422 | `IDEMPOTENCY_KEY_REUSED` | Same key, different request                                              | Use a new key                  |
|    429 | `RATE_LIMITED`           | Too many requests from this address, or too many new players             | After the stated delay         |
|    500 | `INTERNAL_ERROR`         | Unexpected failure; no stack traces are returned                         | Same key is safe               |
|    503 | (health) `degraded`      | Database unreachable                                                     | Yes                            |

## Walkthrough with curl

```bash
B=http://localhost:3000
curl -s -c jar -b jar -X POST $B/api/session
COMMIT=$(curl -s -b jar $B/api/pump/current | node -pe 'JSON.parse(require("fs").readFileSync(0)).nextCommitment.id')
curl -s -b jar -X POST $B/api/pump/start -H 'content-type: application/json' \
  -H "idempotency-key: $(node -e 'console.log(crypto.randomUUID())')" \
  -d "{\"betCents\":\"1000\",\"clientSeed\":\"curl\",\"commitmentId\":\"$COMMIT\",\"autoCashoutMultiplier\":null}"
# then POST /api/pump/pump and /api/pump/cashout with {"roundId": "...", "expectedVersion": N}
curl -s -b jar "$B/api/rounds/<roundId>/verify" > round.json && node tools/verify-round.mjs round.json
```

## Limits

- 600 requests per minute per IP (configurable). `/api/health` is exempt.
- 60 new players per hour per IP (configurable). Resuming an existing session doesn't count.
- 20 seed rotations (`POST /api/fairness/rotate`) per minute per IP: each one stores a commitment.
- `/api/health` is exempt from limits; checks within 2 seconds share one database ping.
- History pages hold at most 50 rounds and are paged by round nonce (`nextCursor`).
