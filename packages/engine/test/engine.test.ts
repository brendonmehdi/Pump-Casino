import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  PUMP_V1,
  applyAction,
  createRound,
  formatRatioFloor,
  payoutCents,
  viewRound,
  type ActiveRound,
  type CreateRoundInput,
  type Round,
  type RoundAction,
  type Transition,
} from '../src';
import { TEST_VECTORS } from './vectors';

const PUMP: RoundAction = { type: 'PUMP' };
const CASH_OUT: RoundAction = { type: 'CASH_OUT' };
const EXPIRE: RoundAction = { type: 'EXPIRE' };

const vectorA = TEST_VECTORS[0];
if (!vectorA) throw new Error('missing test vector');

const inputFor = (overrides: Partial<CreateRoundInput> = {}): CreateRoundInput => ({
  betCents: 1_000n,
  autoCashoutHundredths: null,
  fairness: {
    serverSeed: hexToBytes(vectorA.serverSeedHex),
    roundId: vectorA.roundId,
    nonce: vectorA.nonce,
    clientSeed: vectorA.clientSeed,
  },
  ...overrides,
});

const activeRound = (overrides: Partial<ActiveRound> = {}): ActiveRound => ({
  status: 'ACTIVE',
  betCents: 1_000n,
  pumpCount: 0,
  autoCashoutHundredths: null,
  popPoint: null,
  ...overrides,
});

function apply(round: Round, action: RoundAction): Transition {
  const result = applyAction(PUMP_V1, round, action);
  if (!result.ok) throw new Error(`unexpected engine error ${result.error.code}`);
  return result.value;
}

function pumpTimes(round: Round, times: number): Round {
  let current = round;
  for (let i = 0; i < times; i += 1) current = apply(current, PUMP).round;
  return current;
}

describe('createRound', () => {
  it('starts an ACTIVE round with an empty balloon and a pop point fixed from the seed', () => {
    const result = createRound(PUMP_V1, inputFor());
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'ACTIVE',
        betCents: 1_000n,
        pumpCount: 0,
        autoCashoutHundredths: null,
        popPoint: 3,
      },
    });
  });

  it.each([10n, 100_000n])('accepts the boundary bet %s¢', (betCents) => {
    expect(createRound(PUMP_V1, inputFor({ betCents })).ok).toBe(true);
  });

  it.each([0n, 9n, 100_001n, -10n])('rejects the bet %s¢', (betCents) => {
    const result = createRound(PUMP_V1, inputFor({ betCents }));
    expect(result.ok ? null : result.error.code).toBe('INVALID_BET');
  });

  it.each([100n, 100_001n])('rejects the auto cash-out target %s', (target) => {
    const result = createRound(PUMP_V1, inputFor({ autoCashoutHundredths: target }));
    expect(result.ok ? null : result.error.code).toBe('INVALID_AUTO_CASHOUT');
  });

  it('rejects malformed fairness inputs', () => {
    const fairness = { ...inputFor().fairness, clientSeed: 'has space' };
    const result = createRound(PUMP_V1, inputFor({ fairness }));
    expect(result.ok ? null : result.error.code).toBe('INVALID_FAIRNESS_INPUT');
  });

  it('is deterministic: identical inputs give identical rounds', () => {
    expect(createRound(PUMP_V1, inputFor())).toEqual(createRound(PUMP_V1, inputFor()));
  });
});

describe('pump', () => {
  it('advances the balloon when the pump survives', () => {
    const { round, event } = apply(activeRound({ popPoint: 5 }), PUMP);
    expect(event).toEqual({ type: 'PUMPED', pump: 1 });
    expect(round).toMatchObject({ status: 'ACTIVE', pumpCount: 1 });
  });

  it('pops on exactly the pre-determined pump and pays nothing', () => {
    const beforePop = pumpTimes(activeRound({ popPoint: 3 }), 2);
    const { round, event } = apply(beforePop, PUMP);
    expect(event).toEqual({ type: 'POPPED', pump: 3 });
    expect(round).toMatchObject({ status: 'POPPED', pumpCount: 2 });
    expect(viewRound(PUMP_V1, round).payoutCents).toBe(0n);
  });

  it('cashes out automatically on surviving pump 25 (top of the ladder)', () => {
    const at24 = pumpTimes(activeRound(), 24);
    expect(at24).toMatchObject({ status: 'ACTIVE', pumpCount: 24 });
    const { round, event } = apply(at24, PUMP);
    expect(event).toEqual({
      type: 'CASHED_OUT',
      pump: 25,
      reason: 'LADDER_TOP',
      payoutCents: payoutCents(PUMP_V1, 1_000n, 25),
    });
    expect(round).toMatchObject({ status: 'CASHED_OUT', pumpCount: 25, payoutCents: 794_019n });
  });

  it('settles inside the pump when the auto cash-out target is reached', () => {
    // 2.00× target: pump 6 pays 1.97×, pump 7 pays 2.33×.
    const at6 = pumpTimes(activeRound({ autoCashoutHundredths: 200n }), 6);
    expect(at6.status).toBe('ACTIVE');
    const { round, event } = apply(at6, PUMP);
    expect(event).toMatchObject({ type: 'CASHED_OUT', pump: 7, reason: 'AUTO_TARGET' });
    expect(round).toMatchObject({ status: 'CASHED_OUT', payoutCents: 2_333n });
  });

  it('pops before an unreached auto target', () => {
    const at2 = pumpTimes(activeRound({ autoCashoutHundredths: 1_000n, popPoint: 3 }), 2);
    expect(apply(at2, PUMP).round.status).toBe('POPPED');
  });

  // Expected pumps come from the independent Python reference (tools/rtp_analysis.py): the first
  // pump whose exact multiplier is at or above the target, or the ladder top if none is.
  it.each([
    [101n, 1, 'AUTO_TARGET'],
    [105n, 1, 'AUTO_TARGET'], // 1.0543… ≥ 1.05
    [106n, 2, 'AUTO_TARGET'],
    [116n, 2, 'AUTO_TARGET'], // 1.1618… ≥ 1.16
    [117n, 3, 'AUTO_TARGET'],
    [150n, 5, 'AUTO_TARGET'], // pump 4 is 1.4709…
    [200n, 7, 'AUTO_TARGET'],
    [1_000n, 14, 'AUTO_TARGET'], // pump 13 is 8.83…, pump 14 is 11.66…
    [79_401n, 25, 'LADDER_TOP'], // reached on the last pump: the top takes precedence
    [79_402n, 25, 'LADDER_TOP'], // never reached: the top still settles the round
    [100_000n, 25, 'LADDER_TOP'],
  ])('with an auto target of %s hundredths, settles on pump %i as %s', (target, pump, reason) => {
    let round: Round = activeRound({ autoCashoutHundredths: target, betCents: 333n });
    let last: Transition | null = null;
    while (round.status === 'ACTIVE') {
      last = apply(round, PUMP);
      round = last.round;
    }
    expect(last?.event).toEqual({
      type: 'CASHED_OUT',
      pump,
      reason,
      payoutCents: payoutCents(PUMP_V1, 333n, pump),
    });
  });

  it('settles once, as LADDER_TOP, when the target and the top coincide on pump 25', () => {
    const at24 = pumpTimes(activeRound({ autoCashoutHundredths: 79_401n }), 24);
    const { round, event } = apply(at24, PUMP);
    expect(event).toMatchObject({ type: 'CASHED_OUT', reason: 'LADDER_TOP' });
    expect(round).toMatchObject({ settlementReason: 'LADDER_TOP' });
  });
});

describe('cash out', () => {
  it('is refused before the first pump', () => {
    const result = applyAction(PUMP_V1, activeRound(), CASH_OUT);
    expect(result).toEqual({
      ok: false,
      error: { code: 'CASHOUT_REQUIRES_PUMP', message: 'Pump at least once before cashing out' },
    });
  });

  it('pays bet × current multiplier, floored to the cent', () => {
    const at4 = pumpTimes(activeRound({ betCents: 333n }), 4);
    const { round, event } = apply(at4, CASH_OUT);
    // 333¢ × 1.470955… = 489.83¢ → 489¢
    expect(event).toEqual({ type: 'CASHED_OUT', pump: 4, reason: 'MANUAL', payoutCents: 489n });
    expect(round).toMatchObject({ status: 'CASHED_OUT', settlementReason: 'MANUAL' });
  });
});

describe('expire', () => {
  it('forfeits an active round', () => {
    const { round, event } = apply(pumpTimes(activeRound(), 3), EXPIRE);
    expect(event).toEqual({ type: 'EXPIRED' });
    expect(round).toMatchObject({ status: 'EXPIRED', pumpCount: 3 });
    expect(viewRound(PUMP_V1, round).payoutCents).toBe(0n);
  });
});

describe('terminal rounds', () => {
  const terminals: Round[] = [
    { ...activeRound(), status: 'POPPED' },
    {
      ...activeRound({ pumpCount: 2 }),
      status: 'CASHED_OUT',
      settlementReason: 'MANUAL',
      payoutCents: 1n,
    },
    { ...activeRound(), status: 'EXPIRED' },
  ];

  it.each(
    terminals.flatMap((round) =>
      [PUMP, CASH_OUT, EXPIRE].map((action) => [round.status, action.type, round, action] as const),
    ),
  )('%s rejects %s', (_status, _type, round, action) => {
    const result = applyAction(PUMP_V1, round, action);
    expect(result.ok ? null : result.error.code).toBe('ROUND_NOT_ACTIVE');
  });
});

describe('purity', () => {
  it('never mutates its inputs', () => {
    const round = Object.freeze(activeRound({ popPoint: 9 }));
    const snapshot = { ...round };
    apply(round, PUMP);
    apply(pumpTimes(round, 2), CASH_OUT);
    expect(round).toEqual(snapshot);
  });

  it('throws on a persisted active round that is internally inconsistent', () => {
    expect(() => applyAction(PUMP_V1, activeRound({ pumpCount: 4, popPoint: 4 }), PUMP)).toThrow(
      /inconsistent/,
    );
    expect(() => applyAction(PUMP_V1, activeRound({ pumpCount: 25 }), PUMP)).toThrow(
      /inconsistent/,
    );
  });
});

describe('viewRound', () => {
  it('shows the next risk and no cash-out value before the first pump', () => {
    const view = viewRound(PUMP_V1, activeRound({ popPoint: 1 }));
    expect(view).toMatchObject({
      status: 'ACTIVE',
      pumpCount: 0,
      multiplier: null,
      cashoutCents: null,
      nextPopBasisPoints: 800,
      payoutCents: null,
    });
    expect(view.nextMultiplier && formatRatioFloor(view.nextMultiplier, 2)).toBe('1.05');
  });

  it('shows the current cash-out value mid-round', () => {
    const view = viewRound(PUMP_V1, pumpTimes(activeRound(), 10));
    expect(view.cashoutCents).toBe(4_233n);
    expect(view.nextPopBasisPoints).toBe(2050);
  });

  it('never exposes the pop point', () => {
    const view = viewRound(PUMP_V1, activeRound({ popPoint: 4 }));
    expect(Object.keys(view)).not.toContain('popPoint');
    expect(
      JSON.stringify(view, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toMatch(/popPoint/);
  });
});
