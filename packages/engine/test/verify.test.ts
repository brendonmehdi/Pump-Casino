import { describe, expect, it } from 'vitest';
import { PUMP_V1, payoutCents, verifyRound, type RevealedRound, type RoundOutcome } from '../src';
import { TEST_VECTORS, type TestVector } from './vectors';

function vector(index: number): TestVector {
  const found = TEST_VECTORS[index];
  if (!found) throw new Error(`missing vector ${index}`);
  return found;
}

function revealed(
  source: TestVector,
  recorded: RoundOutcome,
  overrides: Partial<RevealedRound> = {},
): RevealedRound {
  return {
    rulesVersion: 'pump-v1',
    commitment: source.commitment,
    serverSeedHex: source.serverSeedHex,
    roundId: source.roundId,
    nonce: source.nonce,
    clientSeed: source.clientSeed,
    betCents: 1_000n,
    autoCashoutHundredths: null,
    recorded,
    ...overrides,
  };
}

const popped = (pumpCount: number): RoundOutcome => ({
  status: 'POPPED',
  pumpCount,
  settlementReason: null,
  payoutCents: 0n,
});

describe('verifyRound — honest rounds', () => {
  it('verifies a round that popped (vector A pops on pump 3)', () => {
    const report = verifyRound(PUMP_V1, revealed(vector(0), popped(2)));
    expect(report).toMatchObject({ verdict: 'VERIFIED', commitmentMatches: true, popPoint: 3 });
    expect(report.draws.map((draw) => draw.pops)).toEqual([false, false, true]);
    expect(report.problems).toEqual([]);
  });

  it('verifies a manual cash-out before the pop point', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 2,
      settlementReason: 'MANUAL',
      payoutCents: payoutCents(PUMP_V1, 1_000n, 2),
    };
    expect(verifyRound(PUMP_V1, revealed(vector(0), recorded)).verdict).toBe('VERIFIED');
  });

  it('verifies a ladder-top auto cash-out (vector B never pops)', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 25,
      settlementReason: 'LADDER_TOP',
      payoutCents: 794_019n,
    };
    const report = verifyRound(PUMP_V1, revealed(vector(1), recorded));
    expect(report).toMatchObject({ verdict: 'VERIFIED', popPoint: null });
    expect(report.draws).toHaveLength(25);
  });

  it('verifies an auto-target cash-out', () => {
    // Vector B survives everything; a 1.40× target is first met on pump 4 (1.47×).
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 4,
      settlementReason: 'AUTO_TARGET',
      payoutCents: 1_470n,
    };
    const report = verifyRound(
      PUMP_V1,
      revealed(vector(1), recorded, { autoCashoutHundredths: 140n }),
    );
    expect(report.verdict).toBe('VERIFIED');
  });

  it('verifies an expired round', () => {
    const recorded: RoundOutcome = {
      status: 'EXPIRED',
      pumpCount: 1,
      settlementReason: null,
      payoutCents: 0n,
    };
    expect(verifyRound(PUMP_V1, revealed(vector(0), recorded)).verdict).toBe('VERIFIED');
  });

  it('verifies the rejection-sampling vector', () => {
    const report = verifyRound(PUMP_V1, revealed(vector(2), popped(3)));
    expect(report.verdict).toBe('VERIFIED');
    expect(report.draws[0]?.attempts).toBe(2);
  });
});

describe('verifyRound — detects tampering', () => {
  it('flags a seed that does not match the commitment', () => {
    const report = verifyRound(
      PUMP_V1,
      revealed(vector(0), popped(2), { commitment: vector(1).commitment }),
    );
    expect(report).toMatchObject({ verdict: 'MISMATCH', commitmentMatches: false });
  });

  it('flags a pop that happened earlier than the seed allows', () => {
    const report = verifyRound(PUMP_V1, revealed(vector(0), popped(0)));
    expect(report.verdict).toBe('MISMATCH');
    expect(report.problems.join(' ')).toMatch(/status/);
  });

  it('flags a cash-out after the pre-determined pop point', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 4,
      settlementReason: 'MANUAL',
      payoutCents: payoutCents(PUMP_V1, 1_000n, 4),
    };
    expect(verifyRound(PUMP_V1, revealed(vector(0), recorded)).verdict).toBe('MISMATCH');
  });

  it('flags a payout that differs from bet × multiplier', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 2,
      settlementReason: 'MANUAL',
      payoutCents: payoutCents(PUMP_V1, 1_000n, 2) + 1n,
    };
    const report = verifyRound(PUMP_V1, revealed(vector(0), recorded));
    expect(report.verdict).toBe('MISMATCH');
    expect(report.problems.join(' ')).toMatch(/payout/);
  });

  it('flags a manual cash-out recorded past an auto target that should have fired', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 6,
      settlementReason: 'MANUAL',
      payoutCents: payoutCents(PUMP_V1, 1_000n, 6),
    };
    const report = verifyRound(
      PUMP_V1,
      revealed(vector(1), recorded, { autoCashoutHundredths: 140n }),
    );
    expect(report.verdict).toBe('MISMATCH');
  });

  it('flags a cash-out recorded with zero pumps', () => {
    const recorded: RoundOutcome = {
      status: 'CASHED_OUT',
      pumpCount: 0,
      settlementReason: 'MANUAL',
      payoutCents: 1_000n,
    };
    expect(verifyRound(PUMP_V1, revealed(vector(1), recorded)).verdict).toBe('MISMATCH');
  });
});

describe('verifyRound — invalid input', () => {
  it.each([
    ['an unknown rules version', { rulesVersion: 'pump-v0' }],
    ['a non-hex server seed', { serverSeedHex: 'zz'.repeat(32) }],
    ['an uppercase server seed', { serverSeedHex: vector(0).serverSeedHex.toUpperCase() }],
    ['a short commitment', { commitment: 'abc' }],
    ['an out-of-range bet', { betCents: 5n }],
    ['a malformed client seed', { clientSeed: 'a b' }],
  ])('rejects %s', (_label, overrides) => {
    expect(verifyRound(PUMP_V1, revealed(vector(0), popped(2), overrides)).verdict).toBe(
      'INVALID_INPUT',
    );
  });

  it('refuses to verify a round that is still active', () => {
    const recorded: RoundOutcome = {
      status: 'ACTIVE',
      pumpCount: 1,
      settlementReason: null,
      payoutCents: 0n,
    };
    expect(verifyRound(PUMP_V1, revealed(vector(0), recorded)).verdict).toBe('INVALID_INPUT');
  });
});
