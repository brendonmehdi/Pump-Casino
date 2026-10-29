import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, decideNext, recordRound, type AutoBetConfig } from './autobet';

const config: AutoBetConfig = {
  betCents: 1_000n,
  rounds: 3,
  target: '2.00',
  stopOnProfitCents: null,
  stopOnLossCents: null,
};

const finished = (payoutCents: string) => ({ betCents: '1000', payoutCents });

describe('decideNext', () => {
  it('bets until the round count is reached', () => {
    expect(decideNext(config, EMPTY_STATS, 10_000n)).toEqual({ kind: 'bet' });
    expect(decideNext(config, { roundsPlayed: 3, netCents: 0n }, 10_000n)).toEqual({
      kind: 'stop',
      reason: 'COMPLETED',
    });
  });

  it('stops once the profit target is reached', () => {
    const withProfit = { ...config, stopOnProfitCents: 500n };
    expect(decideNext(withProfit, { roundsPlayed: 1, netCents: 499n }, 10_000n).kind).toBe('bet');
    expect(decideNext(withProfit, { roundsPlayed: 1, netCents: 500n }, 10_000n)).toEqual({
      kind: 'stop',
      reason: 'PROFIT_TARGET',
    });
  });

  it('never places a bet that could take losses past the limit', () => {
    const withLimit = { ...config, rounds: 100, stopOnLossCents: 2_500n };
    // Down $15: another $10 bet could reach -$25, exactly the limit, so it is allowed.
    expect(decideNext(withLimit, { roundsPlayed: 2, netCents: -1_500n }, 10_000n).kind).toBe('bet');
    // Down $16: the next bet could reach -$26, past the limit.
    expect(decideNext(withLimit, { roundsPlayed: 2, netCents: -1_600n }, 10_000n)).toEqual({
      kind: 'stop',
      reason: 'LOSS_LIMIT',
    });
  });

  it('stops when the balance cannot cover the next bet', () => {
    expect(decideNext(config, EMPTY_STATS, 999n)).toEqual({
      kind: 'stop',
      reason: 'INSUFFICIENT_BALANCE',
    });
  });
});

describe('recordRound', () => {
  it('adds payouts and subtracts bets exactly', () => {
    const afterWin = recordRound(EMPTY_STATS, finished('2333'));
    expect(afterWin).toEqual({ roundsPlayed: 1, netCents: 1_333n });
    const afterLoss = recordRound(afterWin, finished('0'));
    expect(afterLoss).toEqual({ roundsPlayed: 2, netCents: 333n });
  });
});
