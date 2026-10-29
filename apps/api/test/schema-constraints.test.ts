import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from './support';

/**
 * The service layer prevents all of these situations itself; these tests prove the database
 * would still refuse them if application code were bypassed or wrong.
 */
let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
beforeEach(() => harness.reset());
afterAll(() => harness.close());

async function expectViolation(statement: Promise<unknown>, name: RegExp): Promise<void> {
  const error: unknown = await statement.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'statement should have been rejected').not.toBeNull();
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const detail =
    cause instanceof Error ? `${cause.message} ${JSON.stringify(cause)}` : String(cause);
  expect(detail).toMatch(name);
}

describe('database constraints', () => {
  it('refuses a negative balance', async () => {
    const client = await Client.create(harness);
    await expectViolation(
      harness.db.execute(sql`update players set balance_cents = -1 where id = ${client.playerId}`),
      /players_balance_non_negative/,
    );
  });

  it('refuses a second active round for the same player', async () => {
    const client = await Client.create(harness);
    await client.start();
    const { nextCommitment } = await client.state();
    await expectViolation(
      harness.db.execute(sql`
        insert into rounds (id, player_id, nonce, rules_version, client_seed, bet_cents,
                            started_at, expires_at)
        values (${nextCommitment.id}, ${client.playerId}, ${nextCommitment.nonce}, 'pump-v1',
                'x', 1000, now(), now() + interval '1 day')`),
      /rounds_one_active_per_player/,
    );
  });

  it('refuses a second prepared commitment for the same player', async () => {
    const client = await Client.create(harness);
    await expectViolation(
      harness.db.execute(sql`
        insert into seed_commitments (id, player_id, nonce, server_seed, commitment)
        values (gen_random_uuid(), ${client.playerId}, 99, decode(repeat('ab', 32), 'hex'),
                repeat('a', 64))`),
      /seed_commitments_one_prepared_per_player/,
    );
  });

  it('refuses a second payout credit for the same round', async () => {
    const client = await Client.create(harness);
    const round = await client.pump(await client.start({ popPoint: null }));
    await client.cashOut(round);
    await expectViolation(
      harness.db.execute(sql`
        insert into wallet_transactions (player_id, round_id, entry_type, amount_cents,
                                         balance_after_cents)
        values (${client.playerId}, ${round.id}, 'PAYOUT_CREDIT', 1054, 2000000)`),
      /wallet_one_entry_per_round_and_type/,
    );
  });

  it('refuses a second starting grant', async () => {
    const client = await Client.create(harness);
    await expectViolation(
      harness.db.execute(sql`
        insert into wallet_transactions (player_id, entry_type, amount_cents, balance_after_cents)
        values (${client.playerId}, 'INITIAL_GRANT', 1000000, 2000000)`),
      /wallet_one_grant_per_player/,
    );
  });

  it('refuses ledger entries with the wrong sign for their type', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    await expectViolation(
      harness.db.execute(sql`
        insert into wallet_transactions (player_id, round_id, entry_type, amount_cents,
                                         balance_after_cents)
        values (${client.playerId}, ${round.id}, 'PAYOUT_CREDIT', -5, 0)`),
      /wallet_entry_shape/,
    );
  });

  it('keeps the ledger append-only', async () => {
    await Client.create(harness);
    await expectViolation(
      harness.db.execute(sql`update wallet_transactions set amount_cents = 1`),
      /append-only/,
    );
    await expectViolation(harness.db.execute(sql`delete from wallet_transactions`), /append-only/);
  });

  it('refuses inconsistent round states', async () => {
    const client = await Client.create(harness);
    const round = await client.start({ popPoint: 3 });
    await expectViolation(
      harness.db.execute(
        sql`update rounds set status = 'CASHED_OUT', ended_at = now() where id = ${round.id}`,
      ),
      /rounds_cashed_out_shape/,
    );
    await expectViolation(
      harness.db.execute(sql`
        update rounds set status = 'POPPED', ended_at = now(), payout_cents = 0, pump_count = 0
        where id = ${round.id}`),
      /rounds_popped_shape/,
    );
    await expectViolation(
      harness.db.execute(sql`update rounds set pump_count = 3 where id = ${round.id}`),
      /rounds_active_shape/,
    );
  });
});
