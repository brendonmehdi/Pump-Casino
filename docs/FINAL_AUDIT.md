# Final audit (2026-10-29)

A last review before submission. It:

- re-reads the assignment;
- audits the actual code rather than earlier summaries;
- reproduces the mathematics independently;
- attacks the backend;
- checks the live site.

The audit ran from the owner's request at 13:05 EDT to its last commit at 14:26. The redeploy
was verified at 14:32. These times come from the session log and git timestamps.

Code fixes went in as small, separate commits, each with tests. Documentation corrections went
in as docs commits.

## Method

- **Requirements.** The assignment PDF was re-read in full and every requirement traced to its
  code and tests ([`REQUIREMENTS.md`](REQUIREMENTS.md)).
- **Mathematics.**
  - The ladder, the 97% identity and the effective return of every permitted bet were recomputed
    with an independent implementation: Python `fractions`, sharing no code with the engine
    (`tools/rtp_analysis.py`).
  - The engine tests now pin the reference's values.
  - Four alternative designs were evaluated exactly ([`MATH.md`](MATH.md) §4).
- **Independent review.** A separate Claude Code agent reviewed the code adversarially. It was
  read-only and worked from the code, not the docs. It recomputed the math in Python and ran a
  stress harness on a scratch database: two app instances, clock skew, expiry races, duplicate
  keys and rotations, 387 rounds. It also wrote a proof of concept for a fairness weakness.
- **Live UX audit.** Another agent played https://pump-casino.onrender.com with Playwright on
  desktop Chromium (six window sizes), a Pixel 7 and an iPhone 14, in portrait and landscape. It
  took 120 screenshots and made 61 checks of displayed amounts against the API's JSON.
- **Regression gate.** Every change ran through format, lint, typecheck, unit, integration and
  end-to-end tests before it was committed. Where it mattered, a test was shown to fail without
  its fix.
- **Production data.** Nothing on the live service was tested destructively; the live checks use
  fresh play-money sessions.

**Severity scale:**

- **Critical:** money or fairness could be wrong.
- **High:** a requirement is broken, or a security weakness is exploitable.
- **Medium:** a real defect with limited impact.
- **Low:** polish, docs or a theoretical risk.

No critical findings were made.

## Findings fixed

| #   | Severity   | Found by     | Finding                                                                                                                                                                                                                                                                                                                                       | Fix and evidence                                                                                                                                                                                                                                                                      |
| --- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium     | Reviewer     | **The fairness claims overstated what the protocol proved.** The client seed was saved and reused, and the server fixes the next round's seed in the request that receives the current one. A dishonest server could therefore search for a next seed that pops early: the reviewer's proof of concept forced a pump-1 pop in about 11 tries. | A fresh random client seed is picked as soon as one has been used, after the server has committed to the next round (`useFreshClientSeed`). FAIRNESS.md, the README and the panel were corrected. The E2E test "every bet sends a fresh client seed…" passes on 3 browsers. `716ec0b` |
| 2   | Medium-low | Reviewer     | In-browser verification compared the server's revealed seed with the server's own report of the hash, never with the hash the player saw.                                                                                                                                                                                                     | The client checks that each new round uses the hash it was shown, records it per browser, and the verify page compares against that record. Covered by 4 unit tests and an E2E assertion. `716ec0b`                                                                                   |
| 3   | High       | UX audit     | Keyboard users could not place a bet: Enter or Space on the focused Bet button did nothing (WCAG 2.1.1, Level A).                                                                                                                                                                                                                             | Between rounds a focused button keeps its native activation; during a round the hotkeys are unchanged. The new E2E test fails without the fix. `d6de73e`                                                                                                                              |
| 4   | High       | UX audit, me | Bet and Pump sat below the fold on 1280×720 (fully hidden) and 1366×768 (13 px visible). The desktop tests ran at 1440×900 and couldn't see it.                                                                                                                                                                                               | On desktop the balloon is sized by the height that's left. A new E2E test at both sizes requires the buttons to be fully visible and fails without the fix. `34ec9f4`                                                                                                                 |
| 5   | Medium     | UX audit     | Between rounds the Pressure Ladder previewed the finished round's bet, not the amount being typed ($10.54 shown for a $100 bet).                                                                                                                                                                                                              | It now uses the round's bet only while the round is live. Covered by an E2E test on 3 browsers. `8f6221f`                                                                                                                                                                             |
| 6   | Medium     | UX audit     | Below 1024 px wide, the fixed action bar covered "Cash out now" and "Next pump pops". On an iPhone 14 at 0 pumps the hint made the bar 28 px taller. Keyboard focus could hide behind the bar.                                                                                                                                                | The hint moved inside the disabled Cash out button, the balloon is height-capped, and controls get a scroll margin. A test asserts the stats don't intersect the bar. Measured clear on iPhone 14, iPhone SE, Pixel 7 and 900×700. `834bf71`                                          |
| 7   | Medium     | UX audit     | On phones, the History and Verify links live in the header menu, which stayed open over the new page after navigating.                                                                                                                                                                                                                        | The menu closes on route change and on a tap outside it. Covered by an E2E assertion. `7a06061`                                                                                                                                                                                       |
| 8   | Medium     | UX audit     | The 2-dp multiplier doesn't multiply to the money shown: 1.29× on $10 pays $12.98. History's "+$1.16" read as profit.                                                                                                                                                                                                                         | The ladder footnote now explains it (shown rounded down, paid exact) and History says "paid $1.16". The label itself is unchanged by design, because the exact payout is always shown. `4e63b7a`                                                                                      |
| 9   | Low        | UX audit     | A popped-round pill's accessible name didn't contain its visible text, a serious axe finding (WCAG 2.5.3). Faint text measured 4.31:1. Every page was titled "Pump".                                                                                                                                                                          | Names now start with the visible text, the faint colour reaches 4.5:1, and each page has its own title. The accessibility E2E test now scans a popped pill. `4e63b7a`                                                                                                                 |
| 10  | Low        | UX audit     | Copy: "1 rounds", "after 1 pumps", a "Round 4 of 3" flash, and an unknown-round message pointing to a missing paste box.                                                                                                                                                                                                                      | Fixed, and the E2E expectation updated to the corrected text. `5a841d9`                                                                                                                                                                                                               |
| 11  | Low        | Reviewer     | `/api/health` is rate-limit-exempt but took a pooled connection per call. `POST /api/fairness/rotate` stored rows under only the global limit (1 GB free database).                                                                                                                                                                           | Health checks share one database ping per 2 s, and rotations are limited to 20 a minute. Unit and integration tests added. The dead `SERVICE_UNAVAILABLE` code was removed. `3043ab3`                                                                                                 |
| 12  | Low        | Reviewer, me | Documentation errors, listed below.                                                                                                                                                                                                                                                                                                           | All corrected.                                                                                                                                                                                                                                                                        |

The documentation errors in row 12:

- the fairness panel's contents (FAIRNESS.md);
- the database "a manual write cannot break" claim and the expiry-on-read list (DATABASE.md);
- "the rules exist in exactly one place" (ARCHITECTURE.md);
- 794.02× against 794.01× (MATH.md);
- stale test counts (QA.md);
- the Render `TRUST_PROXY` example (.env.example);
- MATH.md's display-honesty wording;
- the README's abandoned-round argument;
- the AI_USAGE.md commit-history wording.

## Findings examined and kept, with reasons

| Finding                                                                                                                                                                  | Decision and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Low (judgement), reviewer and me:** the $0.10 bet returns 89.67% at pump 3, which is not "just under" 97%                                                              | **Kept, with a proof.** Flooring is the largest whole-cent payout that keeps any bet at or under 97%, so no deterministic rule does better. Exactly 97% for every whole-cent bet needs whole-number multipliers, which make coin-flip pumps. Of five designs compared exactly, none lifts the worst case above 91.83%; each only moves exactness onto chosen round bets, at the cost of the fairness sampler or the rising-tension curve. Bets of $1 or more never return less than 96.18%, and the mean over every bet and point is 96.9989%. See [`MATH.md`](MATH.md) §4. Randomised rounding was considered and rejected there. |
| Low, reviewer: the database doesn't tie the balance to the ledger sum, `TRUNCATE` bypasses the append-only trigger, and the app role owns the tables                     | **Kept and documented** in [`DATABASE.md`](DATABASE.md), "Limits of the database checks". The single write path plus the reconciliation tests (including the reviewer's stress run) hold the invariant. The hardening (balance trigger, `TRUNCATE` trigger, an insert-only role) is listed there. It wasn't attempted near the deadline.                                                                                                                                                                                                                                                                                           |
| Low (design), reviewer: forfeiting an abandoned round confiscates the rung already reached                                                                               | **Kept.** Settling at the reached rung is also a valid 97% rule. We keep the stricter one: it is simpler and never pays on the server's initiative. The README's argument was corrected (it wrongly said the house never pays without a player decision, though the ladder top settles by rule) and now names the alternative.                                                                                                                                                                                                                                                                                                     |
| Low (theoretical), reviewer: responses are validated against the schema after commit                                                                                     | **Kept.** A stored body that failed a newer schema would replay as a 500, while the client resyncs from `GET /pump/current`. That needs a schema change between deploys, which this version doesn't have. Moving validation before the commit would restructure the idempotency path near the deadline.                                                                                                                                                                                                                                                                                                                            |
| Fairness residual: a dishonest operator could answer a winning bet with an error                                                                                         | **Documented** in FAIRNESS.md §7. Each refusal is visible to the player as an error, but the protocol doesn't prove it didn't happen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| UX: on phones the bet amount is below the fold                                                                                                                           | **Kept.** The Bet button always shows the amount, and a fix would mean reworking the layout. Listed for later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| UX: the bet field drops characters ("1e3" becomes 13)                                                                                                                    | **Kept, by design.** The field only accepts digits and a point, and the button shows the exact amount before anything is sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| UX: minor layout (a notice pushes content down, no scroll cue on the ladder, small idle balloon, icon-sized balloon in landscape) and the ~21 s lock during a pump retry | **Kept.** These are polish. The retry lock is the deliberate same-key retry that guarantees a pump applies once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Test infrastructure, me: E2E and API integration tests share the `pump_test` database                                                                                    | **Kept.** Concurrent local runs interfered once during the audit, giving 3 transient E2E failures that a clean rerun cleared. CI runs the suites one after another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Verified correct

**Mathematics:**

- All 25 pop chances, S(n), M(n) and S(n)·M(n) = 97/100 are exact.
- M(25) = 794.0195… ≤ 1,000×.
- Over all 2.5 million (bet, pump) pairs, no payout exceeds 97%, and each is the floor.
- A round-half-up mutant fails on 1,249,612 cases.
- The auto-target uses an exact rational ≥ comparison, and the ladder top takes precedence.
- Cash-out before the first pump is refused in the engine and by a database check.
- There is no off-by-one in the engine, the database checks, the verifier or the UI.
- MATH.md's simulation figures were reproduced exactly in Python.

**Money on screen:**

- 61 checks of UI against API showed 0 mismatches, covering cash-out values, multipliers, next-pump odds, all 25 ladder rows and balances.
- The settled payout always equalled the amount shown just before.

**Fairness primitives:**

- The HMAC message is unambiguous and the rejection limit is unbiased.
- The commitment is SHA-256 of the raw seed bytes.
- The published vectors reproduce in Python.
- The verifier and the verify page match the engine.

**No early leak:**

- 5,638 responses in the stress run, the E2E network capture and the production leak scan contained no active seed or pop point.
- Logs strip query parameters.

**Concurrency:**

- Every mutation takes the player lock first, then a version-guarded update, with unique ledger indexes behind it.
- Idempotency is keyed by (player, key) and bound to the request.
- The stress run reconciled every ledger with no 5xx.

**Security:**

- 256-bit session tokens, stored hashed, in HttpOnly, Secure, SameSite=Strict, Path=/api cookies.
- Every query is scoped to the player.
- CSRF checks via Sec-Fetch-Site and Origin; JSON bodies only.
- Strict CSP.
- Proxy trust as measured on Render.
- No `any` and no debugging leftovers; every dependency is used.

## Remaining limitations

- **Small bets.** Sub-dollar bets can fall several points short of 97%, as low as 89.67% for $0.10 at pump 3. This is inherent to whole cents and is proven and quantified in MATH.md.
- **Free hosting.** The server sleeps after 15 idle minutes, and the free database expires on 2026-11-28 (`SETUP_REQUIRED.md`).
- **Rate limits.** They are in memory and per instance. A request sent from a Cloudflare Worker could choose its own key (`DEPLOYMENT.md`).
- **Database hardening and selective refusal.** Both are listed above.
- **No physical iPhone.** Phones were tested with Playwright's Pixel 7 and iPhone 14 profiles.
