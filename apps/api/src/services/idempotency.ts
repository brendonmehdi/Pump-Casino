import { createHash } from 'node:crypto';
import { ERROR_STATUS, type ErrorResponse } from '@pump/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { actionRequests, type PlayerRow } from '../db/schema';
import { DomainError } from './errors';
import { expireDueRound, loadGameState, lockPlayer } from './rounds';

export type PlayerAction = 'START' | 'PUMP' | 'CASHOUT' | 'ROTATE';

export interface ActionContext {
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly now: Date;
}

export interface ActionOutcome {
  readonly statusCode: number;
  readonly body: unknown;
  /** True when a stored response is being replayed for a retried Idempotency-Key. */
  readonly replayed: boolean;
}

/**
 * Runs one mutating player action at most once per Idempotency-Key, in a single transaction:
 *
 * 1. Lock the player row. Every mutation for a player serialises here, so a retry racing its
 *    original waits for it to commit and then sees the stored outcome.
 * 2. Replay the stored outcome for a known key (or reject the key if the payload differs).
 * 3. Forfeit an expired round (housekeeping that must persist whatever the action does).
 * 4. Run the action inside a savepoint. A DomainError rolls back everything the action wrote,
 *    and its error response (with the authoritative state) is stored like a success, so a
 *    retry gets the same answer. Any other error aborts the whole transaction.
 */
export async function runPlayerAction(
  db: Database,
  ctx: ActionContext,
  action: PlayerAction,
  request: unknown,
  successStatus: number,
  execute: (tx: Transaction, player: PlayerRow) => Promise<unknown>,
): Promise<ActionOutcome> {
  const requestHash = hashRequest(action, request);
  return db.transaction(async (tx) => {
    const player = await lockPlayer(tx, ctx.playerId);
    const [stored] = await tx
      .select()
      .from(actionRequests)
      .where(
        and(
          eq(actionRequests.playerId, ctx.playerId),
          eq(actionRequests.idempotencyKey, ctx.idempotencyKey),
        ),
      );
    if (stored) {
      if (stored.action === action && stored.requestHash === requestHash) {
        return { statusCode: stored.statusCode, body: stored.responseBody, replayed: true };
      }
      const reused = new DomainError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
      );
      return {
        statusCode: ERROR_STATUS[reused.code],
        body: errorBody(reused, ctx),
        replayed: false,
      };
    }

    await expireDueRound(tx, ctx.playerId, ctx.now);
    let outcome: { statusCode: number; body: unknown };
    try {
      const body = await tx.transaction((savepoint) => execute(savepoint, player));
      outcome = { statusCode: successStatus, body };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const body: ErrorResponse = {
        ...errorBody(error, ctx),
        state: await loadGameState(tx, ctx.playerId, error.roundId),
      };
      outcome = { statusCode: ERROR_STATUS[error.code], body };
    }
    await tx.insert(actionRequests).values({
      playerId: ctx.playerId,
      idempotencyKey: ctx.idempotencyKey,
      action,
      requestHash,
      statusCode: outcome.statusCode,
      responseBody: outcome.body,
    });
    return { ...outcome, replayed: false };
  });
}

function errorBody(error: DomainError, ctx: ActionContext): ErrorResponse {
  return { error: { code: error.code, message: error.message, requestId: ctx.requestId } };
}

function hashRequest(action: PlayerAction, request: unknown): string {
  return createHash('sha256').update(canonicalJson({ action, request })).digest('hex');
}

/** JSON with object keys sorted, so equal payloads always hash equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
