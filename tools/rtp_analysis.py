#!/usr/bin/env python3
"""
Exact RTP analysis for Pump, independent of the TypeScript engine (Python standard library only).

For the shipped curve (pump-v1) and each alternative considered in docs/MATH.md, it computes:
- the theoretical RTP of every cash-out point, as an exact fraction;
- the effective RTP of every permitted bet ($0.10 to $1,000 in whole cents) at every point,
  after paying whole cents.

The shipped rule pays floor(bet × multiplier). Every comparison against 97% is exact (integer
cross-multiplication); only the reported means and percentages are rounded for display.

Usage: python tools/rtp_analysis.py            (about a minute; prints Markdown tables)
"""
from fractions import Fraction as F
import math
import sys

RTP = F(97, 100)
MIN_BET, MAX_BET = 10, 100_000
PUMPS, CAP = 25, 1000
SPOTLIGHT = [10, 11, 25, 50, 100, 1_000, 10_000, 100_000]


def floor_to(value, step):
    return F(math.floor(value / step)) * step


def from_basis_points(basis_points):
    survival, s = [], F(1)
    for bp in basis_points:
        s *= F(10_000 - bp, 10_000)
        survival.append(s)
    return [F(bp, 10_000) for bp in basis_points], survival, [RTP / s for s in survival]


def from_multipliers(multipliers):
    pops, previous = [], RTP  # M(0) = RTP, so that S(0) = RTP / M(0) = 1
    for m in multipliers:
        pops.append(1 - previous / m)
        previous = m
    return pops, [RTP / m for m in multipliers], list(multipliers)


def grid_ladder(step, targets):
    """Multipliers on a fixed grid (e.g. 0.1), never-decreasing risk, closest to `targets`."""
    multipliers, previous, previous_pop = [], RTP, F(0)
    for target in targets:
        g = floor_to(previous / (1 - target), step)
        best = None
        for _ in range(200):
            if g > previous:
                pop = 1 - previous / g
                if pop >= previous_pop and (best is None or abs(pop - target) < abs(best[1] - target)):
                    best = (g, pop)
                if best is not None and pop > target:
                    break
            g += step
        multipliers.append(best[0])
        previous, previous_pop = best
    return multipliers


def tuned_basis_points(grid_multipliers):
    """Integer basis points whose exact multiplier lands at or just above each grid value."""
    basis_points, multiplier, previous_bp = [], RTP, 0
    for g in grid_multipliers:
        bp = math.ceil(10_000 * (1 - multiplier / g))
        bp = max(bp, previous_bp + 1)  # the engine requires strictly rising pop chances
        multiplier = multiplier * F(10_000, 10_000 - bp)
        basis_points.append(bp)
        previous_bp = bp
    return basis_points


def design(key, name, rng, pops, survival, multipliers, paid=None):
    return {
        "key": key,
        "name": name,
        "rng": rng,
        "pops": pops,
        "survival": survival,
        "multipliers": multipliers,
        "paid": paid or multipliers,  # multiplier actually applied to the bet before flooring
    }


def analyse(d):
    points = []
    for s, m, paid in zip(d["survival"], d["multipliers"], d["paid"]):
        points.append((s, m, paid.numerator, paid.denominator))
    theory_exact = all(s * m == RTP for s, m, _, _ in points)
    pricing = [s * F(pn, pd) for s, _, pn, pd in points]  # RTP before cent rounding
    # Effective RTP of bet b at point n = S(n) × floor(b × paid) / b.
    worst = None  # (rtp Fraction, bet, pump)
    worst_from = {100: None, 1_000: None, 10_000: None}
    over = 0
    total = 0.0
    spot = {b: [] for b in SPOTLIGHT}
    for pump, (s, _, pn, pd) in enumerate(points, start=1):
        sn, sd = s.numerator, s.denominator
        for bet in range(MIN_BET, MAX_BET + 1):
            payout = bet * pn // pd
            # rtp = sn·payout / (sd·bet); never over: sn·payout·100 <= 97·sd·bet
            if sn * payout * 100 > 97 * sd * bet:
                over += 1
            if worst is None or sn * payout * worst[0].denominator < worst[0].numerator * sd * bet:
                worst = (F(sn * payout, sd * bet), bet, pump)
            for floor_bet in worst_from:
                if bet >= floor_bet:
                    current = worst_from[floor_bet]
                    if current is None or sn * payout * current[0].denominator < current[0].numerator * sd * bet:
                        worst_from[floor_bet] = (F(sn * payout, sd * bet), bet, pump)
            total += (sn * payout) / (sd * bet)
            if bet in spot:
                spot[bet].append(F(sn * payout, sd * bet))
    pairs = PUMPS * (MAX_BET - MIN_BET + 1)
    return {
        "theory_exact": theory_exact,
        "pricing_min": min(pricing),
        "over": over,
        "worst": worst,
        "worst_from": worst_from,
        "mean": total / pairs,
        "spot": spot,
    }


def pct(x, digits=2):
    return f"{100 * float(x):.{digits}f}%"


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Markdown tables use ×, →, ≥
    shipped_bp = [800 + 125 * i for i in range(PUMPS)]
    a = design("A", "Shipped pump-v1: linear hazard 8%→38%, exact multipliers", "basis points (current)",
               *from_basis_points(shipped_bp))
    two_dp = [floor_to(m, F(1, 100)) for m in a["multipliers"]]
    b = design("B", "Two-decimal multipliers (exact 1.05×, 1.16×, …), pop chances derived", "rational thresholds (new)",
               *from_multipliers(two_dp))
    # C and D: a 0.1× grid makes every multiple-of-10¢ bet exact. Following the shipped hazard on
    # that grid overshoots 1,000× by pump 25, so the last pump's target is lowered (in 0.5-point
    # steps) until all 25 rungs fit under the cap.
    for final in range(380, 150, -5):
        hazard = [F(800, 10_000) + (F(final, 1_000) - F(800, 10_000)) * i / (PUMPS - 1) for i in range(PUMPS)]
        tenths = grid_ladder(F(1, 10), hazard)
        if max(tenths[-1], from_basis_points(tuned_basis_points(tenths))[2][-1]) <= CAP:
            break
    c = design("C", "One-decimal multipliers (1.1×, 1.3×, …), pop chances derived", "rational thresholds (new)",
               *from_multipliers(tenths))
    tuned = tuned_basis_points(tenths)
    d = design("D", "Basis points tuned so multipliers sit just above C's", "basis points (same mechanism)",
               *from_basis_points(tuned))
    e = design("E", "Shipped curve, but paying the displayed 2-dp multiplier", "basis points (current)",
               a["pops"], a["survival"], a["multipliers"], paid=two_dp)
    designs = [a, b, c, d, e]

    print("## Shipped ladder (pump-v1), recomputed\n")
    print("| Pump | Pop chance | Survival S(n) | Multiplier M(n) | Shown | S(n)·M(n) |")
    print("| ---: | ---: | ---: | ---: | ---: | :---: |")
    for n, (p, s, m) in enumerate(zip(a["pops"], a["survival"], a["multipliers"]), start=1):
        shown = floor_to(m, F(1, 100))
        print(f"| {n} | {pct(p)} | {float(s):.6f} | {float(m):.6f} | {float(shown):.2f}× | {'= 97/100' if s * m == RTP else 'WRONG'} |")

    for x in designs:
        x["result"] = analyse(x)

    print("\n## Designs compared (all 99,991 bets × 25 points, exact)\n")
    print("| | Design | Sampler | Pop chances | Rising? | M(25) | Theory exactly 97%? | Any point over 97%? | Worst effective RTP (bet, pump) | Worst, bets ≥ $1 | Worst, bets ≥ $10 | Mean over all bets & points |")
    print("| - | - | - | - | - | - | - | - | - | - | - | - |")
    for x in designs:
        r = x["result"]
        pops = x["pops"]
        rising = all(later > earlier for earlier, later in zip(pops, pops[1:]))
        non_decreasing = all(later >= earlier for earlier, later in zip(pops, pops[1:]))
        worst, bet, pump = r["worst"]
        w100 = r["worst_from"][100]
        w1000 = r["worst_from"][1_000]
        theory = "yes" if r["theory_exact"] and x["paid"] is x["multipliers"] else f"no (pricing ≥ {pct(r['pricing_min'], 3)})"
        print(
            f"| {x['key']} | {x['name']} | {x['rng']} | {pct(pops[0], 1)} → {pct(pops[-1], 1)} | "
            f"{'strictly' if rising else ('never falls' if non_decreasing else 'NO')} | {float(x['multipliers'][-1]):.2f}× | {theory} | "
            f"{'no' if r['over'] == 0 else r['over']} | {pct(worst)} (${bet / 100:.2f}, {pump}) | "
            f"{pct(w100[0])} (${w100[1] / 100:.2f}, {w100[2]}) | {pct(w1000[0], 3)} (${w1000[1] / 100:.2f}, {w1000[2]}) | {100 * r['mean']:.4f}% |"
        )

    print("\n## Effective RTP of specific bets: worst / mean over the 25 cash-out points\n")
    print("| Bet | " + " | ".join(x["key"] for x in designs) + " |")
    print("| ---: | " + " | ".join("---:" for _ in designs) + " |")
    for bet in SPOTLIGHT:
        cells = []
        for x in designs:
            values = x["result"]["spot"][bet]
            mean = sum(values) / len(values)
            cells.append(f"{pct(min(values))} / {pct(mean, 3)}")
        print(f"| ${bet / 100:,.2f} | " + " | ".join(cells) + " |")

    print("\n## Alternative ladders\n")
    for x in designs[1:4]:
        print(f"- **{x['key']}** multipliers: " + ", ".join(f"{float(m):.2f}" for m in x["multipliers"]))
        print(f"  pop chances: " + ", ".join(pct(p, 1) for p in x["pops"]))
    print(f"- **D** basis points: {tuned}")


if __name__ == "__main__":
    main()
