import { describe, expect, it } from 'vitest';
import {
  PUMP_RULES_V1,
  PUMP_V1,
  buildRuleSet,
  compareRatios,
  formatRatioFloor,
  ladderStep,
  meetsAutoCashoutTarget,
  payoutCents,
  ratio,
  type PumpRules,
} from '../src';

describe('v1 hazard curve', () => {
  it('starts at 8% and rises 1.25 points per pump to 38% on pump 25', () => {
    const expected = Array.from({ length: 25 }, (_, i) => 800 + 125 * i);
    expect(PUMP_RULES_V1.popBasisPoints).toEqual(expected);
    expect(ladderStep(PUMP_V1, 1).popBasisPoints).toBe(800);
    expect(ladderStep(PUMP_V1, 10).popBasisPoints).toBe(1925);
    expect(ladderStep(PUMP_V1, 20).popBasisPoints).toBe(3175);
    expect(ladderStep(PUMP_V1, 25).popBasisPoints).toBe(3800);
  });

  it('derives the multiplier ladder exactly (values floored to 6 dp)', () => {
    // prettier-ignore
    const expected = [
      '1.054347', '1.161815', '1.298118', '1.470955', '1.690753',
      '1.971724', '2.333401', '2.802884', '3.418151', '4.233005',
      '5.324534', '6.804517', '8.837035', '11.666053', '15.659132',
      '21.377655', '29.691187', '41.966343', '60.383227', '88.473593',
      '132.050139', '200.836714', '311.374751', '492.292096', '794.019510',
    ];
    expect(PUMP_V1.ladder.map((step) => formatRatioFloor(step.multiplier, 6))).toEqual(expected);
  });

  it('strictly increases the multiplier and keeps every rung at or below 1,000×', () => {
    const cap = ratio(PUMP_RULES_V1.maxMultiplier, 1n);
    PUMP_V1.ladder.forEach((step, index) => {
      expect(compareRatios(step.multiplier, cap)).toBeLessThanOrEqual(0);
      const previous = PUMP_V1.ladder[index - 1];
      if (previous) expect(compareRatios(step.multiplier, previous.multiplier)).toBe(1);
    });
  });

  it('reaches the 25-pump limit before the 1,000× limit', () => {
    expect(PUMP_V1.ladder).toHaveLength(25);
    expect(formatRatioFloor(ladderStep(PUMP_V1, 25).multiplier, 2)).toBe('794.01');
  });
});

describe('exact RTP proof', () => {
  it('S(n) × M(n) is exactly 97/100 at every one of the 25 cash-out points', () => {
    for (const step of PUMP_V1.ladder) {
      const { survival, multiplier } = step;
      // (sN/sD)·(mN/mD) = 97/100  ⇔  sN·mN·100 = 97·sD·mD
      expect(survival.numerator * multiplier.numerator * 100n).toBe(
        97n * survival.denominator * multiplier.denominator,
      );
    }
  });

  it('S(n) is the product of the per-pump survival chances', () => {
    let numerator = 1n;
    let denominator = 1n;
    for (const step of PUMP_V1.ladder) {
      numerator *= 10_000n - BigInt(step.popBasisPoints);
      denominator *= 10_000n;
      expect(compareRatios(step.survival, ratio(numerator, denominator))).toBe(0);
    }
  });

  it('floors every payout: expected return never exceeds 97% for ANY permitted bet at ANY step', () => {
    // Exhaustive: every cent amount from $0.10 to $1,000.00 at all 25 steps (2.5M cases).
    const violations: string[] = [];
    // Worst effective RTP (parts per million, floored) over all bets, and over bets ≥ $1 / ≥ $10.
    const tiers = [10n, 100n, 1_000n];
    const worst = tiers.map(() => ({ bet: 0n, pump: 0, rtpPpm: 1_000_000n }));
    for (const step of PUMP_V1.ladder) {
      const { survival, multiplier } = step;
      for (let bet = PUMP_RULES_V1.minBetCents; bet <= PUMP_RULES_V1.maxBetCents; bet += 1n) {
        const payout = payoutCents(PUMP_V1, bet, step.pump);
        const exact = bet * multiplier.numerator; // bet·M(n), scaled by M's denominator
        // The most whole cents that don't exceed bet·M(n): one more cent would pay over 97%.
        const isFloor =
          payout * multiplier.denominator <= exact &&
          (payout + 1n) * multiplier.denominator > exact;
        // S(n)·payout ≤ 0.97·bet  ⇔  sN·payout·100 ≤ 97·bet·sD
        const withinRtp = survival.numerator * payout * 100n <= 97n * bet * survival.denominator;
        if (!isFloor || !withinRtp) violations.push(`${bet.toString()}¢ @ pump ${step.pump}`);
        const rtpPpm = (survival.numerator * payout * 1_000_000n) / (survival.denominator * bet);
        tiers.forEach((minimum, index) => {
          const current = worst[index];
          if (current && bet >= minimum && rtpPpm < current.rtpPpm) {
            worst[index] = { bet, pump: step.pump, rtpPpm };
          }
        });
      }
    }
    expect(violations).toEqual([]);
    // Pinned to the independent Python reference (tools/rtp_analysis.py) and docs/MATH.md:
    expect(worst).toEqual([
      // Overall: the minimum bet on pump 3, 12¢ back where 12.98¢ was due, 89.67%.
      { bet: 10n, pump: 3, rtpPpm: 896_682n },
      // Bets of $1 or more: $1.10 on pump 1 pays $1.15 of $1.1597…, 96.18%.
      { bet: 110n, pump: 1, rtpPpm: 961_818n },
      // Bets of $10 or more: $10.30 on pump 1, 96.91%.
      { bet: 1_030n, pump: 1, rtpPpm: 969_126n },
    ]);
  });

  it.each([
    [10n, 3, 896_682n],
    [11n, 2, 910_800n],
    [25n, 4, 949_586n],
    [50n, 3, 956_461n],
    [100n, 3, 963_933n],
    [1_000n, 2, 969_318n],
    [10_000n, 1, 969_956n],
    [100_000n, 1, 969_992n],
  ])('the worst point for a %s¢ bet matches the reference (pump %i, %i ppm)', (bet, pump, ppm) => {
    const rtps = PUMP_V1.ladder.map((step) => {
      const payout = payoutCents(PUMP_V1, bet, step.pump);
      return (step.survival.numerator * payout * 1_000_000n) / (step.survival.denominator * bet);
    });
    const lowest = rtps.reduce((min, value) => (value < min ? value : min));
    expect([rtps.indexOf(lowest) + 1, lowest]).toEqual([pump, ppm]);
  });

  it('documents the cent-rounding loss for the $0.10 minimum bet', () => {
    const bet = 10n;
    const effectiveRtpPercent = PUMP_V1.ladder.map((step) => {
      const payout = payoutCents(PUMP_V1, bet, step.pump);
      const rtp = ratio(step.survival.numerator * payout * 100n, step.survival.denominator * bet);
      return formatRatioFloor(rtp, 4);
    });
    // Pump 1: 10¢ × 1.0543… = 10.54¢ → floored to 10¢, so the return is 0.92 × 10/10 = 92%.
    // The loss shrinks as the multiplier grows, because one lost cent is a smaller fraction.
    // prettier-ignore
    expect(effectiveRtpPercent).toEqual([
      '92.0000', '91.8390', '89.6682', '92.3209', '91.7933',
      '93.4714', '95.6115', '96.9001', '96.4848', '96.2436',
      '96.5530', '96.9356', '96.5934', '96.4507', '96.6337',
      '96.6476', '96.7020', '96.8466', '96.8663', '96.9193',
      '96.9631', '96.9822', '96.9767', '96.9818', '96.9976',
    ]);
  });

  it('pays the theoretical amount to the cent for large bets', () => {
    expect(payoutCents(PUMP_V1, 100_000n, 1)).toBe(105_434n); // $1,000 × 1.054347… = $1,054.34
    expect(payoutCents(PUMP_V1, 100_000n, 25)).toBe(79_401_951n); // $1,000 × 794.0195…
  });
});

describe('auto cash-out target comparison', () => {
  it('compares the exact multiplier against a target in hundredths', () => {
    const pump7 = ladderStep(PUMP_V1, 7).multiplier; // 2.3334…
    expect(meetsAutoCashoutTarget(pump7, 233n)).toBe(true);
    expect(meetsAutoCashoutTarget(pump7, 234n)).toBe(false);
    expect(meetsAutoCashoutTarget(ratio(2n, 1n), 200n)).toBe(true);
  });
});

describe('rule validation', () => {
  const withRules = (patch: Partial<PumpRules>) => () =>
    buildRuleSet({ ...PUMP_RULES_V1, ...patch });

  it('rejects schedules that are not strictly increasing', () => {
    expect(withRules({ popBasisPoints: Array.from({ length: 25 }, () => 1000) })).toThrow(
      /strictly increase/,
    );
  });

  it('rejects pop chances of 0% or 100%', () => {
    const schedule = [...PUMP_RULES_V1.popBasisPoints];
    schedule[24] = 10_000;
    expect(withRules({ popBasisPoints: schedule })).toThrow(/strictly between/);
    expect(withRules({ popBasisPoints: [0, ...schedule.slice(1)] })).toThrow(/strictly between/);
  });

  it('rejects a schedule whose length does not match the ladder', () => {
    expect(withRules({ popBasisPoints: PUMP_RULES_V1.popBasisPoints.slice(1) })).toThrow(
      /exactly maxPumps/,
    );
  });

  it('rejects a ladder that would pass 1,000× before the last pump', () => {
    const steep = Array.from({ length: 25 }, (_, i) => 2000 + 100 * i);
    expect(withRules({ popBasisPoints: steep })).toThrow(/exceeds 1000×/);
  });

  it('rejects an RTP above 100%', () => {
    expect(withRules({ rtp: ratio(101n, 100n) })).toThrow(/RTP/);
  });

  it('rejects inconsistent bet and auto cash-out limits', () => {
    expect(withRules({ minBetCents: 0n })).toThrow(/Bet limits/);
    expect(withRules({ minAutoCashoutHundredths: 100n })).toThrow(/Auto cash-out/);
  });
});
