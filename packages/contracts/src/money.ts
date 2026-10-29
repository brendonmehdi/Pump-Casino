/**
 * Wire and input formats for money and multipliers. Money is always integer cents; on the wire
 * it is a canonical decimal string so no JSON number can lose precision. Parsers are strict:
 * anything that is not exactly the documented format (whitespace, signs, exponents, extra
 * decimals, separators, oversized values) is rejected rather than "fixed up".
 */

/** Non-negative integer cents: no sign, no leading zeros, at most 16 digits. */
export const CENTS_PATTERN = /^(0|[1-9][0-9]{0,15})$/;

/** A dollar amount as a player types it: "10", "10.5", "10.50" (no "$", commas or spaces). */
const DOLLARS_PATTERN = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/;

/** A multiplier with at most two decimals: "2", "2.5", "2.50", "1000.00". */
export const MULTIPLIER_PATTERN = /^([1-9][0-9]{0,3})(?:\.([0-9]{1,2}))?$/;

export function parseDollarsToCents(input: string): bigint | null {
  const match = DOLLARS_PATTERN.exec(input);
  if (!match) return null;
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** 123456n → "1234.56" (for editable inputs). */
export function centsToDollarString(cents: bigint): string {
  if (cents < 0n) throw new RangeError('Cents must be non-negative');
  return `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** 123456n → "$1,234.56" (for display). */
export function formatCents(cents: bigint): string {
  if (cents < 0n) throw new RangeError('Cents must be non-negative');
  const dollars = (cents / 100n).toLocaleString('en-US');
  return `$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function parseMultiplierToHundredths(input: string): bigint | null {
  const match = MULTIPLIER_PATTERN.exec(input);
  if (!match) return null;
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** 250n → "2.50" */
export function formatHundredths(hundredths: bigint): string {
  if (hundredths < 0n) throw new RangeError('Hundredths must be non-negative');
  return `${(hundredths / 100n).toString()}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

/** 925 → "9.25%" (pop chances are exact basis points). */
export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError('Basis points must be a non-negative integer');
  }
  return `${Math.floor(basisPoints / 100).toString()}.${(basisPoints % 100).toString().padStart(2, '0')}%`;
}
