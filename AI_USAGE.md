# AI usage

## Who did what

The repository owner wrote the product brief: the assignment's requirements expanded into a
detailed specification (stack, hazard curve, fairness protocol, database design, bonus
features). **Claude Code (model: Claude Opus 5.5)** then did the work autonomously in one
session: it planned, wrote all of the code, tests and documentation in this repository, ran the
tests and committed incrementally. Later the same day, in a short follow-up, the owner asked for
the deployment to move from Railway to Render. Claude Code adapted the configuration, deployed
through the owner's logged-in Render dashboard and verified the live service. The owner reviews
the result and owns the decisions in it.

| Tool                                    | Used for                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Opus 5.5)           | Planning, code, tests, docs, git; driving the tools below                                                                                                                                                                             |
| REA (MCP)                               | Attempted UX research on Stake's public Pump page. Every page stopped at a Cloudflare bot check, which was not bypassed, so `docs/UX_RESEARCH.md` is labelled secondhand. A sub-agent ran this research.                              |
| Higgsfield (MCP)                        | Read-only evaluation of its game/website builder and the account balance. Not used: see `docs/ASSETS.md`. No credits were spent.                                                                                                      |
| Claude Code sub-agent (review)          | A fresh agent did a read-only adversarial review of the finished code. Its findings and fixes are in `docs/QA.md` (Independent review).                                                                                               |
| Playwright                              | The E2E suite, plus screenshots for visual review                                                                                                                                                                                     |
| Claude in Chrome                        | Tried for visual review; screenshots timed out (the browser window was likely minimised), so Playwright was used instead                                                                                                              |
| Docker, GitHub CLI                      | Local PostgreSQL, production image check, pushing and watching CI                                                                                                                                                                     |
| Claude Code sub-agent (research)        | Read Render's current documentation (free-plan limits, Blueprint spec, ports, private network, proxy headers) and reported sources and gaps. Undocumented points, such as the client-IP chain, were then measured on the live service |
| Render dashboard (via Claude in Chrome) | Applied the Blueprint, approved the Blueprint syncs, restarted the service and read logs. This used the owner's logged-in browser session; no credentials were handled and only free plans were selected                              |

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
