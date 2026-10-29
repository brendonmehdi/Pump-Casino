import { compareRatios, floorMultiply, ratio, type Ratio } from './ratio';

/**
 * Every number that defines the game. Rules are versioned: changing any value changes outcomes
 * and payouts, so it must ship as a new version (rounds record the version they were played on).
 */
export interface PumpRules {
  readonly version: 'pump-v1';
  /** Return to player as an exact fraction. */
  readonly rtp: Ratio;
  /**
   * Probabilities are integers out of this scale (basis points). It is also the range of the
   * fairness sampler, so every pop chance is exactly representable.
   */
  readonly probabilityScale: number;
  /** popBasisPoints[n - 1] is the chance that pump n pops, for n = 1..maxPumps. */
  readonly popBasisPoints: readonly number[];
  /** Ladder length. Surviving the last pump cashes out automatically. */
  readonly maxPumps: number;
  /** No rung of the ladder may pay more than this multiple of the bet. */
  readonly maxMultiplier: bigint;
  readonly minBetCents: bigint;
  readonly maxBetCents: bigint;
  /** Allowed auto cash-out targets, in hundredths of a multiplier (101n = 1.01×). */
  readonly minAutoCashoutHundredths: bigint;
  readonly maxAutoCashoutHundredths: bigint;
  /** An unresolved round is forfeited this long after it starts. */
  readonly roundTtlMs: number;
}

/** One rung of the ladder: the state reached after surviving `pump` pumps. */
export interface LadderStep {
  readonly pump: number;
  /** Chance that this pump pops, out of `probabilityScale`. */
  readonly popBasisPoints: number;
  /** Probability of surviving pumps 1..pump: S(n) = Π (1 − p_i). */
  readonly survival: Ratio;
  /** Exact multiplier for cashing out here: M(n) = RTP / S(n). */
  readonly multiplier: Ratio;
}

/** Validated rules plus the exact ladder derived from them. */
export interface RuleSet {
  readonly rules: PumpRules;
  readonly ladder: readonly LadderStep[];
}

const BASIS_POINTS = 10_000;
const FIRST_PUMP_POP_BASIS_POINTS = 800; // 8.00% on pump 1
const POP_BASIS_POINTS_PER_PUMP = 125; // +1.25 percentage points per pump → 38.00% on pump 25
const LADDER_PUMPS = 25;
const HOURS_24_MS = 24 * 60 * 60 * 1000;

export const PUMP_RULES_V1: PumpRules = {
  version: 'pump-v1',
  rtp: ratio(97n, 100n),
  probabilityScale: BASIS_POINTS,
  popBasisPoints: Array.from(
    { length: LADDER_PUMPS },
    (_, index) => FIRST_PUMP_POP_BASIS_POINTS + POP_BASIS_POINTS_PER_PUMP * index,
  ),
  maxPumps: LADDER_PUMPS,
  maxMultiplier: 1000n,
  minBetCents: 10n, // $0.10
  maxBetCents: 100_000n, // $1,000.00
  minAutoCashoutHundredths: 101n, // 1.01×
  maxAutoCashoutHundredths: 100_000n, // 1,000.00×
  roundTtlMs: HOURS_24_MS,
};

/**
 * Validates a rule set and derives its exact ladder. Throws on any inconsistency: rules are
 * static configuration, so an invalid set is a programming error caught at module load and in
 * tests, never at play time.
 */
export function buildRuleSet(rules: PumpRules): RuleSet {
  assertRules(rules);
  const scale = BigInt(rules.probabilityScale);
  const ladder: LadderStep[] = [];
  let survivalNumerator = 1n;
  let survivalDenominator = 1n;
  for (const [index, popBasisPoints] of rules.popBasisPoints.entries()) {
    survivalNumerator *= scale - BigInt(popBasisPoints);
    survivalDenominator *= scale;
    ladder.push({
      pump: index + 1,
      popBasisPoints,
      survival: ratio(survivalNumerator, survivalDenominator),
      // RTP / S(n) = (rtpN / rtpD) / (sN / sD) = (rtpN · sD) / (rtpD · sN)
      multiplier: ratio(
        rules.rtp.numerator * survivalDenominator,
        rules.rtp.denominator * survivalNumerator,
      ),
    });
  }
  const cap = ratio(rules.maxMultiplier, 1n);
  const overCap = ladder.find((step) => compareRatios(step.multiplier, cap) > 0);
  if (overCap) {
    // The PDF ends the ladder at 25 pumps or 1,000×, whichever comes first. Rule sets must keep
    // every rung within the cap so the pump limit is the one that binds.
    throw new RangeError(`Pump ${overCap.pump} multiplier exceeds ${rules.maxMultiplier}×`);
  }
  return { rules, ladder };
}

function assertRules(rules: PumpRules): void {
  const { rtp, probabilityScale, popBasisPoints, maxPumps } = rules;
  if (rtp.numerator <= 0n || rtp.numerator > rtp.denominator) {
    throw new RangeError('RTP must be in (0, 1]');
  }
  if (!Number.isSafeInteger(probabilityScale) || probabilityScale < 2) {
    throw new RangeError('probabilityScale must be an integer ≥ 2');
  }
  if (!Number.isSafeInteger(maxPumps) || maxPumps < 1 || popBasisPoints.length !== maxPumps) {
    throw new RangeError('popBasisPoints must define exactly maxPumps entries');
  }
  popBasisPoints.forEach((basisPoints, index) => {
    if (!Number.isInteger(basisPoints) || basisPoints <= 0 || basisPoints >= probabilityScale) {
      throw new RangeError(`Pump ${index + 1} pop chance must be strictly between 0 and 1`);
    }
    const previous = popBasisPoints[index - 1];
    if (previous !== undefined && basisPoints <= previous) {
      throw new RangeError('Pop chance must strictly increase with every pump');
    }
  });
  if (rules.minBetCents < 1n || rules.maxBetCents < rules.minBetCents) {
    throw new RangeError('Bet limits are inconsistent');
  }
  if (
    rules.minAutoCashoutHundredths <= 100n ||
    rules.maxAutoCashoutHundredths < rules.minAutoCashoutHundredths
  ) {
    throw new RangeError('Auto cash-out limits are inconsistent');
  }
  if (!Number.isSafeInteger(rules.roundTtlMs) || rules.roundTtlMs <= 0) {
    throw new RangeError('roundTtlMs must be a positive integer');
  }
}

export const PUMP_V1: RuleSet = buildRuleSet(PUMP_RULES_V1);

/** The ladder rung after `pumpCount` successful pumps (1..maxPumps). */
export function ladderStep(ruleSet: RuleSet, pumpCount: number): LadderStep {
  const step = ruleSet.ladder[pumpCount - 1];
  if (!step) throw new RangeError(`No ladder step for pump count ${pumpCount}`);
  return step;
}

/** Exact payout in cents for cashing out after `pumpCount` pumps: floor(bet × M(n)). */
export function payoutCents(ruleSet: RuleSet, betCents: bigint, pumpCount: number): bigint {
  return floorMultiply(betCents, ladderStep(ruleSet, pumpCount).multiplier);
}

/** True when the exact multiplier is at or above a target given in hundredths (200n = 2.00×). */
export function meetsAutoCashoutTarget(multiplier: Ratio, targetHundredths: bigint): boolean {
  return compareRatios(multiplier, ratio(targetHundredths, 100n)) >= 0;
}
