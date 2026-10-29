/**
 * Exact, non-negative rational numbers on top of BigInt. Every probability, multiplier and
 * payout in the game is computed with these so no floating-point value ever touches money.
 */
export interface Ratio {
  readonly numerator: bigint;
  /** Always > 0. */
  readonly denominator: bigint;
}

export function ratio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator <= 0n) throw new RangeError('Ratio denominator must be positive');
  if (numerator < 0n) throw new RangeError('Ratio numerator must be non-negative');
  return { numerator, denominator };
}

/**
 * floor(value × r). Both operands are non-negative, so BigInt division (which truncates toward
 * zero) is exactly floor. This is the single place where the game rounds money.
 */
export function floorMultiply(value: bigint, r: Ratio): bigint {
  if (value < 0n) throw new RangeError('floorMultiply expects a non-negative value');
  return (value * r.numerator) / r.denominator;
}

/** Returns -1, 0 or 1 for a < b, a = b, a > b. */
export function compareRatios(a: Ratio, b: Ratio): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Decimal representation floored (never rounded up) to `decimals` places, e.g. 1.0543… → "1.05".
 * Flooring guarantees a displayed multiplier never promises more than the exact one pays.
 */
export function formatRatioFloor(r: Ratio, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError('decimals must be a non-negative integer');
  }
  const scale = 10n ** BigInt(decimals);
  const scaled = (r.numerator * scale) / r.denominator;
  if (decimals === 0) return scaled.toString();
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${whole.toString()}.${fraction}`;
}
