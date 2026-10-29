import type { PublicRound } from '@pump/contracts';

/** Hard ceiling on one auto-bet session: automation is always bounded. */
export const MAX_AUTO_ROUNDS = 1_000;

export interface AutoBetConfig {
  readonly betCents: bigint;
  readonly rounds: number;
  /** Required auto cash-out target, e.g. "2.00". */
  readonly target: string;
  readonly stopOnProfitCents: bigint | null;
  readonly stopOnLossCents: bigint | null;
}

export interface AutoBetStats {
  readonly roundsPlayed: number;
  /** Payouts minus bets for this session (negative when down). */
  readonly netCents: bigint;
}

export type StopReason =
  'COMPLETED' | 'PROFIT_TARGET' | 'LOSS_LIMIT' | 'INSUFFICIENT_BALANCE' | 'STOPPED' | 'ERROR';

export const EMPTY_STATS: AutoBetStats = { roundsPlayed: 0, netCents: 0n };

/**
 * Decides, before each round, whether auto-bet may place another bet. The loss limit is
 * checked against the worst case of the *next* round, so a session never loses more than the
 * limit; the bet size never changes on its own (no martingale or loss chasing).
 */
export function decideNext(
  config: AutoBetConfig,
  stats: AutoBetStats,
  balanceCents: bigint,
): { readonly kind: 'bet' } | { readonly kind: 'stop'; readonly reason: StopReason } {
  if (stats.roundsPlayed >= config.rounds) return { kind: 'stop', reason: 'COMPLETED' };
  if (config.stopOnProfitCents !== null && stats.netCents >= config.stopOnProfitCents) {
    return { kind: 'stop', reason: 'PROFIT_TARGET' };
  }
  if (
    config.stopOnLossCents !== null &&
    -stats.netCents + config.betCents > config.stopOnLossCents
  ) {
    return { kind: 'stop', reason: 'LOSS_LIMIT' };
  }
  if (balanceCents < config.betCents) return { kind: 'stop', reason: 'INSUFFICIENT_BALANCE' };
  return { kind: 'bet' };
}

/** Folds a finished round into the session totals. */
export function recordRound(
  stats: AutoBetStats,
  round: Pick<PublicRound, 'betCents' | 'payoutCents'>,
): AutoBetStats {
  const payout = BigInt(round.payoutCents ?? '0');
  return {
    roundsPlayed: stats.roundsPlayed + 1,
    netCents: stats.netCents + payout - BigInt(round.betCents),
  };
}

export function describeStop(reason: StopReason): string {
  switch (reason) {
    case 'COMPLETED':
      return 'Finished all rounds.';
    case 'PROFIT_TARGET':
      return 'Stopped: profit target reached.';
    case 'LOSS_LIMIT':
      return 'Stopped: another bet could pass your loss limit.';
    case 'INSUFFICIENT_BALANCE':
      return 'Stopped: balance too low for the next bet.';
    case 'STOPPED':
      return 'Stopped by you.';
    case 'ERROR':
      return 'Stopped: the server refused a request. Your balance is up to date.';
  }
}
