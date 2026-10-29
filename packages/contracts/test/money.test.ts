import { describe, expect, it } from 'vitest';
import {
  centsToDollarString,
  formatBasisPoints,
  formatCents,
  formatHundredths,
  parseDollarsToCents,
  parseMultiplierToHundredths,
} from '../src';

describe('parseDollarsToCents', () => {
  it.each([
    ['0.10', 10n],
    ['10', 1_000n],
    ['10.5', 1_050n],
    ['10.05', 1_005n],
    ['1000.00', 100_000n],
    ['0', 0n],
  ])('parses %s', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each([
    ['empty', ''],
    ['leading whitespace', ' 10'],
    ['trailing whitespace', '10 '],
    ['negative', '-1'],
    ['plus sign', '+1'],
    ['three decimals', '1.005'],
    ['trailing dot', '10.'],
    ['leading dot', '.5'],
    ['leading zeros', '010'],
    ['exponent', '1e3'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['thousands separator', '1,000'],
    ['currency symbol', '$10'],
    ['oversized', '99999999'],
    ['hex', '0x10'],
    ['unicode digits', '１０'],
  ])('rejects %s', (_label, input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats cents for inputs and display without floating point', () => {
    expect(centsToDollarString(5n)).toBe('0.05');
    expect(centsToDollarString(100_000n)).toBe('1000.00');
    expect(formatCents(123_456_789n)).toBe('$1,234,567.89');
    expect(formatCents(0n)).toBe('$0.00');
  });

  it('round-trips every cent amount in the bet range', () => {
    for (let cents = 10n; cents <= 100_000n; cents += 1n) {
      if (parseDollarsToCents(centsToDollarString(cents)) !== cents) {
        throw new Error(`round-trip failed for ${cents.toString()}`);
      }
    }
  });

  it('formats multipliers and pop chances', () => {
    expect(formatHundredths(250n)).toBe('2.50');
    expect(formatHundredths(100_000n)).toBe('1000.00');
    expect(formatBasisPoints(800)).toBe('8.00%');
    expect(formatBasisPoints(925)).toBe('9.25%');
    expect(formatBasisPoints(3800)).toBe('38.00%');
  });

  it('refuses negative amounts', () => {
    expect(() => formatCents(-1n)).toThrow(RangeError);
    expect(() => formatBasisPoints(-1)).toThrow(RangeError);
  });
});

describe('parseMultiplierToHundredths', () => {
  it.each([
    ['2', 200n],
    ['2.5', 250n],
    ['1.01', 101n],
    ['1000.00', 100_000n],
  ])('parses %s', (input, hundredths) => {
    expect(parseMultiplierToHundredths(input)).toBe(hundredths);
  });

  it.each(['', '0.5', '2.505', ' 2', '2x', '-2', '1e2', '10000'])('rejects %j', (input) => {
    expect(parseMultiplierToHundredths(input)).toBeNull();
  });
});
