import { hexToBytes } from '@noble/hashes/utils.js';
import {
  SHA256_HEX_PATTERN,
  commitmentFor,
  traceDraws,
  type FairnessInputs,
  type PumpDraw,
} from './fairness';
import {
  applyAction,
  createRound,
  type Round,
  type RoundStatus,
  type SettlementReason,
} from './PumpEngine';
import type { RuleSet } from './rules';

/** What the server says happened. Verification checks it against an independent replay. */
export interface RoundOutcome {
  readonly status: RoundStatus;
  readonly pumpCount: number;
  readonly settlementReason: SettlementReason | null;
  readonly payoutCents: bigint;
}

/** Everything published once a round ends: enough to recompute it with no server access. */
export interface RevealedRound {
  readonly rulesVersion: string;
  readonly commitment: string;
  readonly serverSeedHex: string;
  readonly roundId: string;
  readonly nonce: number;
  readonly clientSeed: string;
  readonly betCents: bigint;
  readonly autoCashoutHundredths: bigint | null;
  readonly recorded: RoundOutcome;
}

export type VerificationVerdict = 'VERIFIED' | 'MISMATCH' | 'INVALID_INPUT';

export interface VerificationReport {
  readonly verdict: VerificationVerdict;
  readonly commitmentMatches: boolean;
  /** Every draw up to and including the pop (or all of them if the balloon never pops). */
  readonly draws: readonly PumpDraw[];
  readonly popPoint: number | null;
  /** The outcome obtained by replaying the recorded actions through the engine. */
  readonly replayed: RoundOutcome | null;
  readonly problems: readonly string[];
}

const invalid = (problem: string): VerificationReport => ({
  verdict: 'INVALID_INPUT',
  commitmentMatches: false,
  draws: [],
  popPoint: null,
  replayed: null,
  problems: [problem],
});

/**
 * Recomputes a finished round from its revealed inputs alone: checks the seed against the
 * commitment, re-derives every draw, and replays the recorded actions through the same engine
 * transitions the server used. It never consults the server's own verdict.
 */
export function verifyRound(ruleSet: RuleSet, revealed: RevealedRound): VerificationReport {
  if (revealed.rulesVersion !== ruleSet.rules.version) {
    return invalid(`Unsupported rules version "${revealed.rulesVersion}"`);
  }
  if (!SHA256_HEX_PATTERN.test(revealed.serverSeedHex)) {
    return invalid('Server seed must be 64 lowercase hex characters');
  }
  if (!SHA256_HEX_PATTERN.test(revealed.commitment)) {
    return invalid('Commitment must be 64 lowercase hex characters');
  }
  if (revealed.recorded.status === 'ACTIVE') {
    return invalid('Only finished rounds can be verified');
  }
  const fairness: FairnessInputs = {
    serverSeed: hexToBytes(revealed.serverSeedHex),
    roundId: revealed.roundId,
    nonce: revealed.nonce,
    clientSeed: revealed.clientSeed,
  };
  const created = createRound(ruleSet, {
    betCents: revealed.betCents,
    autoCashoutHundredths: revealed.autoCashoutHundredths,
    fairness,
  });
  if (!created.ok) return invalid(created.error.message);

  const draws = traceDraws(ruleSet, fairness);
  const commitmentMatches = commitmentFor(fairness.serverSeed) === revealed.commitment;
  const replayed = replay(ruleSet, created.value, revealed.recorded);
  const problems = [
    ...(commitmentMatches ? [] : ['SHA-256 of the server seed does not match the commitment']),
    ...compareOutcomes(revealed.recorded, replayed),
  ];
  return {
    verdict: problems.length === 0 ? 'VERIFIED' : 'MISMATCH',
    commitmentMatches,
    draws,
    popPoint: created.value.popPoint,
    replayed,
    problems,
  };
}

/** Re-applies the player's recorded actions: n pumps, then the terminal action if one is due. */
function replay(ruleSet: RuleSet, start: Round, recorded: RoundOutcome): RoundOutcome {
  const pumps = recorded.status === 'POPPED' ? recorded.pumpCount + 1 : recorded.pumpCount;
  let round = start;
  for (let pumped = 0; pumped < pumps && round.status === 'ACTIVE'; pumped += 1) {
    round = step(ruleSet, round, 'PUMP');
  }
  if (round.status === 'ACTIVE' && recorded.status === 'CASHED_OUT') {
    round = step(ruleSet, round, 'CASH_OUT');
  } else if (round.status === 'ACTIVE' && recorded.status === 'EXPIRED') {
    round = step(ruleSet, round, 'EXPIRE');
  }
  return {
    status: round.status,
    pumpCount: round.pumpCount,
    settlementReason: round.status === 'CASHED_OUT' ? round.settlementReason : null,
    payoutCents: round.status === 'CASHED_OUT' ? round.payoutCents : 0n,
  };
}

/** Applies one action; a rejected action (e.g. cash-out before any pump) leaves the round as is. */
function step(ruleSet: RuleSet, round: Round, type: 'PUMP' | 'CASH_OUT' | 'EXPIRE'): Round {
  const result = applyAction(ruleSet, round, { type });
  return result.ok ? result.value.round : round;
}

function compareOutcomes(recorded: RoundOutcome, replayed: RoundOutcome): string[] {
  const problems: string[] = [];
  if (recorded.status !== replayed.status) {
    problems.push(`Recorded status ${recorded.status}, replay gives ${replayed.status}`);
  }
  if (recorded.pumpCount !== replayed.pumpCount) {
    problems.push(`Recorded ${recorded.pumpCount} pumps, replay gives ${replayed.pumpCount}`);
  }
  if (recorded.settlementReason !== replayed.settlementReason) {
    problems.push(
      `Recorded settlement ${recorded.settlementReason ?? 'none'}, replay gives ${replayed.settlementReason ?? 'none'}`,
    );
  }
  if (recorded.payoutCents !== replayed.payoutCents) {
    problems.push(
      `Recorded payout ${recorded.payoutCents.toString()}¢, replay gives ${replayed.payoutCents.toString()}¢`,
    );
  }
  return problems;
}
