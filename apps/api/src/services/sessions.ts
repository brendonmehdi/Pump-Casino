import { createHash, randomBytes } from 'node:crypto';
import { PUMP_V1 } from '@pump/engine';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { players } from '../db/schema';
import { prepareCommitment } from './commitments';
import { postLedgerEntry } from './ledger';

const SESSION_TOKEN_BYTES = 32;
/** base64url of 32 bytes, no padding. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionPlayer {
  readonly id: string;
  readonly createdAt: Date;
}

/** Only this hash is stored; a database leak does not reveal usable session tokens. */
function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Creates an anonymous player with the one-time $10,000 grant (as a ledger entry, so the
 * balance reconciles from the first moment) and its first seed commitment, atomically.
 */
export async function createPlayer(
  db: Database,
): Promise<{ readonly token: string; readonly player: SessionPlayer }> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const player = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(players)
      .values({ sessionTokenHash: hashSessionToken(token), balanceCents: 0n })
      .returning({ id: players.id, createdAt: players.createdAt });
    if (!created) throw new Error('Player insert returned no row');
    await postLedgerEntry(tx, {
      playerId: created.id,
      roundId: null,
      type: 'INITIAL_GRANT',
      amountCents: PUMP_V1.rules.startingBalanceCents,
    });
    await prepareCommitment(tx, created.id);
    return created;
  });
  return { token, player };
}

export async function findPlayerBySessionToken(
  db: Database,
  token: string,
): Promise<SessionPlayer | null> {
  if (!SESSION_TOKEN_PATTERN.test(token)) return null;
  const [player] = await db
    .select({ id: players.id, createdAt: players.createdAt })
    .from(players)
    .where(eq(players.sessionTokenHash, hashSessionToken(token)));
  return player ?? null;
}
