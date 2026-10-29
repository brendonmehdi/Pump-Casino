# AI usage

## Who did what

The repository owner wrote the product brief: the assignment's requirements expanded into a
detailed specification (stack, hazard curve, fairness protocol, database design, bonus
features). **Claude Code (model: Claude Opus 5.5)** then did the work autonomously in one
session: it planned, wrote all of the code, tests and documentation in this repository, ran the
tests and committed incrementally. Later the same day, in a short follow-up, the owner asked for
the deployment to move from Railway to Render. Claude Code adapted the configuration, deployed
through the owner's logged-in Render dashboard and verified the live service.

A final audit followed, which the owner asked for:

- an independent recomputation of the mathematics in Python;
- an adversarial review by a separate agent;
- a live UX audit by another agent;
- fixes for what they found ([`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md)).

The owner reviews the result and owns the decisions in it.

**About the history.** Every commit is a real, separate change. A few were made in quick
succession from work that was already staged, so some share a timestamp (for example, five
commits at 01:03:33).

| Tool                                    | Used for                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Opus 5.5)           | Planning, code, tests, docs, git; driving the tools below                                                                                                                                                                                             |
| REA (MCP)                               | Attempted UX research on Stake's public Pump page. Every page stopped at a Cloudflare bot check, which was not bypassed, so `docs/UX_RESEARCH.md` is labelled secondhand. A sub-agent ran this research.                                              |
| Higgsfield (MCP)                        | Read-only evaluation of its game/website builder and the account balance. Not used: see `docs/ASSETS.md`. No credits were spent.                                                                                                                      |
| Claude Code sub-agent (review)          | A fresh agent did a read-only adversarial review of the finished code. Its findings and fixes are in `docs/QA.md` (Independent review).                                                                                                               |
| Playwright                              | The E2E suite, plus screenshots for visual review                                                                                                                                                                                                     |
| Claude in Chrome                        | Tried for visual review; screenshots timed out (the browser window was likely minimised), so Playwright was used instead                                                                                                                              |
| Docker, GitHub CLI                      | Local PostgreSQL, production image check, pushing and watching CI                                                                                                                                                                                     |
| Claude Code sub-agent (research)        | Read Render's current documentation (free-plan limits, Blueprint spec, ports, private network, proxy headers) and reported sources and gaps. Undocumented points, such as the client-IP chain, were then measured on the live service                 |
| Render dashboard (via Claude in Chrome) | Applied the Blueprint, approved the Blueprint syncs, restarted the service and read logs. This used the owner's logged-in browser session; no credentials were handled and only free plans were selected                                              |
| Claude Code sub-agents (final audit)    | One reviewed the code adversarially: recomputed the math, stress-tested concurrency on a scratch database, and wrote a fairness proof of concept. Another played the live site on desktop and phones. Findings and fixes are in `docs/FINAL_AUDIT.md` |
| Python (standard library)               | `tools/rtp_analysis.py`: an independent, exact recomputation of every bet's return, and the comparison of alternative curves                                                                                                                          |

**Inspiration vs implementation.** The Stake research shaped interaction rules only, such as
"show next-pump risk beside the button" and "one meaning per hotkey". The visual design,
curve, copy and code are original. No Stake assets, text or code were used.

## How correctness was checked (not just generated)

The brief's numbers were not trusted. Before any code, the proposed curve was recomputed with
exact BigInt arithmetic, and the tests now assert every multiplier. Beyond the usual test
suites:

- **Exact proof** of S(n)·M(n) = 97/100 at all 25 points, using integer equality.
- **Exhaustive sweep** of all 2.5 million (bet, pump) pairs for flooring and the 97% ceiling.
- **Mutation checks:** rounding half-up and removing database locks, to prove the tests fail
  when the code is wrong (`docs/QA.md`).
- **Independent implementations.** Test vectors were generated with Node's `node:crypto` and
  reproduced by the engine's `@noble/hashes`. A dependency-free Node verifier and a Python
  stdlib verifier were written from the spec alone and agree with the engine.
- **Real PostgreSQL concurrency tests**, and **E2E on three browser profiles** in CI.

## One real mistake, caught

**Misreading a library API.** To rate-limit only the _creation_ of new players, the code used
`@fastify/rate-limit`'s `createRateLimit()` and rejected the request when the result had
`isAllowed: false`. That field actually means "not on the allow-list"; whether the limit is
exceeded is a separate `isExceeded` flag. As written, **every** new player was rejected with 429. The bug passed type-checking and looked plausible. It was caught on the first manual
end-to-end run (`curl POST /api/session` returned `RATE_LIMITED` on a fresh server), confirmed
against the plugin's README, and fixed to `!isAllowed && isExceeded`. A test now asserts that
the third session is limited and the first two are not.

**A second one, caught by an independent agent.** The first session wrote "the server cannot
pick your outcome" into the fairness panel and the docs. The independent review in the final
audit showed it wasn't true as built. The app reused the player's client seed every round, and
the server fixes the next round's seed in the same request that delivers the current one. So a
dishonest server could have searched for a next seed that pops early; the reviewer's proof of
concept did it in about 11 tries. The app now picks a fresh client seed after every bet, and the
claims were corrected (`docs/FINAL_AUDIT.md`, finding 1). The lesson: the code was correct, but
a claim about it needed an attack, not a reading.

Other defects found by the tests during development, such as a Zod refinement that crashed on
malformed bets and two WebKit-only failures, are listed in `docs/QA.md`.

**A deployment assumption, measured and corrected.** The first Render configuration trusted
`uniquelocal` as the proxy range, on the assumption that Render's proxy connects from a private
address. It looked right and passed every functional check. Marked test requests on the live
service showed otherwise: the app saw `127.0.0.1` for everyone, so all visitors shared one
rate-limit bucket. With loopback trusted, it then saw a Cloudflare edge address that changed on
every request. Trusting Cloudflare's published ranges fixed it. The live logs now show the
visitor's own address, and forged headers are still ignored. A test replays the measured chain
(`docs/DEPLOYMENT.md`).

## Limitations of the assistance

- An agent can produce plausible code faster than it can verify it. Everything above exists
  because nothing was accepted on appearance, but the test suites define what was checked;
  they don't prove the absence of every bug.
- The UX research is secondhand, because the real product couldn't be observed.
- The written hours (README) are the agent session's wall-clock time, not hours of human
  engineering.
