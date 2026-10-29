# Provably fair: specification v1 (`pump:v1`)

This page is complete enough to verify any round without our code. Two independent
implementations already agree with the engine on the test vectors below: `tools/verify-round.mjs`
(Node's built-in crypto) and the 15-line Python function in §6.

## 1. Protocol

1. **Before you bet**, the server prepares a commitment for your next round:
   - a 32-byte server seed from the operating system's CSPRNG (`crypto.randomBytes`);
   - the round id (a UUID) and nonce (your round counter) that the round will use;
   - `commitment = SHA-256(serverSeed bytes)` as lowercase hex.

   You see the commitment and nonce in the game's "Provably fair" panel before you bet. The
   API also gives the round id: `GET /api/pump/current` returns all three as `nextCommitment`.

2. **A client seed is chosen.** The web app picks a fresh random one for every bet. It does so
   right after the previous bet, which is also when the server fixed this round's commitment, so
   the server can't know the seed in advance. You can type your own for your next bet. Your browser
   also records the hash it showed you and checks the round really uses it.
3. **You bet.** The start request names the commitment id you saw. If it is no longer the
   current one, the server refuses (`COMMITMENT_MISMATCH`) rather than silently swapping it. The
   commitment is consumed exactly once, and the pop point is derived right then, before the
   first pump, from (server seed, round id, nonce, client seed).
4. **While the round runs**, the server seed and pop point stay on the server. No API response
   contains them. The contract schema rejects a seed on an active round, and an end-to-end test
   scans every response in a real browser.
5. **When the round ends** (pop, cash-out, top of the ladder, or 24-hour expiry), the seed is
   revealed in the round's data, and `GET /api/rounds/:id/verify` returns everything needed to
   recompute the round.

You can also ask for a fresh commitment before betting ("Get a new seed hash"). The unused one
is marked revoked, its seed is revealed on the spot, and it can never be used for a round.

## 2. The draw

For pump `i` (1 … 25) and attempt `c` (0, 1, …):

```
message = "pump:v1|" + roundId + "|" + nonce + "|" + clientSeed + "|" + i + "|" + c   (UTF-8)
digest  = HMAC-SHA256(key = serverSeed as 32 raw bytes, message)
u       = first 4 bytes of digest as an unsigned big-endian integer
limit   = floor(2^32 / 10000) × 10000 = 4,294,960,000
if u ≥ limit: try again with c + 1          (rejection sampling: no modulo bias)
sample  = u mod 10000                        (uniform over 0 … 9,999)
pump i pops  ⇔  sample < 800 + 125 × (i − 1)
```

The **pop point** is the first pump that pops. If none of the 25 pops, the balloon survives the
whole ladder and the round cashes out automatically at pump 25.

Encoding rules, chosen so that two implementations cannot disagree:

- `roundId` is a lowercase canonical UUID. `nonce` and `i`/`c` are decimal integers with no
  padding.
- `clientSeed` is 1–64 printable ASCII characters (`!` to `~`) excluding `|`. There is no
  space, no Unicode, and therefore no normalisation, and the field separator cannot appear
  inside it. The server rejects anything else.
- A rejected attempt is extremely rare (p ≈ 1.7 × 10⁻⁶ per draw), but vector C below
  exercises it.

## 3. Replaying the outcome

From the pop point you can rebuild the round. Replay the recorded number of pumps. A round
recorded as `POPPED` after _k_ pumps must pop on pump _k + 1_, one cashed out after _k_ pumps
must survive them, and so on. Then check the payout:

```
payout = floor(bet_cents × 0.97 / S(k)),     S(k) = Π_{i=1..k} (1 − popBasisPoints(i)/10000)
```

An auto cash-out target settles at the first pump whose exact multiplier is ≥ the target, and
surviving pump 25 settles at the top. The engine's `verifyRound` and the verify page replay the
recorded actions through the same state machine the server uses, so a recorded result that
could not have happened is reported as a mismatch.

## 4. Worked example (test vector A)

```
serverSeed = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
commitment = 630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd
roundId    = 00000000-0000-4000-8000-000000000001     nonce = 1     clientSeed = player-seed
```

| Pump | Message                                                               | First 4 bytes |             u | sample | pops below | result   |
| ---: | --------------------------------------------------------------------- | ------------- | ------------: | -----: | ---------: | -------- |
|    1 | `pump:v1\|00000000-0000-4000-8000-000000000001\|1\|player-seed\|1\|0` | `249ade02`    |   614,129,154 |  9,154 |        800 | survives |
|    2 | `pump:v1\|00000000-0000-4000-8000-000000000001\|1\|player-seed\|2\|0` | `cbc0293b`    | 3,418,368,315 |  8,315 |        925 | survives |
|    3 | `pump:v1\|00000000-0000-4000-8000-000000000001\|1\|player-seed\|3\|0` | `86555959`    | 2,253,740,377 |    377 |      1,050 | **pops** |

So a $10 bet cashed out after 2 pumps pays floor(1000 × 1.161815…) = 1161¢ = $11.61. Pumping a
third time pops.

## 5. Test vectors

These are reproduced by the engine (`packages/engine/test/vectors.ts`), which uses `@noble/hashes`.
They were generated with Node's `node:crypto`, a separate HMAC implementation, so the engine
passing them is an independent check.

| Vector | Server seed (hex)                                                  | Round id                               | Nonce | Client seed     | Samples                                   | Pop point              |
| ------ | ------------------------------------------------------------------ | -------------------------------------- | ----: | --------------- | ----------------------------------------- | ---------------------- |
| A      | `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` | `00000000-0000-4000-8000-000000000001` |     1 | `player-seed`   | 9154, 8315, 377                           | 3                      |
| B      | `3e82057bcf2aa2dc03e2411ea961f9aa9156d1875f4635fc3075a8cdca96334a` | `00000000-0000-4000-8000-00000000000b` |   925 | `ladder-top`    | 5120, 1222, 3917, 9595, … 6528, 9392 (25) | none (survives all 25) |
| C      | `6f6781fe0d80e49d4e64392c9933ecdecfdeb4b65bf716b635618c56aec2ebd4` | `00000000-0000-4000-8000-00000000000c` |     1 | `reject-469868` | 4860 (2nd attempt), 3782, 9503, 874       | 4                      |

Commitments: A `630dcd29…bd710dd`, B `56a71c61…ddebb4112`, C `a6acb2ba…41a0aac4b` (full values
in `vectors.ts`). In vector C, pump 1's first digest starts with `u = 4,294,960,657`, which is
≥ the limit, so the draw uses attempt 1.

## 6. Verify it yourself

- **In the game:** open any round from "Last 10" or History. The verify page recomputes it in
  your browser with the engine code shipped to the page; it does not ask the server for a
  verdict. You can also paste a round's JSON there.
- **From the command line:** save the JSON from `GET /api/rounds/:id/verify` and run
  `node tools/verify-round.mjs round.json`. That script uses only `node:crypto`.
- **In any language.** For example, Python with only the standard library (this exact code
  reproduces vectors A, B and C):

```python
import hashlib, hmac

def pop_point(server_seed_hex, round_id, nonce, client_seed):
    seed = bytes.fromhex(server_seed_hex)
    limit = (2**32 // 10_000) * 10_000
    for pump in range(1, 26):
        attempt = 0
        while True:
            message = f"pump:v1|{round_id}|{nonce}|{client_seed}|{pump}|{attempt}".encode()
            u = int.from_bytes(hmac.new(seed, message, hashlib.sha256).digest()[:4], "big")
            if u < limit:
                break
            attempt += 1
        if u % 10_000 < 800 + 125 * (pump - 1):
            return pump
    return None  # survives all 25 pumps
```

## 7. What this does and does not prove

**It does establish:**

- **The outcome was fixed before the first pump and could not change afterwards.** The pop point
  is a deterministic function of the committed seed and inputs that were all fixed when the round
  started.
- **The server could not choose the outcome to suit your client seed,** as long as that seed was
  unknown to it when it committed. The server seed, round id and nonce are committed one round
  ahead, and the app then picks a fresh random client seed for each bet, so the server never sees
  a round's client seed before it has fixed that round's seed.
  - **The round id and nonce matter too.** If the server could pick the round id after seeing your
    client seed, it could re-roll it until the balloon popped early. Allocating them with the
    commitment removes that freedom.
  - **Fixed after the audit.** Until the final audit the app reused one client seed across rounds.
    That would have let a dishonest server search for the next server seed after seeing it: the
    independent review forced a pop on pump 1 in about 11 tries. A fresh seed per bet closes this,
    and an end-to-end test checks it.
- **The round used the hash you were shown.** The browser checks this when you bet and keeps its
  own record, and the verify page compares the server's reported hash against that record,
  rather than only against the server's own report.
- **Every recorded result and payout can be checked by anyone, offline, after the round.**

**It does not establish:**

- **That the operator never peeks.** The server knows the pop point during the round. It cannot
  change it without the mismatch being detectable, but commit-reveal is not secrecy from the
  operator.
- **That the server seed was chosen without regard to a client seed it could predict.** If you
  type your own seed and reuse it, a dishonest operator that has seen it could pre-search server
  seeds that are bad for it. The default seed is random and fresh for every bet, but it is
  generated by the operator's own page. If you don't want to trust our JavaScript, type a new seed
  for every round.
- **That the operator never silently refuses a round.** The server learns your outcome when you
  bet. A dishonest operator could answer a bet that would win with an error, then show you a new
  commitment, and the refused commitment's seed is never revealed. You would see each refusal as
  an error, so a pattern would be suspicious, but the protocol doesn't prove it didn't happen.
- **That rounds you never finish are revealed early.** A round's seed is revealed when it ends.
  Unfinished rounds expire after 24 hours and are revealed then.
- **That nothing leaks from the operator's systems.** Seeds sit in the database until they are
  revealed, so a database compromise during a round would expose that round's outcome. For a
  play-money game we accept this. A production system would keep seeds in a separate secret
  store.
- **Anything about your verification history.** `GET /api/rounds/:id/verify` only answers the
  session that played the round. To share a verification, share its JSON; the math does not
  depend on our server.
