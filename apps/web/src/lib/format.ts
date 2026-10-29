import { formatBasisPoints, formatCents } from '@pump/contracts';
import { PUMP_V1, formatRatioFloor, type Ratio } from '@pump/engine';

export const money = (cents: string | bigint): string =>
  formatCents(typeof cents === 'string' ? BigInt(cents) : cents);

export const times = (multiplier: string): string => `${multiplier}×`;

export const chance = (basisPoints: number): string => formatBasisPoints(basisPoints);

/** A probability as a percentage, floored to 2 dp so it never overstates the odds. */
export const percent = (probability: Ratio): string =>
  `${formatRatioFloor({ numerator: probability.numerator * 100n, denominator: probability.denominator }, 2)}%`;

export const ladderMultiplier = (pump: number): string => {
  const step = PUMP_V1.ladder[pump - 1];
  return step ? formatRatioFloor(step.multiplier, 2) : '';
};

export const shortHash = (hex: string): string => `${hex.slice(0, 10)}…${hex.slice(-6)}`;
