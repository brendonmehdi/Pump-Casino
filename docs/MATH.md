# The math of Pump

Everything on this page is computed by the engine (`packages/engine`) and checked by its test
suite. The exact proof is authoritative; the simulation is supporting evidence.

## 1. The pop curve

Pump _n_ (counting from 1) pops with probability

```
p(n) = (800 + 125·(n − 1)) / 10,000        n = 1 … 25
```

so the first pump pops 8.00% of the time and every pump after it adds 1.25 percentage points,
up to 38.00% on pump 25. Probabilities are whole basis points out of 10,000, which is also the
range of the fairness sampler, so every chance is represented exactly.

**Why this curve.**

- **Tension rises at a steady, readable rate.** The risk of the next pump is always the last one
  plus 1.25 points. Players can feel the pressure climb, and the Pressure Ladder can show it
  without a table of odd numbers.
- **The start is gentle and the end is dramatic.** A flat curve can't do both. To reach the
  1,000× cap within 25 pumps, a flat curve needs p ≈ 24.2% on every pump, which makes the very
  first pump a one-in-four pop and leaves no rise in tension. A flat 10% curve tops out at only
  13.5×.
- **The 25-pump limit binds before the 1,000× limit.** The top rung pays 794.0195×. The
  assignment ends the ladder at "25 pumps or 1,000×, whichever comes first", and the rule
  validator (`buildRuleSet`) rejects any schedule whose ladder would pass 1,000×. A steeper
  curve would hit the cap early and need a truncated ladder.
- **The top is rare but real.** Surviving all 25 pumps happens with probability
  S(25) ≈ 0.122%, about 1 round in 819.

## 2. Multipliers follow from the curve

Let S(n) be the chance of surviving pumps 1 … n:

```
S(0) = 1        S(n) = Π_{i=1..n} (1 − p(i))
```

The multiplier for cashing out after _n_ pumps is

```
M(n) = 0.97 / S(n)
```

Both are exact rationals (BigInt numerator and denominator). No floating-point number is ever
used for a probability, multiplier or amount of money.

| Pump | Pop chance | Survival S(n) | Multiplier M(n) |   Shown | S(n)·M(n) |
| ---: | ---------: | ------------: | --------------: | ------: | --------: |
|    1 |      8.00% |    0.92000000 |       1.054347× |   1.05× |  0.970000 |
|    2 |      9.25% |    0.83490000 |       1.161815× |   1.16× |  0.970000 |
|    3 |     10.50% |    0.74723550 |       1.298118× |   1.29× |  0.970000 |
|    4 |     11.75% |    0.65943532 |       1.470955× |   1.47× |  0.970000 |
|    5 |     13.00% |    0.57370873 |       1.690753× |   1.69× |  0.970000 |
|    6 |     14.25% |    0.49195524 |       1.971724× |   1.97× |  0.970000 |
|    7 |     15.50% |    0.41570217 |       2.333401× |   2.33× |  0.970000 |
|    8 |     16.75% |    0.34607206 |       2.802884× |   2.80× |  0.970000 |
|    9 |     18.00% |    0.28377909 |       3.418151× |   3.41× |  0.970000 |
|   10 |     19.25% |    0.22915161 |       4.233005× |   4.23× |  0.970000 |
|   11 |     20.50% |    0.18217553 |       5.324534× |   5.32× |  0.970000 |
|   12 |     21.75% |    0.14255235 |       6.804517× |   6.80× |  0.970000 |
|   13 |     23.00% |    0.10976531 |       8.837035× |   8.83× |  0.970000 |
|   14 |     24.25% |    0.08314722 |      11.666053× |  11.66× |  0.970000 |
|   15 |     25.50% |    0.06194468 |      15.659132× |  15.65× |  0.970000 |
|   16 |     26.75% |    0.04537448 |      21.377655× |  21.37× |  0.970000 |
|   17 |     28.00% |    0.03266962 |      29.691187× |  29.69× |  0.970000 |
|   18 |     29.25% |    0.02311376 |      41.966343× |  41.96× |  0.970000 |
|   19 |     30.50% |    0.01606406 |      60.383227× |  60.38× |  0.970000 |
|   20 |     31.75% |    0.01096372 |      88.473593× |  88.47× |  0.970000 |
|   21 |     33.00% |    0.00734569 |     132.050139× | 132.05× |  0.970000 |
|   22 |     34.25% |    0.00482979 |     200.836714× | 200.83× |  0.970000 |
|   23 |     35.50% |    0.00311521 |     311.374751× | 311.37× |  0.970000 |
|   24 |     36.75% |    0.00197037 |     492.292096× | 492.29× |  0.970000 |
|   25 |     38.00% |    0.00122163 |     794.019510× | 794.01× |  0.970000 |

Decimals are floored, never rounded up. "Shown" is what the game displays (2 dp, floored).

## 3. Proof: 97% at every cash-out point

A player who cashes out after _n_ pumps is paid M(n) with probability S(n) and nothing
otherwise, so the expected return per unit bet is

```
E[return] = S(n) · M(n) = S(n) · 0.97 / S(n) = 0.97        for every n = 1 … 25
```

The identity holds by construction, and the test suite checks it with exact integer arithmetic
rather than trusting the algebra. With S(n) = sN/sD and M(n) = mN/mD, it asserts
`sN · mN · 100 = 97 · sD · mD` for all 25 rungs (`ladder.test.ts`, "exact RTP proof").

**Every strategy, not just every point.** The only information a player has at pump _n_ is
that the balloon has survived so far. Any way of deciding when to stop (fixed, auto target,
random or "gut feeling") is a mixture of the fixed cash-out points above, so it also returns
exactly 97% before rounding. Abandoning a round can only lower the return (see §6).

## 4. Rounding: always down, and why

Money is integer cents everywhere: `BIGINT` in PostgreSQL, `bigint` in TypeScript, and decimal
strings in JSON. A payout is the exact rational amount floored to the cent:

```
payout(bet, n) = floor(bet_cents × M(n))
```

This is computed in exactly one place (`floorMultiply` in `ratio.ts`).

**Why floor.** Flooring is the only rounding rule that can never push expected return over 97%:
`S(n) · floor(bet · M(n)) ≤ S(n) · bet · M(n) = 0.97 · bet`. Rounding to the nearest cent
breaks the guarantee. A $0.10 bet cashed out after one pump would be paid 10.54¢ → 11¢, a
101.2% return. As a mutation check, swapping floor for round-half-up makes the exhaustive test
below fail on 1,249,612 (bet, pump) combinations.

**Exhaustive check.** The test suite evaluates every permitted bet (each cent from $0.10 to
$1,000.00, 99,991 values) at all 25 cash-out points: 2.5 million cases. Each payout must be the
exact floor, and the expected return must be ≤ 97% (exact integer comparison). It runs in
about 2 seconds.

**Flooring is the best possible rule, not just a safe one.** For a given bet and pump, a payout
of P cents returns S(n)·P/bet, which stays at or under 97% exactly when P ≤ bet × M(n). The
largest whole number of cents that satisfies this is floor(bet × M(n)), and one cent more
would pay over 97%. So no deterministic cent-valued rule can return more, for any bet at any
point, without breaking the ceiling. The exhaustive test checks both halves (`isFloor`) for
all 2.5 million cases.

**What flooring costs.** Flooring loses less than one cent per cash-out, so the shortfall at
pump _n_ is S(n)·frac(bet × M(n)) / bet < S(n) / bet ≤ 0.92 / bet (bet in cents). That is under
0.92 percentage points for a $1 bet and under 0.092 for $10, and it shrinks as the ladder climbs.
It is negligible for normal bets but real for the smallest ones, so we report it rather than
pretend every bet returns exactly 97%. These figures are exact and come from both the engine
tests and an independent Python reference (`tools/rtp_analysis.py`), which agree to the part
per million:

| Bet       | Lowest RTP (at pump) | Highest RTP | Mean over the 25 points |
| --------- | -------------------: | ----------: | ----------------------: |
| $0.10     |    89.6682% (pump 3) |    96.9976% |                95.5353% |
| $0.11     |    91.0800% (pump 2) |    96.9976% |                95.7566% |
| $0.25     |    94.9586% (pump 4) |    96.9976% |                96.6352% |
| $0.50     |    95.6461% (pump 3) |    96.9976% |                96.7243% |
| $1.00     |    96.3933% (pump 3) |    96.9998% |                96.9083% |
| $2.50     |    96.7840% (pump 1) |    96.9999% |                96.9438% |
| $10.00    |    96.9318% (pump 2) |    96.9999% |                96.9868% |
| $100.00   |    96.9956% (pump 1) |    96.9999% |                96.9991% |
| $1,000.00 |    96.9992% (pump 1) |    96.9999% |                96.9998% |

Over every permitted bet:

- **Bets of $1 or more** never return less than 96.18%, the worst being $1.10 on pump 1.
- **Bets of $10 or more** never return less than 96.91%, and **bets of $100 or more** never less
  than 96.99%.
- **The mean** over all 2.5 million (bet, pump) pairs is 96.9989%.
- **The single worst case** is a $0.10 bet cashed out after pump 3. It pays 12¢ instead of
  12.98¢, for an effective 89.67%.

The tests pin each of these.

**Why no design can be exact for every bet.** Exactly 97% for a bet of b cents means
S(n)·P(b) = 0.97·b, so P(b) = b × M(n). Since 10¢ and 11¢ are both permitted bets, and both
payouts are whole cents, M(n) = P(11) − P(10) must be a whole number. Whole-number multipliers
don't make a Pump game:

- If M(1) = 1 (a 3% pop chance on pump 1), then M(2) ≥ 2 needs a pop chance of at least 50% on
  pump 2.
- If M(1) ≥ 2, pump 1 alone needs at least 51.5%.

The pop chance must not fall from pump to pump, so every later pump also pops at least half the
time and the multiplier at least doubles. That gives M(n) ≥ 2ⁿ⁻¹, which passes 1,000× by pump 11.
The result is a coin-flip doubling game, not a 25-pump ladder of rising tension.

So for any real ladder, some small bets must fall short of 97%. The only question is which bets,
and by how much. "Rounding may push it just under 97%, but never over" is achievable; "exactly
97% for every bet in whole cents" is not.

**Alternatives compared, exactly.** `tools/rtp_analysis.py` evaluates each design over all
99,991 bets × 25 points with exact fractions. Every design below is exactly 97% in theory, apart
from E, and none ever exceeds 97%.

| Design                                                           | Pop chances                                                    |     Top | Worst, any bet | Worst at $0.10 | Worst at $1.00 | Mean, all pairs | Cost                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ------: | -------------: | -------------: | -------------: | --------------: | -------------------------------------------------------- |
| **A. Shipped:** linear hazard, exact multipliers                 | 8.0% → 38.0%, +1.25 points per pump                            | 794.01× | 89.67% ($0.10) |         89.67% |         96.39% |        96.9989% | none                                                     |
| B. Exact 2-dp multipliers (1.05×, 1.16×, …), pop chances derived | 7.6% → 38.0%, slightly uneven                                  | 794.01× | 90.23% ($0.10) |         90.23% |         97.00% |        96.9989% | new provably-fair sampler (non-basis-point thresholds)   |
| C. Exact 1-dp multipliers (1.1×, 1.3×, 1.6×, …)                  | 11.8% → 32.5%: 20% by pump 4, then a 20–24% plateau to pump 17 | 956.90× | 91.83% ($0.13) |         97.00% |         97.00% |        96.9994% | new sampler, harsher first pump, flat middle, lower peak |
| D. Basis points tuned to land just above C's multipliers         | as C                                                           | 956.90× | 91.83% ($0.13) |         96.98% |         96.98% |        96.9993% | same shape problems as C, and a new rules version        |
| E. Shipped curve, paying the displayed 2-dp multiplier           | as A                                                           | 794.01× | 89.67% ($0.10) |         89.67% |         96.39% |        96.9073% | every bet loses up to 0.6 points before cent rounding    |

C and D follow the shipped hazard where the 0.1× grid allows. The grid forces big early steps,
and following the curve all the way would overshoot 1,000× (1,832× at pump 25). The tool
therefore lowers the target for the last pump until the ladder fits under the cap.

**Decision: keep A.** No design removes the small-bet shortfall, which is the cent itself: 1¢ is
10% of a 10¢ bet. The alternatives only move exactness onto particular round bets. B helps whole
dollars; C and D help multiples of 10¢, but bets like 11¢ and 13¢ still fall several points
short. They pay for it either with a change to the provably-fair sampler (B, C), or with the
rising-tension curve itself (C, D: an 11.8% first pump, a long flat middle and a lower peak). The
mean return over all bets and points differs by under 0.001 points.

A keeps the cleanest rule, 8% plus 1.25 points per pump, and a proof anyone can check in one
line. If round small bets ever matter more than the curve, D is the cheapest upgrade: the same
sampler with a new basis-point table, shipped as a new rules version so old rounds keep
verifying under v1.

**Randomised rounding, considered and rejected.** Paying the fractional cent with probability
equal to the fraction would make every bet return exactly 97% on average. It could even stay
verifiable, by drawing from the round's HMAC stream. But identical cash-outs would pay different
amounts, the "Cash out now" figure would stop being a promise, and the fairness protocol would
need a second kind of draw. The PDF explicitly allows rounding just under 97%, so a fixed, shown,
floored payout is the better contract with the player.

**Display honesty.** Multipliers are displayed floored to 2 dp. The amount shown on the Cash Out
button and in the ladder is the server's exact payout, computed by the same function that
settles the round, so what you see is what you get. The 2-dp label can understate the payout:
on a $10 bet, 1.05× suggests $10.50 but pays $10.54, because the real multiplier is 1.0543…. A
cent amount derived from the label, rounded down, never exceeds the real payout.

## 5. Edge cases

| Situation                           | Rule                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cash out before the first pump      | Refused (`CASHOUT_REQUIRES_PUMP`). Refunding 1.00× would be a 100% RTP point, and paying M(0) = 0.97× is a guaranteed 3% loss that serves nobody. The UI disables the button and says why. |
| Surviving pump 25                   | Settles automatically inside that pump request (`LADDER_TOP`) at 794.0195×.                                                                                                                |
| Auto target and the top on one pump | One settlement, recorded as `LADDER_TOP`; one ledger credit (tested).                                                                                                                      |
| Auto target above 794.01×           | Never triggers; the round cashes out at the top instead. The UI says so when you type it.                                                                                                  |
| Auto target reached                 | Settles inside the pump transaction, at the first rung whose exact multiplier ≥ target.                                                                                                    |
| Bet limits                          | $0.10 to $1,000.00 in whole cents; the server rejects anything else before touching the wallet.                                                                                            |
| Multiplier cap                      | `buildRuleSet` rejects any rule set whose ladder exceeds 1,000×.                                                                                                                           |
| Abandoned round                     | Forfeited after 24 hours (see README). Forfeiting only lowers the player's return, so the 97% ceiling holds whatever players do.                                                           |

## 6. Simulation (100,000 rounds)

`packages/engine/test/simulation.test.ts` derives 100,000 rounds through the real fairness code
with deterministic seeds (`serverSeed = SHA-256("pump-simulation|i")`), so every run sees the
same rounds and anyone can reproduce the numbers below. Bets are $1,000, which keeps cent
rounding negligible next to sampling noise. Pass criteria are 5σ bands, wide enough that a
correct engine can't fail by chance, and narrow enough to catch a wrong hazard or multiplier at
the frequently reached early rungs. High rungs are rare (182 rounds reached pump 25 and 102 survived it), so their
observed RTP is noisy by nature. That is why the exact proof, not the simulation, is the
authority.

**Pop rate per pump** (all within 2.5σ of the configured rate):

| Pump | Reached | Popped | Observed | Configured |     z |
| ---: | ------: | -----: | -------: | ---------: | ----: |
|    1 | 100,000 |  7,941 |    7.94% |      8.00% | −0.69 |
|    2 |  92,059 |  8,523 |    9.26% |      9.25% |  0.09 |
|    3 |  83,536 |  8,774 |   10.50% |     10.50% |  0.03 |
|    4 |  74,762 |  8,740 |   11.69% |     11.75% | −0.51 |
|    5 |  66,022 |  8,548 |   12.95% |     13.00% | −0.40 |
|    6 |  57,474 |  8,123 |   14.13% |     14.25% | −0.80 |
|    7 |  49,351 |  7,690 |   15.58% |     15.50% |  0.50 |
|    8 |  41,661 |  7,095 |   17.03% |     16.75% |  1.53 |
|    9 |  34,566 |  6,165 |   17.84% |     18.00% | −0.80 |
|   10 |  28,401 |  5,484 |   19.31% |     19.25% |  0.25 |
|   15 |   8,266 |  2,204 |   26.66% |     25.50% |  2.43 |
|   20 |   1,532 |    476 |   31.07% |     31.75% | −0.57 |
|   25 |     182 |     80 |   43.96% |     38.00% |  1.66 |

**Return when always cashing out at pump _n_:**

| Cash out at | Rounds paid | Observed RTP | Expected (after flooring) |     z |
| ----------: | ----------: | -----------: | ------------------------: | ----: |
|           1 |      92,059 |       97.06% |                  96.9993% |  0.69 |
|           2 |      83,536 |       97.05% |                  96.9995% |  0.39 |
|           3 |      74,762 |       97.05% |                  96.9994% |  0.28 |
|           5 |      57,474 |       97.17% |                  96.9998% |  0.66 |
|           7 |      41,661 |       97.21% |                  96.9999% |  0.58 |
|          10 |      22,917 |       97.01% |                  96.9999% |  0.01 |
|          15 |       6,062 |       94.93% |                  97.0000% | −1.74 |
|          20 |       1,056 |       93.43% |                  97.0000% | −1.23 |
|          25 |         102 |       80.99% |                  97.0000% | −1.83 |

**Through the state machine:** the same 100,000 rounds, played with `createRound` /
`applyAction` and a 2.00× auto cash-out (first reached on pump 7), returned 97.212%
(σ ≈ 0.36 percentage points).

## 7. Reproduce

```bash
pnpm --filter @pump/engine test      # exact proof, exhaustive rounding sweep, simulation, fairness
node tools/verify-round.mjs file.json   # independent check of any revealed round
python tools/rtp_analysis.py            # exact RTP of every bet at every point, and the alternatives
```
