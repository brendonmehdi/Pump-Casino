# PUMP

A provably fair balloon game. Bet, pump, and cash out before the balloon pops. Every pump raises
the multiplier and the chance of a pop; every cash-out point returns exactly 97% on average,
before cent rounding (which only ever rounds down).

Play money only, with no cash value.

- **Live demo:** **https://pump-casino.onrender.com**. It runs on Render's free plan, so after
  15 idle minutes the first visit takes about a minute while the server wakes up.
- **Stack:** TypeScript end to end: React 19, Vite, Tailwind and Motion; Fastify 5; PostgreSQL 18
  with Drizzle; Zod contracts shared by both sides; Vitest, fast-check and Playwright.

## The fun part: the Pressure Ladder

Pump is a game about one decision, made 25 times: _one more?_ Most pump games show you a number
and a button and leave the odds to your gut. Pump puts the whole decision on screen:

- **The Pressure Ladder** shows every rung of the game at once: the multiplier, the exact chance
  that pump pops, and what it would pay on your bet. Rungs you've passed fill with pressure, the
  next rung is lit with its odds, and the red zone (30%+ pop chance) glows ahead of you. You can
  see exactly what you're risking for what. That turns a coin-flip feeling into a real
  choice, and the tension builds as you watch the next rung creep toward the red.
- **The balloon tells you the same story physically.** It inflates, the latex heats from pink to
  red, the printed logo stretches thin, and it starts to tremble near the top. The multiplier's
  typeface literally gets wider as the balloon swells.
- **Wins are sharp and losses are quiet.** Cash out and you let go of the balloon: it floats away
  while the payout lands in aqua. A pop is a soft thud and a few falling tatters, with no
  flashing screen.
- **Odds you can plan with.** Type an auto cash-out target and the game tells you which pump
  first reaches it and your chance of getting there (for example "Reached on pump 5, a 57.37%
  chance"). The next pump's pop chance and multiplier sit right above the Pump button at all
  times.

None of this changes the math. Everything shown comes from the same public rule set the server
uses, and none of it reveals the hidden outcome.

## Features

- Bet $0.10–$1,000 in cents; a $10,000 play-money balance for every new player, stored in
  PostgreSQL.
- Pump / Cash Out with the server's exact cash-out value, the next pump's pop chance and the
  next multiplier; the balance updates instantly; the last 10 rounds are on the game screen.
- **Auto cash-out** at a target multiplier, settled by the server inside the pump that reaches it.
- **Auto-bet:** a bounded number of rounds (max 1,000), a required target, stop on profit, stop
  before a bet could pass your loss limit, stop when the balance is too low, and pause/stop.
- **Keyboard:** Space pumps, Enter cashes out, Esc stops auto-bet. Ignored while typing, no key
  repeat, and never places a bet.
- **Sound** (synthesised, with mute and volume) and **reduced motion**: the in-game switch or
  your OS setting.
- **Provably fair:** see the seed hash before you bet, pick your own client seed, and verify
  any finished round in the browser ([`docs/FAIRNESS.md`](docs/FAIRNESS.md)).
- Refresh-proof: an open round is restored exactly after a reload or a server restart.
- Responsive: the balloon comes first on phones, with thumb-reach buttons; tested on desktop
  Chromium, Pixel 7 and iPhone WebKit.

## Run it locally

Requires Node 24, pnpm 11 (`corepack enable`) and Docker.

```bash
pnpm install
cp .env.example .env              # local-only database credentials
pnpm db:up                        # PostgreSQL 18 in Docker (dev + test databases, 127.0.0.1:55432)
pnpm --filter @pump/api db:migrate
pnpm --filter @pump/api dev       # API on http://localhost:3000
pnpm --filter @pump/web dev       # game on http://localhost:5173 (proxies /api)
```

| Command                                              | What it does                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm test`                                          | Engine, contracts, web unit and PostgreSQL integration tests |
| `pnpm build && pnpm test:e2e`                        | Playwright on desktop Chromium, Pixel 7 and iPhone WebKit    |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks (CI runs them all)                             |
| `node tools/verify-round.mjs round.json`             | Verify a round with nothing but Node's crypto                |

Environment variables are validated at startup (`apps/api/src/config.ts`); see `.env.example`.

## Deploy (Render)

[`render.yaml`](render.yaml) is a Render Blueprint with two parts:

- **The game:** one Docker web service. Fastify serves the API and the built web app on one
  origin.
- **PostgreSQL 18:** on the free plan, in the same region, reachable only over Render's
  private network.

The image runs the migrations at every start, before the server, because free instances have
no pre-deploy step. The migrations skip anything already applied and take a lock, so repeated
or overlapping starts are safe. `/api/health` (which also pings the database) is the health
check.

`TRUST_PROXY=loopback,uniquelocal,cloudflare` lets rate limits see each visitor's real address
through Cloudflare and Render's proxies, while forged `X-Forwarded-For` entries are ignored.
This was measured on the live service, not assumed. Setup, verification results, free-plan
limits and how to redeploy are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## How it's built

```
packages/engine     pure game engine: rules, exact BigInt math, fairness, state machine, verifier
packages/contracts  Zod schemas for every request and response, shared by API and web
apps/api            Fastify + PostgreSQL: sessions, ledger, transactions, idempotency
apps/web            React client: renders server state, never decides an outcome
tools/              dependency-free round verifier
```

`packages/engine/src/PumpEngine.ts` is pure: rules, state, action and seed material go in, and
the next state comes out. The API wraps every action in one PostgreSQL transaction (player row
lock → idempotency check → engine → version-guarded write → ledger entry). The browser animates
whatever the server returns. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATABASE.md`](docs/DATABASE.md), [`docs/API.md`](docs/API.md).

## The pop curve, and why

Pump _n_ pops with probability **8% + 1.25 points × (n − 1)**: 8% on the first pump, 38% on the
25th. The multiplier after _n_ pumps is **0.97 / S(n)**, where S(n) is the chance of surviving
that far, so every cash-out point returns exactly 97% (S(n) × 0.97/S(n)). The test suite checks
this with exact integer arithmetic at all 25 points.

The hazard rises steadily so that tension rises at a readable, even pace. The first pump is
gentle (8%), the late pumps are dramatic, and the top rung pays 794.01×, so the
25-pump limit is reached before the 1,000× cap. A flat curve can't do both. To reach 1,000×
in 25 pumps it needs about a 24% pop on _every_ pump, the first one included. Full tables,
proof and simulation: [`docs/MATH.md`](docs/MATH.md).

**Rounding: always down, to the cent.** Payouts are `floor(bet_cents × exact multiplier)`. That is
the only rule that can never push any bet over 97%, and it is also the best possible one: for every
bet at every point it pays the most whole cents that keep the return at or under 97%, because one
cent more would exceed it. Rounding to the nearest cent would pay a $0.10 bet 11¢ at pump 1, a
101.2% return. The test suite checks every permitted bet ($0.10–$1,000, every cent) at every pump:
2.5 million cases.

The cost of whole cents is reported rather than hidden:

- Bets of $1 or more never return less than 96.18%, and bets of $10 or more never less than 96.91%.
- The mean over every bet and pump is 96.9989%.
- Only small bets feel it: the $0.10 minimum returns between 89.67% and 97% depending on where you
  cash out, because 1¢ is 10% of the bet.

No curve can avoid this. Exactly 97% for every whole-cent bet would need whole-number multipliers,
which means coin-flip pumps. Ladders that make round small bets exact exist, but they flatten the
rising tension. The proof, the exact comparison of five designs and an independent Python reference
(`tools/rtp_analysis.py`) are in [`docs/MATH.md`](docs/MATH.md).

**Cash-out before the first pump is refused.** A 1.00× refund there would be a 100%-RTP cash-out
point, which breaks the 97% rule.

## Abandoned rounds: forfeited after 24 hours

An open round stays playable for 24 hours. You can close the tab, refresh or come back later,
and the round is restored exactly where you left it. After 24 hours it is forfeited: no
refund, and the seed is revealed in your history like any other round. Why this rule:

- **The server never picks a cash-out point for you.** A round pays only on a rule you can see
  in advance: your cash-out click, the auto target you set, or the top of the ladder.
  Settling an abandoned round at its current rung would be the server choosing the moment on
  your behalf.
- **It can't be gamed.** A refund on abandonment would let a player bet, look at the next-pump
  odds and walk away free, an option worth more than 97%. Forfeiting can only lower a player's
  return, so the 97% ceiling holds for every possible behaviour.
- **The alternative was considered.** Settling at the rung already reached, after at least one
  pump, would also keep every cash-out point at exactly 97% and would be kinder to a player who
  lost their connection. That's defensible too; we chose the stricter rule because it is
  simpler and never pays on the server's initiative. See `docs/FINAL_AUDIT.md`.
- **It's generous and visible.** A day is far longer than any real round, and the rule is shown
  under the bet controls.
- **It's race-free.** Expiry is applied under the same row lock as every pump and cash-out, the
  next time the player does anything, so it can never double-resolve a round.

## Correctness at a glance

- Money is integer cents everywhere (BIGINT, `bigint`, decimal strings in JSON).
- Bet and balance check happen in one transaction under the player's row lock; the balance can't
  go negative (also a CHECK constraint).
- One active round per player (lock plus a partial unique index).
- Pump and Cash Out sent together can't both succeed: actions carry the round `version`, and
  the stale one gets a 409 with the current state.
- A double-clicked Cash Out pays once (version, status, and a unique ledger index as backstop).
- A retried request with the same `Idempotency-Key` replays the original result instead of
  acting twice.
- The pop point is fixed at bet time from a seed committed (SHA-256) _before_ that round's client
  seed exists. The app picks a fresh random client seed after every bet, once the next hash is
  fixed, so the server can't know it in advance.
- The pop point never reaches the browser early; an end-to-end test checks every response.

## Tradeoffs

- **Integrity over cleverness.** Every mutation for a player is serialised by one row lock.
  That's simple and provably correct, and per-player throughput is far beyond what a human
  can click.
- **Lazy expiry instead of a background sweeper.** Nothing observable needs one, and it avoids
  a scheduler.
- **Same-origin single service** rather than a separate frontend host: no CORS, first-party
  cookies, one deploy.
- **Anonymous cookie sessions.** No sign-up friction, but clearing cookies starts a new wallet
  and there's no cross-device recovery.
- **In-memory rate limiting.** Enough for one instance; scaling out would need a shared store.
- **Free hosting.** Render's free plan costs nothing, but the server sleeps when idle and the
  free database expires 30 days after creation (2026-11-28). That's fine for a demo, not for
  real use.
- **Sound is synthesised, not recorded.** It keeps the app tiny and original but is less rich
  than designed audio.

## With more time

- Move to paid Render plans (no sleeping, backups, a database that doesn't expire), connect
  Render to GitHub for automatic deploys, and add uptime monitoring.
- Keep seeds in a dedicated secret store instead of the main database, and prune old
  idempotency records on a schedule.
- Load-test the API against a shared rate-limit store and run multiple instances.
- Add a public, shareable verification link per round (opt-in), plus a seed-rotation history.
- Accessibility audit with real screen-reader users, and more sound design.

## Hours spent

This project was built in one continuous Claude Code session (Claude Opus 5.5), directed by the
repository owner's written brief. Wall-clock time from the owner's instructions (00:06 EDT,
2026-10-29) to that session's last commit (02:29 EDT) was **about 2 hours 23 minutes**. That
covers planning, the engine and proofs, database, API, web client, tests, an independent review
with fixes, an accessibility scan with fixes, Docker/CI, and the docs.

Deployment was a short follow-up the same day, after Railway turned out to be unavailable for a
new account. It ran from the owner's request to use Render (11:31 EDT) to the final deployment
commit (12:31 EDT), **about 60 minutes**. That covers the Render configuration,
migrations at start, the production smoke tests, the live deploy and its verification, the two
proxy-trust fixes, and these docs.

A final audit followed that afternoon, from the owner's request (13:05 EDT) to its last commit
(14:26 EDT), **about 81 minutes**. The redeploy of that commit was verified at 14:32. It covered:

- an independent recomputation of the math, and the comparison of five curve designs;
- an adversarial code review and a live UX audit by two separate agents;
- the fixes listed in [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md);
- a verified redeploy.

A last documentation check (14:38 to 14:41 EDT, **about 2 minutes**) verified these times
against the session log and git history.

The total is **about 4 hours 46 minutes** of agent time. All of the times above come
from the session log and git timestamps. The owner's own time writing the brief and reviewing
the result isn't included; see [`AI_USAGE.md`](AI_USAGE.md) for who did what.

## More

[`docs/MATH.md`](docs/MATH.md) · [`docs/FAIRNESS.md`](docs/FAIRNESS.md) ·
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATABASE.md`](docs/DATABASE.md) ·
[`docs/API.md`](docs/API.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/QA.md`](docs/QA.md) · [`docs/UX_RESEARCH.md`](docs/UX_RESEARCH.md) ·
[`docs/ASSETS.md`](docs/ASSETS.md) · [`AI_USAGE.md`](AI_USAGE.md)
