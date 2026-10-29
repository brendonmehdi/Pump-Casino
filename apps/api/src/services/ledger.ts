import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { players, walletTransactions } from '../db/schema';
import { DomainError } from './errors';

export type LedgerEntryType = 'INITIAL_GRANT' | 'BET_DEBIT' | 'PAYOUT_CREDIT';

export interface LedgerEntry {
  readonly playerId: string;
  readonly roundId: string | null;
  readonly type: LedgerEntryType;
  /** Signed: negative for debits. */
  readonly amountCents: bigint;
}

/**
 * The only code path that changes a balance. In the caller's transaction it moves the balance
 * (refusing to go below zero) and appends the matching immutable ledger entry, so the balance
 * always equals the sum of the player's entries. Unique indexes on the ledger reject a second
 * debit or credit for the same round even if a caller were to retry by mistake.
 */
export async function postLedgerEntry(tx: Transaction, entry: LedgerEntry): Promise<bigint> {
  const [updated] = await tx
    .update(players)
    .set({ balanceCents: sql`${players.balanceCents} + ${entry.amountCents}` })
    .where(
      and(eq(players.id, entry.playerId), sql`${players.balanceCents} + ${entry.amountCents} >= 0`),
    )
    .returning({ balanceCents: players.balanceCents });
  if (!updated)
    throw new DomainError('INSUFFICIENT_BALANCE', 'Your balance is too low for this bet');
  await tx.insert(walletTransactions).values({
    playerId: entry.playerId,
    roundId: entry.roundId,
    entryType: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: updated.balanceCents,
  });
  return updated.balanceCents;
}
