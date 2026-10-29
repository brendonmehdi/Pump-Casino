import type {
  GameState,
  HistoryQuery,
  HistoryResponse,
  RotateCommitmentRequest,
  RoundActionRequest,
  StartRoundRequest,
  VerifyResponse,
  Wallet,
} from '@pump/contracts';
import { and, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/client';
import { players, rounds } from '../db/schema';
import { runPlayerAction, type ActionOutcome } from './idempotency';
import {
  actOnRound,
  expireDueRound,
  loadGameState,
  loadHistory,
  loadVerification,
  lockPlayer,
  rotateCommitment,
  startRound,
} from './rounds';
import { createPlayer, findPlayerBySessionToken, type SessionPlayer } from './sessions';

/** Per-request identity and idempotency data for a mutating call. */
export interface ActionRequestContext {
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

/** The service layer the HTTP routes call. Owns the clock so tests can move time. */
export class GameService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  createPlayer(): Promise<{ readonly token: string; readonly player: SessionPlayer }> {
    return createPlayer(this.db);
  }

  findPlayer(token: string): Promise<SessionPlayer | null> {
    return findPlayerBySessionToken(this.db, token);
  }

  async getState(playerId: string): Promise<GameState> {
    await this.resolveExpiry(playerId);
    // One snapshot for wallet, round and commitment, so a cash-out committing in another tab
    // can't produce a response mixing the finished round with the pre-payout balance.
    return this.db.transaction((tx) => loadGameState(tx, playerId, null), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }

  async getWallet(playerId: string): Promise<Wallet> {
    const [player] = await this.db
      .select({ balanceCents: players.balanceCents })
      .from(players)
      .where(eq(players.id, playerId));
    if (!player) throw new Error(`Unknown player ${playerId}`);
    return { balanceCents: player.balanceCents.toString() };
  }

  async getHistory(playerId: string, query: HistoryQuery): Promise<HistoryResponse> {
    await this.resolveExpiry(playerId);
    return loadHistory(this.db, playerId, query);
  }

  async getVerification(playerId: string, roundId: string): Promise<VerifyResponse> {
    await this.resolveExpiry(playerId);
    return loadVerification(this.db, playerId, roundId);
  }

  start(ctx: ActionRequestContext, request: StartRoundRequest): Promise<ActionOutcome> {
    const now = this.clock();
    return runPlayerAction(this.db, { ...ctx, now }, 'START', request, 201, (tx, player) =>
      startRound(tx, player, request, now),
    );
  }

  pump(ctx: ActionRequestContext, request: RoundActionRequest): Promise<ActionOutcome> {
    const now = this.clock();
    return runPlayerAction(this.db, { ...ctx, now }, 'PUMP', request, 200, (tx) =>
      actOnRound(tx, ctx.playerId, request, 'PUMP', now),
    );
  }

  cashOut(ctx: ActionRequestContext, request: RoundActionRequest): Promise<ActionOutcome> {
    const now = this.clock();
    return runPlayerAction(this.db, { ...ctx, now }, 'CASHOUT', request, 200, (tx) =>
      actOnRound(tx, ctx.playerId, request, 'CASH_OUT', now),
    );
  }

  rotateCommitment(
    ctx: ActionRequestContext,
    request: RotateCommitmentRequest,
  ): Promise<ActionOutcome> {
    const now = this.clock();
    return runPlayerAction(this.db, { ...ctx, now }, 'ROTATE', request, 200, (tx) =>
      rotateCommitment(tx, ctx.playerId, request, now),
    );
  }

  /**
   * Lazily applies the 24-hour forfeit rule before a read. The cheap unlocked probe skips the
   * transaction in the normal case; the locked re-check makes it race-free against a
   * concurrent pump or cash-out.
   */
  private async resolveExpiry(playerId: string): Promise<void> {
    const now = this.clock();
    const [due] = await this.db
      .select({ id: rounds.id })
      .from(rounds)
      .where(
        and(eq(rounds.playerId, playerId), eq(rounds.status, 'ACTIVE'), lte(rounds.expiresAt, now)),
      );
    if (!due) return;
    await this.db.transaction(async (tx) => {
      await lockPlayer(tx, playerId);
      await expireDueRound(tx, playerId, now);
    });
  }
}
