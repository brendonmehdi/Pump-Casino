import type { ErrorResponse, GameState, HistoryResponse } from '@pump/contracts';
import { PUMP_V1, payoutCents } from '@pump/engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, assertLedgerReconciles, createHarness, type Harness } from './support';

let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
beforeEach(() => harness.reset());
afterAll(() => harness.close());

describe('players', () => {
  it('gives a new player $10,000 once, recorded as a single ledger grant', async () => {
    const client = await Client.create(harness);
    expect(await client.balance()).toBe(1_000_000n);
    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { cookie: client.cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ isNew: false, player: { id: client.playerId } });
    expect(again.headers['set-cookie']).toBeUndefined();
    const grants = await harness.db.execute(
      sql`select count(*)::int as n from wallet_transactions where player_id = ${client.playerId}`,
    );
    expect(grants.rows).toEqual([{ n: 1 }]);
  });

  it('sets a hardened session cookie', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/api/session' });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^pump_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
  });

  it('requires a session for every player endpoint', async () => {
    for (const url of ['/api/pump/current', '/api/wallet', '/api/history']) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorResponse>().error.code).toBe('SESSION_REQUIRED');
    }
  });
});

describe('a round', () => {
  it('takes the bet atomically and shows the commitment before the first pump', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    const round = await client.start({ betCents: '2500' });
    expect(round).toMatchObject({
      id: nextCommitment.id,
      status: 'ACTIVE',
      pumpCount: 0,
      version: 0,
      multiplier: null,
      cashoutCents: null,
      nextPopChanceBasisPoints: 800,
      nextMultiplier: '1.05',
      fairness: { commitment: nextCommitment.commitment, nonce: 1, serverSeed: null },
    });
    const state = await client.state();
    expect(state.wallet.balanceCents).toBe('997500');
    expect(state.round?.id).toBe(round.id);
    expect(state.nextCommitment.nonce).toBe(2);
  });

  it('raises the multiplier and the next-pump risk on each surviving pump', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ popPoint: null });
    for (let pump = 1; pump <= 3; pump += 1) {
      round = await client.pump(round);
      expect(round.pumpCount).toBe(pump);
      expect(round.version).toBe(pump);
      expect(round.cashoutCents).toBe(payoutCents(PUMP_V1, 1000n, pump).toString());
      expect(round.nextPopChanceBasisPoints).toBe(800 + 125 * pump);
    }
    expect(round.multiplier).toBe('1.29');
  });

  it('pops on the predetermined pump, keeps the bet, and reveals the seed', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ popPoint: 2 });
    round = await client.pump(round);
    round = await client.pump(round);
    expect(round).toMatchObject({ status: 'POPPED', pumpCount: 1, payoutCents: '0' });
    expect(round.fairness.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(await client.balance()).toBe(999_000n);
  });

  it('refuses to cash out before the first pump', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    const response = await client.act('cashout', round);
    expect(response.statusCode).toBe(422);
    const body = response.json<ErrorResponse>();
    expect(body.error.code).toBe('CASHOUT_REQUIRES_PUMP');
    expect(body.state?.round).toMatchObject({ id: round.id, status: 'ACTIVE', version: 0 });
    expect(await client.balance()).toBe(999_000n);
  });

  it('pays floor(bet × multiplier) on cash out', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ betCents: '333', popPoint: null });
    for (let pump = 0; pump < 4; pump += 1) round = await client.pump(round);
    const state = await client.cashOut(round);
    expect(state.round).toMatchObject({
      status: 'CASHED_OUT',
      settlementReason: 'MANUAL',
      payoutCents: '489', // 333 × 1.470955… = 489.83 → 489
    });
    expect(state.wallet.balanceCents).toBe((1_000_000 - 333 + 489).toString());
    await assertLedgerReconciles(harness.db);
  });

  it('cashes out automatically, inside the pump, when the auto target is reached', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ autoCashout: '2.00', popPoint: null });
    for (let pump = 1; pump <= 6; pump += 1) round = await client.pump(round);
    expect(round.status).toBe('ACTIVE');
    const response = await client.act('pump', round);
    const state = response.json<GameState>();
    expect(state.round).toMatchObject({
      status: 'CASHED_OUT',
      settlementReason: 'AUTO_TARGET',
      pumpCount: 7,
      payoutCents: '2333',
      autoCashoutMultiplier: '2.00',
    });
    expect(state.wallet.balanceCents).toBe((1_000_000 - 1000 + 2333).toString());
    await assertLedgerReconciles(harness.db);
  });

  it('cashes out at the top of the ladder after 25 pumps', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ betCents: '100000', popPoint: null });
    for (let pump = 1; pump <= 25; pump += 1) round = await client.pump(round);
    expect(round).toMatchObject({
      status: 'CASHED_OUT',
      settlementReason: 'LADDER_TOP',
      pumpCount: 25,
      payoutCents: '79401951',
      multiplier: '794.01',
      nextPopChanceBasisPoints: null,
    });
    await assertLedgerReconciles(harness.db);
  });

  it('settles once, as LADDER_TOP, when the auto target and the top coincide', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ autoCashout: '794.01', popPoint: null });
    for (let pump = 1; pump <= 25; pump += 1) round = await client.pump(round);
    expect(round).toMatchObject({ status: 'CASHED_OUT', settlementReason: 'LADDER_TOP' });
    const credits = await harness.db.execute(
      sql`select count(*)::int as n from wallet_transactions where round_id = ${round.id} and entry_type = 'PAYOUT_CREDIT'`,
    );
    expect(credits.rows).toEqual([{ n: 1 }]);
  });

  it('allows only one active round per player', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    const { nextCommitment } = await client.state();
    const response = await client.post(
      '/api/pump/start',
      client.startRequest({}, nextCommitment.id),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>()).toMatchObject({
      error: { code: 'ACTIVE_ROUND_EXISTS' },
      state: { round: { id: round.id, status: 'ACTIVE' } },
    });
    expect(await client.balance()).toBe(999_000n);
  });

  it('refuses a bet larger than the balance', async () => {
    const client = await Client.create(harness);
    // Lose $1,000 ten times (each round pops on its first pump) to empty the wallet.
    for (let loss = 0; loss < 10; loss += 1) {
      const round = await client.start({ betCents: '100000', popPoint: 1 });
      expect((await client.pump(round)).status).toBe('POPPED');
    }
    expect(await client.balance()).toBe(0n);
    const { nextCommitment } = await client.state();
    const response = await client.post(
      '/api/pump/start',
      client.startRequest({ betCents: '10' }, nextCommitment.id),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorResponse>().error.code).toBe('INSUFFICIENT_BALANCE');
    await assertLedgerReconciles(harness.db);
  });

  it('rejects a bet placed against a stale commitment', async () => {
    const client = await Client.create(harness);
    const stale = (await client.state()).nextCommitment;
    const rotated = await client.post('/api/fairness/rotate', { commitmentId: stale.id });
    expect(rotated.statusCode).toBe(200);
    const response = await client.post('/api/pump/start', client.startRequest({}, stale.id));
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe('COMMITMENT_MISMATCH');
    expect(await client.balance()).toBe(1_000_000n);
  });

  it('restores an in-progress round after a refresh', async () => {
    const client = await Client.create(harness);
    let round = await client.start({ popPoint: null });
    round = await client.pump(round);
    round = await client.pump(round);
    const restored = (await client.state()).round;
    expect(restored).toEqual(round);
  });
});

describe('history', () => {
  it('lists finished rounds newest first, paginated, excluding the active round', async () => {
    const client = await Client.create(harness);
    for (let index = 0; index < 12; index += 1) {
      const round = await client.start({ popPoint: 1 });
      await client.pump(round);
    }
    await client.start();
    const first = (await client.get('/api/history?limit=10')).json<HistoryResponse>();
    expect(first.rounds).toHaveLength(10);
    expect(first.rounds.map((round) => round.fairness.nonce)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(first.rounds.every((round) => round.status === 'POPPED')).toBe(true);
    expect(first.nextCursor).toBe('3');
    const second = (await client.get('/api/history?limit=10&cursor=3')).json<HistoryResponse>();
    expect(second.rounds.map((round) => round.fairness.nonce)).toEqual([2, 1]);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects out-of-range page sizes', async () => {
    const client = await Client.create(harness);
    expect((await client.get('/api/history?limit=500')).statusCode).toBe(400);
    expect((await client.get('/api/history?limit=abc')).statusCode).toBe(400);
  });
});
