import { randomUUID } from 'node:crypto';
import type { ErrorResponse, GameState, PublicRound } from '@pump/contracts';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, assertLedgerReconciles, createHarness, type Harness } from './support';

/**
 * Every test fires requests in parallel. Each runs on its own pooled connection, so the
 * serialisation happens inside PostgreSQL (player row lock + version guard), exactly as it
 * would for simultaneous clicks, retries and multiple tabs in production.
 */
let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
beforeEach(() => harness.reset());
afterAll(async () => {
  await assertLedgerReconciles(harness.db);
  await harness.close();
});

const PARALLEL = 12;

function statuses(responses: readonly LightMyRequestResponse[]): number[] {
  return responses.map((response) => response.statusCode).sort((a, b) => a - b);
}

function errorCodes(responses: readonly LightMyRequestResponse[]): string[] {
  return responses
    .filter((response) => response.statusCode >= 400)
    .map((response) => response.json<ErrorResponse>().error.code);
}

async function countLedger(roundId: string, type: 'BET_DEBIT' | 'PAYOUT_CREDIT'): Promise<number> {
  const result = await harness.db.execute(
    sql`select count(*)::int as n from wallet_transactions where round_id = ${roundId} and entry_type = ${type}`,
  );
  return (result.rows[0] as { n: number }).n;
}

async function pumpedRound(client: Client, pumps: number): Promise<PublicRound> {
  let round = await client.start({ popPoint: null });
  for (let pump = 0; pump < pumps; pump += 1) round = await client.pump(round);
  return round;
}

describe('concurrent requests', () => {
  it('simultaneous bets start exactly one round and take the bet once', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    const body = client.startRequest({ betCents: '50000' }, nextCommitment.id);
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () => client.post('/api/pump/start', body)),
    );
    expect(statuses(responses).filter((status) => status === 201)).toHaveLength(1);
    expect(new Set(errorCodes(responses))).toEqual(new Set(['ACTIVE_ROUND_EXISTS']));
    expect(await client.balance()).toBe(950_000n);
    const started = responses.find((response) => response.statusCode === 201);
    const roundId = started?.json<GameState>().round?.id ?? '';
    expect(await countLedger(roundId, 'BET_DEBIT')).toBe(1);
  });

  it('a player with $5 cannot bet $10, even with many simultaneous attempts', async () => {
    const client = await Client.create(harness);
    for (let loss = 0; loss < 9; loss += 1) {
      await client.pump(await client.start({ betCents: '100000', popPoint: 1 }));
    }
    await client.pump(await client.start({ betCents: '99500', popPoint: 1 }));
    expect(await client.balance()).toBe(500n);
    const { nextCommitment } = await client.state();
    const body = client.startRequest({ betCents: '1000' }, nextCommitment.id);
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () => client.post('/api/pump/start', body)),
    );
    expect(new Set(statuses(responses))).toEqual(new Set([422]));
    expect(new Set(errorCodes(responses))).toEqual(new Set(['INSUFFICIENT_BALANCE']));
    expect(await client.balance()).toBe(500n);
  });

  it('a double-clicked Cash Out pays exactly once', async () => {
    const client = await Client.create(harness);
    const round = await pumpedRound(client, 3);
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () => client.act('cashout', round)),
    );
    expect(statuses(responses).filter((status) => status === 200)).toHaveLength(1);
    expect(new Set(errorCodes(responses))).toEqual(new Set(['ROUND_NOT_ACTIVE']));
    expect(await countLedger(round.id, 'PAYOUT_CREDIT')).toBe(1);
    expect(await client.balance()).toBe(1_000_000n - 1000n + 1298n);
  });

  it('Pump and Cash Out arriving together never both succeed', async () => {
    const client = await Client.create(harness);
    const winners = { pump: 0, cashout: 0 };
    for (let trial = 0; trial < 15; trial += 1) {
      const round = await pumpedRound(client, 1);
      const [pump, cashout] = await Promise.all([
        client.act('pump', round),
        client.act('cashout', round),
      ]);
      expect([pump.statusCode, cashout.statusCode].filter((status) => status === 200)).toHaveLength(
        1,
      );
      if (pump.statusCode === 200) {
        winners.pump += 1;
        expect(cashout.json<ErrorResponse>().error.code).toBe('STALE_ROUND_VERSION');
        const after = pump.json<GameState>().round;
        if (after?.status === 'ACTIVE') await client.cashOut(after);
      } else {
        winners.cashout += 1;
        expect(pump.json<ErrorResponse>().error.code).toBe('ROUND_NOT_ACTIVE');
      }
      expect(await countLedger(round.id, 'PAYOUT_CREDIT')).toBeLessThanOrEqual(1);
    }
    expect(winners.pump + winners.cashout).toBe(15);
  });

  it('two pumps on the same version advance the balloon only once', async () => {
    const client = await Client.create(harness);
    const round = await pumpedRound(client, 2);
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () => client.act('pump', round)),
    );
    expect(statuses(responses).filter((status) => status === 200)).toHaveLength(1);
    expect(new Set(errorCodes(responses))).toEqual(new Set(['STALE_ROUND_VERSION']));
    const current = (await client.state()).round;
    expect(current).toMatchObject({ pumpCount: 3, version: 3 });
  });

  it('a stale request returns the authoritative state so the client can resync', async () => {
    const client = await Client.create(harness);
    const round = await pumpedRound(client, 1);
    const advanced = await client.pump(round);
    const response = await client.act('cashout', round);
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>()).toMatchObject({
      error: { code: 'STALE_ROUND_VERSION' },
      state: { round: { id: round.id, version: advanced.version, pumpCount: 2 } },
    });
  });
});

describe('idempotency', () => {
  it('parallel retries with one Idempotency-Key settle once and all see the same result', async () => {
    const client = await Client.create(harness);
    const round = await pumpedRound(client, 2);
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () => client.act('cashout', round, key)),
    );
    expect(new Set(statuses(responses))).toEqual(new Set([200]));
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    const replayed = responses.filter((r) => r.headers['idempotent-replayed'] === 'true');
    expect(replayed).toHaveLength(PARALLEL - 1);
    expect(await countLedger(round.id, 'PAYOUT_CREDIT')).toBe(1);
  });

  it('a committed action whose response was lost is replayed, not repeated', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    const key = randomUUID();
    const body = client.startRequest({ betCents: '700' }, nextCommitment.id);
    const first = await client.post('/api/pump/start', body, key);
    expect(first.statusCode).toBe(201);
    // The client never saw `first` (timeout) and retries the exact same request.
    const retry = await client.post('/api/pump/start', body, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toBe(first.body);
    expect(await client.balance()).toBe(999_300n);
  });

  it('replays stored errors too, so a retry cannot turn a refusal into an action', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    const key = randomUUID();
    const refused = await client.act('cashout', round, key);
    expect(refused.statusCode).toBe(422);
    await client.pump(round);
    const retry = await client.act('cashout', round, key);
    expect(retry.statusCode).toBe(422);
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects a reused key carrying a different request', async () => {
    const client = await Client.create(harness);
    const round = await pumpedRound(client, 1);
    const key = randomUUID();
    expect((await client.act('pump', round, key)).statusCode).toBe(200);
    const reused = await client.act('cashout', round, key);
    expect(reused.statusCode).toBe(422);
    expect(reused.json<ErrorResponse>().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const tampered = await client.post(
      '/api/pump/pump',
      { roundId: round.id, expectedVersion: round.version + 1 },
      key,
    );
    expect(tampered.json<ErrorResponse>().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes keys per player', async () => {
    const alice = await Client.create(harness);
    const bob = await Client.create(harness);
    const key = randomUUID();
    const aliceRound = await pumpedRound(alice, 1);
    const bobRound = await pumpedRound(bob, 1);
    expect((await alice.act('cashout', aliceRound, key)).statusCode).toBe(200);
    expect((await bob.act('cashout', bobRound, key)).statusCode).toBe(200);
  });
});

describe('many players at once', () => {
  it('keeps every wallet reconciled under a burst of mixed concurrent actions', async () => {
    const clients = await Promise.all(Array.from({ length: 6 }, () => Client.create(harness)));
    await Promise.all(
      clients.map(async (client, index) => {
        for (let roundNumber = 0; roundNumber < 4; roundNumber += 1) {
          let round = await client.start({
            betCents: String(100 + index * 37 + roundNumber),
            popPoint: roundNumber % 2 === 0 ? null : 2,
          });
          while (round.status === 'ACTIVE' && round.pumpCount < 2) {
            // Every pump is sent three times at once, like an impatient triple-click.
            const responses = await Promise.all([
              client.act('pump', round),
              client.act('pump', round),
              client.act('pump', round),
            ]);
            const ok = responses.find((response) => response.statusCode === 200);
            round = ok?.json<GameState>().round ?? round;
          }
          if (round.status === 'ACTIVE') {
            await Promise.all([client.act('cashout', round), client.act('cashout', round)]);
          }
        }
      }),
    );
    await assertLedgerReconciles(harness.db);
    const active = await harness.db.execute(
      sql`select count(*)::int as n from rounds where status = 'ACTIVE'`,
    );
    expect(active.rows).toEqual([{ n: 0 }]);
  });
});
