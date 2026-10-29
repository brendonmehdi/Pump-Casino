import {
  HISTORY_PAGE_SIZE_DEFAULT,
  parseMultiplierToHundredths,
  type GameState,
  type HistoryQuery,
  type HistoryResponse,
  type RotateCommitmentRequest,
  type RotateCommitmentResponse,
  type RoundActionRequest,
  type StartRoundRequest,
  type VerifyResponse,
} from '@pump/contracts';
import { PUMP_V1, applyAction, createRound, type Transition } from '@pump/engine';
import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import type { Queryable, Transaction } from '../db/client';
import { players, rounds, seedCommitments, type PlayerRow, type RoundRow } from '../db/schema';
import { lockPreparedCommitment, prepareCommitment, resolveCommitment } from './commitments';
import { DomainError } from './errors';
import { postLedgerEntry } from './ledger';
import { toEngineRound, toPublicCommitment, toPublicRound, toVerificationData } from './presenter';

/**
 * Round lifecycle on top of the engine. Every mutation runs in one transaction that first locks
 * the player row, then the round row, then the commitment row (always in that order, so
 * concurrent requests serialise per player and cannot deadlock). The engine decides outcomes;
 * this module only loads state, applies the engine's transition and persists it.
 */

export async function lockPlayer(tx: Transaction, playerId: string): Promise<PlayerRow> {
  const [player] = await tx.select().from(players).where(eq(players.id, playerId)).for('update');
  if (!player) throw new DomainError('SESSION_REQUIRED', 'Unknown player session');
  return player;
}

async function lockActiveRound(tx: Transaction, playerId: string): Promise<RoundRow | null> {
  const [round] = await tx
    .select()
    .from(rounds)
    .where(and(eq(rounds.playerId, playerId), eq(rounds.status, 'ACTIVE')))
    .for('update');
  return round ?? null;
}

/** Scoped to the player, so another session's round id behaves exactly like a missing one. */
async function lockOwnedRound(
  tx: Transaction,
  playerId: string,
  roundId: string,
): Promise<RoundRow | null> {
  const [round] = await tx
    .select()
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.playerId, playerId)))
    .for('update');
  return round ?? null;
}

/**
 * The single write path for every round state change. Settlement (manual cash-out, auto
 * target, ladder top) credits the payout here and nowhere else; the version and status guards
 * make a second application impossible even if the lock were somehow bypassed.
 */
async function persistTransition(
  tx: Transaction,
  row: RoundRow,
  transition: Transition,
  now: Date,
): Promise<void> {
  const next = transition.round;
  const ended = next.status !== 'ACTIVE';
  const updated = await tx
    .update(rounds)
    .set({
      status: next.status,
      pumpCount: next.pumpCount,
      settlementReason: next.status === 'CASHED_OUT' ? next.settlementReason : null,
      payoutCents: next.status === 'CASHED_OUT' ? next.payoutCents : ended ? 0n : null,
      endedAt: ended ? now : null,
      version: sql`${rounds.version} + 1`,
    })
    .where(and(eq(rounds.id, row.id), eq(rounds.version, row.version), eq(rounds.status, 'ACTIVE')))
    .returning({ id: rounds.id });
  if (updated.length !== 1) throw new Error(`Round ${row.id} changed while locked`);
  if (next.status === 'CASHED_OUT') {
    await postLedgerEntry(tx, {
      playerId: row.playerId,
      roundId: row.id,
      type: 'PAYOUT_CREDIT',
      amountCents: next.payoutCents,
    });
  }
}

function isExpired(row: RoundRow, now: Date): boolean {
  return row.status === 'ACTIVE' && row.expiresAt.getTime() <= now.getTime();
}

async function expireRound(tx: Transaction, row: RoundRow, now: Date): Promise<void> {
  const result = applyAction(PUMP_V1, toEngineRound(row), { type: 'EXPIRE' });
  if (!result.ok) throw new Error(`Cannot expire round ${row.id}: ${result.error.message}`);
  await persistTransition(tx, row, result.value, now);
}

/** Forfeits the player's active round if its 24-hour window has passed. Requires the player lock. */
export async function expireDueRound(tx: Transaction, playerId: string, now: Date): Promise<void> {
  const active = await lockActiveRound(tx, playerId);
  if (active && isExpired(active, now)) await expireRound(tx, active, now);
}

export async function startRound(
  tx: Transaction,
  player: PlayerRow,
  request: StartRoundRequest,
  now: Date,
): Promise<GameState> {
  // runPlayerAction has already forfeited an active round whose 24 hours have passed.
  const active = await lockActiveRound(tx, player.id);
  if (active) {
    throw new DomainError(
      'ACTIVE_ROUND_EXISTS',
      'Finish your current round before starting another',
      active.id,
    );
  }
  const betCents = BigInt(request.betCents);
  if (player.balanceCents < betCents) {
    throw new DomainError('INSUFFICIENT_BALANCE', 'Your balance is too low for this bet');
  }
  const commitment = await lockPreparedCommitment(tx, player.id);
  if (commitment?.id !== request.commitmentId) {
    throw new DomainError(
      'COMMITMENT_MISMATCH',
      'The seed commitment you saw is no longer current; review the new one and bet again',
    );
  }
  const autoCashoutHundredths =
    request.autoCashoutMultiplier === null
      ? null
      : parseMultiplierToHundredths(request.autoCashoutMultiplier);
  const created = createRound(PUMP_V1, {
    betCents,
    autoCashoutHundredths,
    fairness: {
      serverSeed: commitment.serverSeed,
      roundId: commitment.id,
      nonce: commitment.nonce,
      clientSeed: request.clientSeed,
    },
  });
  if (!created.ok) throw new DomainError('VALIDATION_ERROR', created.error.message);

  // All checks passed; nothing above has written anything except a due expiry.
  await resolveCommitment(tx, commitment.id, 'CONSUMED', now);
  await tx.insert(rounds).values({
    id: commitment.id,
    playerId: player.id,
    nonce: commitment.nonce,
    rulesVersion: PUMP_V1.rules.version,
    clientSeed: request.clientSeed,
    betCents,
    autoCashoutHundredths: autoCashoutHundredths === null ? null : Number(autoCashoutHundredths),
    popPoint: created.value.popPoint,
    startedAt: now,
    expiresAt: new Date(now.getTime() + PUMP_V1.rules.roundTtlMs),
  });
  await postLedgerEntry(tx, {
    playerId: player.id,
    roundId: commitment.id,
    type: 'BET_DEBIT',
    amountCents: -betCents,
  });
  await prepareCommitment(tx, player.id);
  return loadGameState(tx, player.id, commitment.id);
}

/** Pump or Cash Out. Requires the player lock (taken by runPlayerAction). */
export async function actOnRound(
  tx: Transaction,
  playerId: string,
  request: RoundActionRequest,
  action: 'PUMP' | 'CASH_OUT',
  now: Date,
): Promise<GameState> {
  const row = await lockOwnedRound(tx, playerId, request.roundId);
  if (!row) throw new DomainError('ROUND_NOT_FOUND', 'Round not found');
  // A due expiry was already applied by runPlayerAction, so it shows up here as EXPIRED.
  if (row.status === 'EXPIRED') {
    throw new DomainError(
      'ROUND_EXPIRED',
      'This round was left unfinished for 24 hours and its bet was forfeited',
      row.id,
    );
  }
  if (row.status !== 'ACTIVE') {
    throw new DomainError('ROUND_NOT_ACTIVE', 'This round has already ended', row.id);
  }
  if (row.version !== request.expectedVersion) {
    throw new DomainError(
      'STALE_ROUND_VERSION',
      'The round changed since you last saw it (another tab or a repeated request)',
      row.id,
    );
  }
  const result = applyAction(PUMP_V1, toEngineRound(row), { type: action });
  if (!result.ok) {
    const code =
      result.error.code === 'CASHOUT_REQUIRES_PUMP' ? result.error.code : 'ROUND_NOT_ACTIVE';
    throw new DomainError(code, result.error.message, row.id);
  }
  await persistTransition(tx, row, result.value, now);
  return loadGameState(tx, playerId, row.id);
}

/** Revokes the unused prepared commitment (revealing its seed) and prepares a fresh one. */
export async function rotateCommitment(
  tx: Transaction,
  playerId: string,
  request: RotateCommitmentRequest,
  now: Date,
): Promise<RotateCommitmentResponse> {
  const current = await lockPreparedCommitment(tx, playerId);
  if (current?.id !== request.commitmentId) {
    throw new DomainError('COMMITMENT_MISMATCH', 'That commitment is no longer the current one');
  }
  await resolveCommitment(tx, current.id, 'REVOKED', now);
  const next = await prepareCommitment(tx, playerId);
  return {
    revoked: {
      id: current.id,
      commitment: current.commitment,
      serverSeed: current.serverSeed.toString('hex'),
    },
    nextCommitment: toPublicCommitment(next),
  };
}

/**
 * Wallet, next commitment and one round: `roundId` when given (if the player owns it),
 * otherwise the player's active round.
 */
export async function loadGameState(
  q: Queryable,
  playerId: string,
  roundId: string | null,
): Promise<GameState> {
  const [player] = await q
    .select({ balanceCents: players.balanceCents })
    .from(players)
    .where(eq(players.id, playerId));
  const [next] = await q
    .select()
    .from(seedCommitments)
    .where(and(eq(seedCommitments.playerId, playerId), eq(seedCommitments.status, 'PREPARED')));
  if (!player || !next) throw new Error(`Player ${playerId} is missing its wallet or commitment`);
  const [focus] = await q
    .select({ round: rounds, commitment: seedCommitments })
    .from(rounds)
    .innerJoin(seedCommitments, eq(seedCommitments.id, rounds.id))
    .where(
      and(
        eq(rounds.playerId, playerId),
        roundId === null ? eq(rounds.status, 'ACTIVE') : eq(rounds.id, roundId),
      ),
    );
  return {
    round: focus ? toPublicRound(focus.round, focus.commitment) : null,
    wallet: { balanceCents: player.balanceCents.toString() },
    nextCommitment: toPublicCommitment(next),
  };
}

/** Finished rounds, newest first, paginated by nonce (creation order). */
export async function loadHistory(
  q: Queryable,
  playerId: string,
  query: HistoryQuery,
): Promise<HistoryResponse> {
  const limit = query.limit ?? HISTORY_PAGE_SIZE_DEFAULT;
  const rows = await q
    .select({ round: rounds, commitment: seedCommitments })
    .from(rounds)
    .innerJoin(seedCommitments, eq(seedCommitments.id, rounds.id))
    .where(
      and(
        eq(rounds.playerId, playerId),
        ne(rounds.status, 'ACTIVE'),
        query.cursor === undefined ? undefined : lt(rounds.nonce, query.cursor),
      ),
    )
    .orderBy(desc(rounds.nonce))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rounds: page.map(({ round, commitment }) => toPublicRound(round, commitment)),
    nextCursor: rows.length > limit && last ? last.round.nonce.toString() : null,
  };
}

export async function loadVerification(
  q: Queryable,
  playerId: string,
  roundId: string,
): Promise<VerifyResponse> {
  const [found] = await q
    .select({ round: rounds, commitment: seedCommitments })
    .from(rounds)
    .innerJoin(seedCommitments, eq(seedCommitments.id, rounds.id))
    .where(and(eq(rounds.id, roundId), eq(rounds.playerId, playerId)));
  if (!found) throw new DomainError('ROUND_NOT_FOUND', 'Round not found');
  if (found.round.status === 'ACTIVE') {
    throw new DomainError(
      'ROUND_IN_PROGRESS',
      'The server seed is revealed when the round ends',
      roundId,
    );
  }
  return {
    round: toPublicRound(found.round, found.commitment),
    verification: toVerificationData(found.round, found.commitment),
  };
}
