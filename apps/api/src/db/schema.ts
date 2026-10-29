import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL is the single source of truth for balances and round state. Constraints here are
 * the second line of defence behind the transactional service logic: each invariant the
 * service maintains (non-negative balance, one active round, one debit and at most one credit
 * per round, consistent round states) is also enforced by the database itself.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const cents = (name: string) => bigint(name, { mode: 'bigint' });

export const roundStatus = pgEnum('round_status', ['ACTIVE', 'POPPED', 'CASHED_OUT', 'EXPIRED']);
export const settlementReason = pgEnum('settlement_reason', [
  'MANUAL',
  'AUTO_TARGET',
  'LADDER_TOP',
]);
export const commitmentStatus = pgEnum('commitment_status', ['PREPARED', 'CONSUMED', 'REVOKED']);
export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'INITIAL_GRANT',
  'BET_DEBIT',
  'PAYOUT_CREDIT',
]);
export const playerAction = pgEnum('player_action', ['START', 'PUMP', 'CASHOUT', 'ROTATE']);

/** One anonymous player per browser session. Only a SHA-256 of the session token is stored. */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionTokenHash: bytea('session_token_hash').notNull().unique(),
    balanceCents: cents('balance_cents').notNull(),
    /** Nonce for the next prepared commitment; allocated under the player row lock. */
    nextNonce: integer('next_nonce').notNull().default(1),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('players_balance_non_negative', sql`${t.balanceCents} >= 0`),
    check('players_next_nonce_positive', sql`${t.nextNonce} >= 1`),
    check('players_session_hash_length', sql`octet_length(${t.sessionTokenHash}) = 32`),
  ],
);

/**
 * Server seeds prepared before the player picks a client seed. The id is pre-allocated as the
 * future round id and the nonce is fixed here too, so no server-chosen input to the draw can be
 * changed after the client seed is known.
 */
export const seedCommitments = pgTable(
  'seed_commitments',
  {
    id: uuid('id').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    nonce: integer('nonce').notNull(),
    serverSeed: bytea('server_seed').notNull(),
    commitment: text('commitment').notNull(),
    status: commitmentStatus('status').notNull().default('PREPARED'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    resolvedAt: timestamptz('resolved_at'),
  },
  (t) => [
    uniqueIndex('seed_commitments_one_prepared_per_player')
      .on(t.playerId)
      .where(sql`${t.status} = 'PREPARED'`),
    uniqueIndex('seed_commitments_player_nonce').on(t.playerId, t.nonce),
    check('seed_commitments_seed_length', sql`octet_length(${t.serverSeed}) = 32`),
    check('seed_commitments_commitment_hex', sql`${t.commitment} ~ '^[0-9a-f]{64}$'`),
    check('seed_commitments_nonce_positive', sql`${t.nonce} >= 1`),
    check(
      'seed_commitments_resolution',
      sql`(${t.status} = 'PREPARED') = (${t.resolvedAt} is null)`,
    ),
  ],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => seedCommitments.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    nonce: integer('nonce').notNull(),
    rulesVersion: text('rules_version').notNull(),
    clientSeed: text('client_seed').notNull(),
    betCents: cents('bet_cents').notNull(),
    /** Auto cash-out target in hundredths of a multiplier; null for manual play. */
    autoCashoutHundredths: integer('auto_cashout_hundredths'),
    status: roundStatus('status').notNull().default('ACTIVE'),
    settlementReason: settlementReason('settlement_reason'),
    pumpCount: smallint('pump_count').notNull().default(0),
    /** SERVER-ONLY. Pump that pops (1-based); null when the balloon survives the ladder. */
    popPoint: smallint('pop_point'),
    /** Optimistic concurrency guard; every state change increments it. */
    version: integer('version').notNull().default(0),
    payoutCents: cents('payout_cents'),
    startedAt: timestamptz('started_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    endedAt: timestamptz('ended_at'),
  },
  (t) => [
    uniqueIndex('rounds_one_active_per_player')
      .on(t.playerId)
      .where(sql`${t.status} = 'ACTIVE'`),
    uniqueIndex('rounds_player_nonce').on(t.playerId, t.nonce),
    check('rounds_bet_positive', sql`${t.betCents} > 0`),
    check('rounds_pump_count_non_negative', sql`${t.pumpCount} >= 0`),
    check('rounds_pop_point_positive', sql`${t.popPoint} is null or ${t.popPoint} >= 1`),
    check('rounds_version_non_negative', sql`${t.version} >= 0`),
    check('rounds_expiry_after_start', sql`${t.expiresAt} > ${t.startedAt}`),
    check(
      'rounds_active_shape',
      sql`${t.status} <> 'ACTIVE' or (${t.endedAt} is null and ${t.payoutCents} is null
        and ${t.settlementReason} is null
        and (${t.popPoint} is null or ${t.pumpCount} < ${t.popPoint}))`,
    ),
    check(
      'rounds_cashed_out_shape',
      sql`${t.status} <> 'CASHED_OUT' or (${t.endedAt} is not null and ${t.payoutCents} > 0
        and ${t.settlementReason} is not null and ${t.pumpCount} >= 1
        and (${t.popPoint} is null or ${t.pumpCount} < ${t.popPoint}))`,
    ),
    check(
      'rounds_popped_shape',
      sql`${t.status} <> 'POPPED' or (${t.endedAt} is not null and ${t.payoutCents} = 0
        and ${t.settlementReason} is null and ${t.popPoint} = ${t.pumpCount} + 1)`,
    ),
    check(
      'rounds_expired_shape',
      sql`${t.status} <> 'EXPIRED' or (${t.endedAt} is not null and ${t.payoutCents} = 0
        and ${t.settlementReason} is null
        and (${t.popPoint} is null or ${t.pumpCount} < ${t.popPoint}))`,
    ),
  ],
);

/**
 * Append-only wallet ledger (UPDATE/DELETE are rejected by a trigger, see migration 0001).
 * The balance on `players` must always equal the sum of a player's entries.
 */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    roundId: uuid('round_id').references(() => rounds.id),
    entryType: ledgerEntryType('entry_type').notNull(),
    amountCents: cents('amount_cents').notNull(),
    balanceAfterCents: cents('balance_after_cents').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Idempotency references: one grant per player, one debit and at most one credit per round.
    uniqueIndex('wallet_one_grant_per_player')
      .on(t.playerId)
      .where(sql`${t.entryType} = 'INITIAL_GRANT'`),
    uniqueIndex('wallet_one_entry_per_round_and_type')
      .on(t.roundId, t.entryType)
      .where(sql`${t.roundId} is not null`),
    index('wallet_transactions_player').on(t.playerId, t.id),
    check('wallet_balance_after_non_negative', sql`${t.balanceAfterCents} >= 0`),
    check(
      'wallet_entry_shape',
      sql`(${t.entryType} = 'INITIAL_GRANT' and ${t.roundId} is null and ${t.amountCents} > 0)
        or (${t.entryType} = 'BET_DEBIT' and ${t.roundId} is not null and ${t.amountCents} < 0)
        or (${t.entryType} = 'PAYOUT_CREDIT' and ${t.roundId} is not null and ${t.amountCents} > 0)`,
    ),
  ],
);

/** Stored outcomes of mutating requests, replayed for retries with the same Idempotency-Key. */
export const actionRequests = pgTable(
  'action_requests',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    idempotencyKey: text('idempotency_key').notNull(),
    action: playerAction('action').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: smallint('status_code').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.idempotencyKey] })],
);

export type PlayerRow = typeof players.$inferSelect;
export type SeedCommitmentRow = typeof seedCommitments.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
