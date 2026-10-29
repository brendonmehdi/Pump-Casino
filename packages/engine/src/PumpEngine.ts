import { derivePopPoint, findFairnessInputProblem, type FairnessInputs } from './fairness';
import type { Ratio } from './ratio';
import { ladderStep, meetsAutoCashoutTarget, payoutCents, type RuleSet } from './rules';

/**
 * The Pump state machine. Pure and deterministic: every function takes explicit inputs (rules,
 * state, action, seed material) and returns new values. Nothing here touches a database, the
 * network, the clock or an unseeded random source, and inputs are never mutated.
 *
 *   createRound ──► ACTIVE ──PUMP (survives)──► ACTIVE
 *                     │ PUMP (pops) ─────────► POPPED      (payout 0)
 *                     │ PUMP (target / top) ─► CASHED_OUT  (AUTO_TARGET | LADDER_TOP)
 *                     │ CASH_OUT (≥ 1 pump) ─► CASHED_OUT  (MANUAL)
 *                     └ EXPIRE ──────────────► EXPIRED     (payout 0)
 */

export type RoundStatus = 'ACTIVE' | 'POPPED' | 'CASHED_OUT' | 'EXPIRED';

/** Why a round paid out. All three settle through the same `settle` transition. */
export type SettlementReason = 'MANUAL' | 'AUTO_TARGET' | 'LADDER_TOP';

interface RoundFields {
  readonly betCents: bigint;
  /** Successful pumps so far. */
  readonly pumpCount: number;
  /** Auto cash-out target in hundredths of a multiplier (250n = 2.50×), or null. */
  readonly autoCashoutHundredths: bigint | null;
  /**
   * SERVER-ONLY. The pump that pops the balloon (1-based), or null when it survives the whole
   * ladder. Fixed from the committed seed when the round is created; never sent to a client
   * while the round is ACTIVE.
   */
  readonly popPoint: number | null;
}

export interface ActiveRound extends RoundFields {
  readonly status: 'ACTIVE';
}
export interface PoppedRound extends RoundFields {
  readonly status: 'POPPED';
}
export interface CashedOutRound extends RoundFields {
  readonly status: 'CASHED_OUT';
  readonly settlementReason: SettlementReason;
  readonly payoutCents: bigint;
}
export interface ExpiredRound extends RoundFields {
  readonly status: 'EXPIRED';
}
export type TerminalRound = PoppedRound | CashedOutRound | ExpiredRound;
export type Round = ActiveRound | TerminalRound;

export type RoundAction =
  { readonly type: 'PUMP' } | { readonly type: 'CASH_OUT' } | { readonly type: 'EXPIRE' };

export type RoundEvent =
  | { readonly type: 'PUMPED'; readonly pump: number }
  | { readonly type: 'POPPED'; readonly pump: number }
  | {
      readonly type: 'CASHED_OUT';
      readonly pump: number;
      readonly reason: SettlementReason;
      readonly payoutCents: bigint;
    }
  | { readonly type: 'EXPIRED' };

export type EngineErrorCode =
  | 'INVALID_BET'
  | 'INVALID_AUTO_CASHOUT'
  | 'INVALID_FAIRNESS_INPUT'
  | 'ROUND_NOT_ACTIVE'
  | 'CASHOUT_REQUIRES_PUMP';

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
}

export type EngineResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngineError };

export interface Transition {
  readonly round: Round;
  readonly event: RoundEvent;
}

export interface CreateRoundInput {
  readonly betCents: bigint;
  readonly autoCashoutHundredths: bigint | null;
  readonly fairness: FairnessInputs;
}

/** Public numbers for a round. Derived only from public state; never includes the pop point. */
export interface RoundView {
  readonly status: RoundStatus;
  readonly pumpCount: number;
  readonly maxPumps: number;
  /** Multiplier reached so far; null before the first successful pump. */
  readonly multiplier: Ratio | null;
  /** What cashing out right now pays; null unless ACTIVE with at least one pump. */
  readonly cashoutCents: bigint | null;
  /** Chance the next pump pops, from the public schedule; null when no pump is possible. */
  readonly nextPopBasisPoints: number | null;
  readonly nextMultiplier: Ratio | null;
  /** Amount credited at settlement: payout, or 0 for POPPED/EXPIRED; null while ACTIVE. */
  readonly payoutCents: bigint | null;
  readonly settlementReason: SettlementReason | null;
}

const ok = <T>(value: T): EngineResult<T> => ({ ok: true, value });
const fail = <T>(code: EngineErrorCode, message: string): EngineResult<T> => ({
  ok: false,
  error: { code, message },
});

/** Starts a round. The pop point is fixed here, from the seed material, before any pump. */
export function createRound(ruleSet: RuleSet, input: CreateRoundInput): EngineResult<ActiveRound> {
  const { rules } = ruleSet;
  if (input.betCents < rules.minBetCents || input.betCents > rules.maxBetCents) {
    return fail(
      'INVALID_BET',
      `Bet must be between ${rules.minBetCents.toString()} and ${rules.maxBetCents.toString()} cents`,
    );
  }
  const target = input.autoCashoutHundredths;
  if (
    target !== null &&
    (target < rules.minAutoCashoutHundredths || target > rules.maxAutoCashoutHundredths)
  ) {
    return fail('INVALID_AUTO_CASHOUT', 'Auto cash-out target is outside the allowed range');
  }
  const problem = findFairnessInputProblem(input.fairness);
  if (problem !== null) return fail('INVALID_FAIRNESS_INPUT', problem);
  return ok({
    status: 'ACTIVE',
    betCents: input.betCents,
    pumpCount: 0,
    autoCashoutHundredths: target,
    popPoint: derivePopPoint(ruleSet, input.fairness),
  });
}

export function applyAction(
  ruleSet: RuleSet,
  round: Round,
  action: RoundAction,
): EngineResult<Transition> {
  if (round.status !== 'ACTIVE') {
    return fail('ROUND_NOT_ACTIVE', `Round is already ${round.status}`);
  }
  assertActiveInvariants(ruleSet, round);
  switch (action.type) {
    case 'PUMP':
      return ok(pump(ruleSet, round));
    case 'CASH_OUT':
      if (round.pumpCount === 0) {
        return fail('CASHOUT_REQUIRES_PUMP', 'Pump at least once before cashing out');
      }
      return ok(settle(ruleSet, round, 'MANUAL'));
    case 'EXPIRE':
      return ok({ round: { ...round, status: 'EXPIRED' }, event: { type: 'EXPIRED' } });
  }
}

function pump(ruleSet: RuleSet, round: ActiveRound): Transition {
  const pumpNumber = round.pumpCount + 1;
  if (round.popPoint === pumpNumber) {
    return { round: { ...round, status: 'POPPED' }, event: { type: 'POPPED', pump: pumpNumber } };
  }
  const advanced: ActiveRound = { ...round, pumpCount: pumpNumber };
  const reason = automaticSettlementReason(ruleSet, advanced);
  return reason === null
    ? { round: advanced, event: { type: 'PUMPED', pump: pumpNumber } }
    : settle(ruleSet, advanced, reason);
}

/**
 * Reaching the top of the ladder takes precedence over an auto target hit on the same pump;
 * either way the pump produces exactly one settlement.
 */
function automaticSettlementReason(ruleSet: RuleSet, round: ActiveRound): SettlementReason | null {
  if (round.pumpCount === ruleSet.rules.maxPumps) return 'LADDER_TOP';
  const target = round.autoCashoutHundredths;
  const { multiplier } = ladderStep(ruleSet, round.pumpCount);
  return target !== null && meetsAutoCashoutTarget(multiplier, target) ? 'AUTO_TARGET' : null;
}

/** The single settlement path shared by manual, auto-target and ladder-top cash-outs. */
function settle(ruleSet: RuleSet, round: ActiveRound, reason: SettlementReason): Transition {
  const payout = payoutCents(ruleSet, round.betCents, round.pumpCount);
  return {
    round: { ...round, status: 'CASHED_OUT', settlementReason: reason, payoutCents: payout },
    event: { type: 'CASHED_OUT', pump: round.pumpCount, reason, payoutCents: payout },
  };
}

/** A persisted ACTIVE round that violates these was corrupted outside the engine. */
function assertActiveInvariants(ruleSet: RuleSet, round: ActiveRound): void {
  const { maxPumps } = ruleSet.rules;
  const validCount =
    Number.isInteger(round.pumpCount) && round.pumpCount >= 0 && round.pumpCount < maxPumps;
  const validPopPoint =
    round.popPoint === null ||
    (Number.isInteger(round.popPoint) &&
      round.popPoint > round.pumpCount &&
      round.popPoint <= maxPumps);
  if (!validCount || !validPopPoint) {
    throw new RangeError('Active round state is inconsistent with the rule set');
  }
}

export function viewRound(ruleSet: RuleSet, round: Round): RoundView {
  const { maxPumps } = ruleSet.rules;
  const reached = round.pumpCount > 0 ? ladderStep(ruleSet, round.pumpCount) : null;
  const canPumpAgain = round.status === 'ACTIVE' && round.pumpCount < maxPumps;
  const next = canPumpAgain ? ladderStep(ruleSet, round.pumpCount + 1) : null;
  return {
    status: round.status,
    pumpCount: round.pumpCount,
    maxPumps,
    multiplier: reached?.multiplier ?? null,
    cashoutCents:
      round.status === 'ACTIVE' && reached
        ? payoutCents(ruleSet, round.betCents, round.pumpCount)
        : null,
    nextPopBasisPoints: next?.popBasisPoints ?? null,
    nextMultiplier: next?.multiplier ?? null,
    payoutCents: settledPayout(round),
    settlementReason: round.status === 'CASHED_OUT' ? round.settlementReason : null,
  };
}

function settledPayout(round: Round): bigint | null {
  switch (round.status) {
    case 'ACTIVE':
      return null;
    case 'CASHED_OUT':
      return round.payoutCents;
    case 'POPPED':
    case 'EXPIRED':
      return 0n;
  }
}
