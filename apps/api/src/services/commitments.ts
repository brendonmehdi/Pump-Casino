import { randomBytes, randomUUID } from 'node:crypto';
import { SERVER_SEED_BYTES, commitmentFor } from '@pump/engine';
import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { players, seedCommitments, type SeedCommitmentRow } from '../db/schema';

/**
 * Prepares the server seed for a player's next round and commits to it. The round id and nonce
 * are allocated here too, before the player has chosen a client seed, so none of the
 * server-chosen draw inputs can be changed afterwards. Caller must hold the player row lock.
 */
export async function prepareCommitment(
  tx: Transaction,
  playerId: string,
): Promise<SeedCommitmentRow> {
  const [player] = await tx
    .update(players)
    .set({ nextNonce: sql`${players.nextNonce} + 1` })
    .where(eq(players.id, playerId))
    .returning({ nextNonce: players.nextNonce });
  if (!player) throw new Error('Cannot prepare a commitment for an unknown player');
  const serverSeed = randomBytes(SERVER_SEED_BYTES);
  const [commitment] = await tx
    .insert(seedCommitments)
    .values({
      id: randomUUID(),
      playerId,
      nonce: player.nextNonce - 1,
      serverSeed,
      commitment: commitmentFor(serverSeed),
    })
    .returning();
  if (!commitment) throw new Error('Commitment insert returned no row');
  return commitment;
}

export async function lockPreparedCommitment(
  tx: Transaction,
  playerId: string,
): Promise<SeedCommitmentRow | null> {
  const [commitment] = await tx
    .select()
    .from(seedCommitments)
    .where(and(eq(seedCommitments.playerId, playerId), eq(seedCommitments.status, 'PREPARED')))
    .for('update');
  return commitment ?? null;
}

/** Marks a prepared commitment CONSUMED (started a round) or REVOKED (player asked for a new one). */
export async function resolveCommitment(
  tx: Transaction,
  commitmentId: string,
  status: 'CONSUMED' | 'REVOKED',
  now: Date,
): Promise<void> {
  const resolved = await tx
    .update(seedCommitments)
    .set({ status, resolvedAt: now })
    .where(and(eq(seedCommitments.id, commitmentId), eq(seedCommitments.status, 'PREPARED')))
    .returning({ id: seedCommitments.id });
  if (resolved.length !== 1) throw new Error('Commitment was not in the PREPARED state');
}
