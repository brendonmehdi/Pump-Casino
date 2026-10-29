# UX Research — Pump-style balloon games

Research input for our original, play-money Pump game (97% RTP, one 25-step hazard curve).
Stake's Pump was the reference product. **We could not observe it directly**, so nearly every
statement about Stake below is secondhand and labelled with its source.

## Method

- **Date:** 2026-10-29.
- **Question:** how do existing Pump-style balloon games handle bet flow, Pump/Cash Out, layout,
  motion, history, fairness, hotkeys, auto-bet, mobile and edge states?
- **Primary tool — REA MCP `capture_browser_scenario` in launch mode.** It ran the local Chrome
  binary headless (reported as Chromium 156.0.8078.48) with a REA-owned temporary profile.
  - Settings: empty storage, service workers blocked, en-US / UTC, dark scheme, reduced motion
    "no-preference".
  - Actions were limited to _navigate, then wait 9 s_. Captures were the accessibility tree and
    final URL, plus frame events on one page.
  - The browser process was terminated after each run.
- **Other REA tools not used:** `inspect_web_page`, `observe_web_session`,
  `inspect_web_event_listeners`, `capture_web_screenshot` and `list_browser_targets` were loaded but
  not used. They attach to an already-running CDP browser, and no target page ever rendered past a
  challenge. We also chose not to attach to the user's personal browser, which could hold
  logged-in sessions.
- **Fallback (allowed by the brief):** WebSearch plus plain WebFetch of public help-centre articles
  and reviews. Everything from these is **secondhand**.
- **Constraints we kept to:**
  - no login, no account and no bets (not even demo bets);
  - no interaction with any challenge;
  - nothing done to get past the check: no VPN or proxy, no mirrors, no locale-variant URLs, no
    header or user-agent changes, no retry in a visible browser window;
  - no private APIs, source code, credentials or protected assets;
  - page content treated as untrusted data;
  - no images saved in the project. This file is the only output.
- **Screenshot:** one 1440x900 screenshot of the stake.com interstitial was captured by REA. REA
  returned it inline as a content-addressed PNG (sha256 `ff94e39a…`). It shows only the
  challenge page and was not saved here.

### Reachability

| URL                                                             | How              | Result                                                                                                                         |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `https://stake.com/casino/games/pump`                           | REA, 1440x900    | **Blocked** — Cloudflare "Performing security verification" interstitial (Ray ID a51f613e1d58ab1c; evidence `ev_b0455eaf3a42`) |
| `https://stake.com/casino/games/pump`                           | REA, 390x844 @3x | **Blocked** — same interstitial (Ray ID a51f63396977fcd9; `ev_3c1ae447870f`)                                                   |
| `https://stake.com/casino/home`                                 | REA, 1440x900    | **Blocked** — same interstitial (Ray ID a51f621d4d8c5905; `ev_6cc52191efc1`)                                                   |
| `https://stake.us/casino/games/pump`                            | REA, 1440x900    | **Blocked** — same interstitial, stake.us branding (Ray ID a51f625ffafe4a29; `ev_cac50cabc4d5`)                                |
| `https://stake.com/provably-fair/implementation`                | WebFetch         | **Blocked** — HTTP 403                                                                                                         |
| `https://stake.com/blog/how-does-the-provably-fair-system-work` | WebFetch         | **Blocked** — HTTP 403                                                                                                         |
| `https://slotcatalog.com/en/slots/pump`                         | REA, 1440x900    | **Blocked** — Cloudflare Turnstile challenge frame (`ev_254a809d4822`); not touched. Reachable via WebFetch (S10)              |
| help.stake.us, help.stake.com, review sites (S1–S12)            | WebFetch         | Reachable                                                                                                                      |

No "not available in your region" page appeared. The bot check always came first, so **regional
availability is unknown**. stake.us was not publicly reachable in this setup, so it produced no
observations.

### Sources (all secondhand)

Official Stake help centres:

- S1 — Stake.us Help, "Provable Fairness": https://help.stake.us/en/articles/7891166-provable-fairness
- S2 — Stake.us Help, "Verifying game results": https://help.stake.us/en/articles/7918826-verifying-game-results
- S3 — Stake.com Help, "Crypto: Casino Betting Limits": https://help.stake.com/en/articles/7979909-crypto-casino-betting-limits
- S4 — Stake.com Help, "Provable Fairness for Stake Original Games". A stub that only links out:
  https://help.stake.com/en/articles/5241133-provable-fairness-for-stake-original-games

Third-party reviews of Stake's Pump:

- S5 — SportsGambler: https://www.sportsgambler.com/sweepstakes-casinos/blog/stake-us-pump-new-feature-explained/
- S6 — Deadspin: https://deadspin.com/sweepstakes-casinos/news/why-you-have-to-try-the-stake-pump-game-free/
- S7 — The Spike (Stake.us Pump): https://www.thespike.gg/reviews/stake-us/pump
- S8 — Strafe: https://www.strafe.com/esports-betting/reviews/stake-us/pump/
- S9 — SportsGrid: https://www.sportsgrid.com/social-casinos/stake-us-pump
- S10 — SlotCatalog: https://slotcatalog.com/en/slots/pump
- S11 — The Spike (Stake Originals overview): https://www.thespike.gg/reviews/stake-com/originals

Other:

- S12 — 2UP help centre, "Pump". This is a _different operator's_ Pump-style game:
  https://intercom.help/support-help-center/en/articles/11796966-pump
- S13 — Search-engine summaries of stake.com blog and provably-fair pages. Those pages returned 403,
  so treat this as **low confidence**.

**Reliability notes.**

- The reviews are short, marketing-flavoured and sometimes contradict each other:
  - Space starts the round vs Space pumps (S5/S6 vs S8);
  - auto-play pump range 1–20 (S7) vs 1–22 (S8);
  - "Medium" vs "Normal" difficulty (S6);
  - different top-multiplier figures (S5/S7/S10 vs S8);
  - release date January 2025 (S5) vs May 2025 (S10).
- Most reviews describe **stake.us**, which uses sweepstakes wording ("play", GC/SC), not stake.com.
- "Not mentioned" below means unknown, not absent.

## 1. Bet controls and state transitions

**Observed**

- Nothing of the game itself. Every REA capture stopped at the interstitial (accessibility tree):
  - an icon, the site name (H1) and "Performing security verification" (H2);
  - one explanatory paragraph;
  - a footer with the Ray ID and two Cloudflare links;
  - no game controls of any kind.

**Assumed / secondhand**

- Pre-round setup: stake amount plus difficulty (Easy / Medium / Hard / Expert) [S5][S7][S9].
- stake.us: the stake is entered in Gold Coins or Stake Cash, with a currency toggle [S5][S8][S9].
- The round starts with a **"Play"** button on stake.us [S5][S6]. The stake.com label is unverified.
- During a round the multiplier starts at 1× [S6]. It rises **only** when the player pumps. There is
  no timer: players go "at your own pace" [S7].
- How a round ends: cashing out wins at the current multiplier. A pop means "Round ends
  immediately" and the stake is lost [S8].
- Implied flow: idle (set stake and difficulty) → Play → in-round (Pump × n) → resolved (cashed out
  or popped) → idle.
- _Inference, not confirmed:_ stake and difficulty are locked during a round, since they are chosen
  "before play" [S5].

## 2. Pump and Cash Out interactions

**Observed**

- Not observable (see §1).

**Assumed / secondhand**

- Pump: "click the button or tap the spacebar" [S5]. Each pump raises the multiplier and the
  cash-out value [S5][S12].
- Cash Out lets the player "opt out" and lock in the current multiplier [S7]. 2UP's game labels the
  button "Cash Out" [S12].
- What is shown: the current multiplier, "a simple number on screen" [S9], shown on the balloon [S6].
- No source mentions any of these:
  - next-pump pop probability;
  - a preview of the next multiplier;
  - a currency amount on the Cash Out button;
  - whether Cash Out is allowed before the first pump.
- Risk grows with each pump. 2UP: "higher probability as pumps increase" [S12]. On Stake, difficulty
  changes both the multipliers and the pop probability [S7].

## 3. Game layout and visual hierarchy (desktop vs mobile)

**Observed**

- Only the interstitial: one centred column, structurally identical at 1440x900 and 390x844. It
  tells us nothing about the game's own layout.

**Assumed / secondhand**

- The balloon is the focal element and shows the multiplier on itself [S6].
- There is a Manual / Auto mode toggle [S6].
- A "Fairness" button sits in the bottom-right corner of the game frame [S5].
- Display modes: default, theatre (enlarged) and a mini-player window [S8].
- Not mentioned: where the control panel sits, information hierarchy, and how the layout changes
  between desktop and mobile.

## 4. Animation timing

**Observed**

- None. No game frame ever rendered.

**Assumed / secondhand**

- The balloon inflates on each pump and pops on a loss [S5]. No source gives durations, easing or
  win effects.
- An animation toggle reportedly switches to a "basic version" [S5].
- Reviewers describe the pacing as building tension [S10]. That is opinion, not timing data.

## 5. History presentation

**Observed**

- None.

**Assumed / secondhand**

- stake.us lists the last 1,000 bets ("game IDs") under My Bets → Casino. Opening one shows its
  verification details [S2].
- No source describes an in-game strip of recent results for Pump.

## 6. Provably-fair / verification interface

**Observed**

- Stake's own provably-fair docs (the implementation page and the blog explainer) returned HTTP 403
  to plain fetch and were not read.

**Assumed / secondhand**

- Inputs [S1]:
  - a client seed, set by the platform by default; the player "can and should change it";
  - a server seed, shown only as a SHA-256 hash while it is active;
  - a nonce that goes up by 1 on each play.
- A search summary of stake.com's implementation page also lists a "cursor" input and HMAC_SHA256
  [S13].
- The unhashed server seed is revealed only after the player **rotates the seed pair**. A seed that is
  still active cannot be verified [S1][S2].
- Verify flow [S1][S2]:
  1. Open My Bets and the bet's game ID.
  2. If the seed pair is still active, rotate it.
  3. Enter the game, unhashed server seed, client seed and nonce into the site's calculator.
  4. Compare the output with the bet result.
     Third-party verifiers are also suggested.
- Stake's help centre names one common mistake: pasting the **hashed** server seed into the
  verifier [S2].
- In the game, a "Fairness" button [S5] opens a panel with a "Verify" tab [S7]. Reviewers mention
  checking "the cryptographic seeds used for each round" [S11].
- How Pump's outcome is derived: not documented in any source we could reach.

## 7. Keyboard controls / hotkeys

**Observed**

- None.

**Assumed / secondhand**

- Pump supports hotkeys [S10].
- Sources conflict: Space pumps [S5][S6], versus Space starts the round and Q pumps [S8].
- Stake's site-wide hotkeys "place a bet, double, halve, or zero bet amounts" and are aimed at
  desktop [S13, low confidence].

## 8. Auto-bet settings

**Observed**

- None.

**Assumed / secondhand**

- Manual / Auto toggle. In Auto, the start button reads "Start Autoplay" [S6].
- Settings: difficulty, pumps per round (1–20 [S7] or 1–22 [S8]), and number of games from 1 to
  infinity [S7].
- If the balloon survives, the round auto-cashes at the set pump count [S7].
- Stop conditions: "Stop on Net Gain" and "Stop on Loss" [S6], also described as "maximum win and
  loss limits" [S5].
- The bet can change after a win or loss [S6]. Stake's other Originals reportedly offer "advanced"
  options to reset or change the bet by a percentage on a win or loss [S13, low confidence].

## 9. Mobile responsiveness

**Observed**

- At 390x844 (DPR 3) the Pump URL returned the same interstitial. No mobile game layout rendered.

**Assumed / secondhand**

- Stake Originals are "totally optimized for mobile" on the mobile site and the app [S11]. This is a
  generic claim with no layout detail.

## 10. Loading, disabled and error states

**Observed**

- The only loading or blocked state we saw was the Cloudflare interstitial (four captures):
  - a full-page holding screen with a one-sentence reason;
  - a support reference code (the Ray ID);
  - no progress indicator in the accessibility tree;
  - it did not clear within about 9 s in the automated browser.
- Plain fetches of stake.com docs returned HTTP 403 with no body. SlotCatalog in REA showed a
  Turnstile challenge frame. We did not interact with either.

**Assumed / secondhand**

- stake.com rejects bets below a minimum of $0.0001 USD equivalent. Max bet and max profit vary by
  currency. What the UI does at the max-profit cap is not documented [S3].
- Known verification error: confusing the hashed and unhashed seed [S2].
- Not mentioned: Pump's disabled states (for example, Cash Out before the first pump), in-flight
  states, or how network errors are handled.

## Open questions (not answerable from available evidence)

- Does Stake show next-pump risk or upcoming multipliers during a round? No source says either way.
- How long are the animations really, and is input blocked during inflate or pop?
- What are the exact enabled/disabled rules for Pump and Cash Out, and what happens on a refresh
  mid-round?
- Where are the controls placed on mobile?

Our own usability testing should answer these for _our_ design, rather than more competitor research.

## Implications for our original design

**Guardrails:** no Stake names, copy, layout, colours or assets, no difficulty modes, and no 98% RTP or
payout tables. Ours is a single 25-step hazard curve (8% → 38% pop chance) at 97% RTP, played with
play money. The takeaways below are interaction patterns, not visual copies.

1. **One primary button in a fixed place, with a label that follows the state.**
   - Idle: "Bet $10.00". In a round: "Pump". While a request is in flight: disabled, with a pending
     label.
   - Pump and Cash Out never move between states, so a quick second tap can't land on a different
     action.
2. **Cash Out shows money, not only a multiplier.**
   - Label it with the exact floored payout, e.g. "Cash out $10.54" after one pump on a $10 bet.
   - Before the first pump, keep it visible but disabled, with an inline reason ("Pump once to
     unlock cash out"). This mirrors the server's `CASHOUT_REQUIRES_PUMP` rule.
3. **Show the next pump's risk and reward right beside the Pump button.**
   - Example after the first pump: "Next pump: 9.25% pop · 1.16×".
   - Read the values from the same rules table the engine uses (F2).
   - No source shows Stake exposing this, so it sets our game apart on transparency.
4. **Make the single curve easy to read, instead of offering difficulty modes.**
   - The Pressure Ladder takes the place Stake gives to a pre-round difficulty picker.
   - Show 25 rungs as completed / current / next, each with its multiplier, payout and pop chance,
     plus "N pumps left".
   - Rung 25 cashes out automatically, with its own "top reached" state at 794.01×.
5. **Lock round settings visibly, and restore the round after a refresh.**
   - Once a round starts, the bet amount and auto settings become read-only (still shown, not
     hidden).
   - A refresh restores the round from the server (`GET /api/pump/current`) with a "Round restored"
     notice, instead of dropping back to idle.
6. **Animate anticipation, never the outcome.**
   - Start a short inflate cue on press.
   - Advance the multiplier, the ladder rung and the Cash Out amount only after the server confirms
     the balloon survived.
   - Show the pop and the loss together.
   - Targets: pump feedback ≤ 200 ms, pop ≤ 600 ms. Decorative animation must never delay the next
     allowed action. These are our targets, not measurements of Stake.
7. **Treat reduced motion as a first-class mode.**
   - Honour `prefers-reduced-motion`, and add an in-game "Reduce animations" toggle (Stake.us
     reportedly has one [S5]).
   - In reduced mode, inflate and pop become instant state changes, with text and sound cues.
8. **Keyboard: each key does one thing, with safeguards.**
   - Space = Pump, Enter = Cash Out, Esc = close or cancel.
   - Ignore held-key repeats (`event.repeat`) and any key press while an input or dialog has focus.
     Show a hotkey legend.
   - Space and Enter must never also start a round. If keyboard betting is added, give it its own key
     and a ~500 ms lockout after each round, so a late Pump or Cash Out press can't place a new bet.
   - Reviewers disagree on what Space does in Stake's Pump [S5][S8]. That ambiguity is what we avoid.
9. **Auto-bet: use terms players understand, and always set a limit.**
   - Stake's auto-play reportedly works in "pumps per round" and allows unlimited games [S7].
   - Ours takes a target multiplier, snapped to a ladder rung. Show that rung's pump number and the
     chance of reaching it, which is the survival probability S(n) from the curve.
   - Require a maximum number of rounds (no ∞ option).
   - Stop on profit, stop on loss, and stop when the balance is too low.
   - Keep Pause and Stop always visible. When auto-bet stops, show why ("Stopped: loss limit
     reached") and a session summary.
10. **Verification one click from history, with no seed rotation.**
    - Stake.us makes players rotate their seed pair before they can verify, and warns about pasting
      the hashed seed [S2]. Our per-round commitment allows a simpler flow:
    - Show the commitment hash before the first pump, and reveal the seed when the round ends.
    - Link every history row to a pre-filled `/verify/:roundId` that recomputes the result in the
      browser.
    - Label the fields clearly: "Commitment (SHA-256)" vs "Revealed server seed".
    - If someone pastes the commitment into the seed field, detect it and tell them.
11. **History rows that explain themselves.**
    - Show the last 10 rounds on the game screen itself, not on a separate page like Stake.us's My
      Bets [S2].
    - Each row gives the outcome as text plus an icon, never colour alone: "Cashed out · pump N · M× ·
      +$P" or "Popped · pump N · −$S". Each row links to verify.
    - Announce new results through an `aria-live` region.
12. **Honest pending, error and reconnect states.**
    - Never show a result the server hasn't confirmed (F4).
    - While a request is in flight, ignore extra presses rather than queueing them.
    - If the network drops, keep the round on screen, show "Reconnecting…", retry with the same
      idempotency key, then sync with the server.
    - Error messages should say what happened to the money and include a short reference ID. This is
      the one pattern we actually observed in this research (the Ray ID on the block page).
13. **Mobile: actions within thumb reach, with buttons kept apart.**
    - At about 390 px wide, put the balloon and multiplier at the top.
    - Pin Pump and Cash Out to the bottom, inside the safe-area insets. Make targets at least 44 px,
      with a clear gap between them.
    - Collapse the ladder into a horizontal strip that keeps the next rung's risk visible.
    - Put no information behind hover.
14. **Make limits and play money obvious.**
    - Show the $0.10–$1,000 bet limits at the input, and validate inline before submit.
    - Label every balance as play money.
    - Stake documents its caps but not what the UI does at them [S3]. Ours states plainly that the
      top rung (794.01×) cashes out automatically, so the 1,000× cap is never reached.
