import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  ErrorResponse,
  HistoryResponse,
  RotateCommitmentResponse,
  VerifyResponse,
} from '@pump/contracts';
import { PUMP_V1, commitmentFor, verifyRound } from '@pump/engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, assertLedgerReconciles, createHarness, type Harness } from './support';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIER = fileURLToPath(new URL('../../../tools/verify-round.mjs', import.meta.url));

let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
beforeEach(() => harness.reset());
afterAll(() => harness.close());

describe('abandoned rounds (24-hour rule)', () => {
  it('stays playable just before 24 hours', async () => {
    const client = await Client.create(harness);
    const round = await client.start({ popPoint: null });
    harness.advanceClock(DAY_MS - 1000);
    expect((await client.pump(round)).status).toBe('ACTIVE');
  });

  it('forfeits the bet after 24 hours, reveals the seed and records it in history', async () => {
    const client = await Client.create(harness);
    const round = await client.pump(await client.start({ betCents: '5000', popPoint: null }));
    harness.advanceClock(DAY_MS);
    const state = await client.state();
    expect(state.round).toBeNull();
    expect(state.wallet.balanceCents).toBe('995000'); // no refund
    const [expired] = (await client.get('/api/history')).json<HistoryResponse>().rounds;
    expect(expired).toMatchObject({
      id: round.id,
      status: 'EXPIRED',
      pumpCount: 1,
      payoutCents: '0',
    });
    expect(expired?.fairness.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    await assertLedgerReconciles(harness.db);
  });

  it('cannot be revived by a late Pump or Cash Out', async () => {
    const client = await Client.create(harness);
    const round = await client.pump(await client.start({ popPoint: null }));
    harness.advanceClock(DAY_MS + 1);
    for (const kind of ['cashout', 'pump'] as const) {
      const response = await client.act(kind, round);
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorResponse>()).toMatchObject({
        error: { code: 'ROUND_EXPIRED' },
        state: { round: { id: round.id, status: 'EXPIRED' } },
      });
    }
    expect(await client.balance()).toBe(999_000n);
  });

  it('resolves exactly once when expiry races a cash-out, reads and a new bet', async () => {
    const client = await Client.create(harness);
    const round = await client.pump(await client.pump(await client.start({ popPoint: null })));
    const { nextCommitment } = await client.state();
    harness.advanceClock(DAY_MS);
    const [cashout, pump, , , start] = await Promise.all([
      client.act('cashout', round),
      client.act('pump', round),
      client.get('/api/pump/current'),
      client.get('/api/history'),
      client.post('/api/pump/start', client.startRequest({}, nextCommitment.id)),
    ]);
    expect(cashout.json<ErrorResponse>().error.code).toBe('ROUND_EXPIRED');
    expect(pump.json<ErrorResponse>().error.code).toBe('ROUND_EXPIRED');
    expect(start.statusCode).toBe(201);
    const rows = await harness.db.execute(
      sql`select status, payout_cents from rounds where id = ${round.id}`,
    );
    expect(rows.rows).toEqual([{ status: 'EXPIRED', payout_cents: '0' }]);
    await assertLedgerReconciles(harness.db);
  });
});

describe('persistence across a restart', () => {
  it('keeps the wallet, the active round and history', async () => {
    const client = await Client.create(harness);
    await client.cashOut(await client.pump(await client.start({ popPoint: null })));
    const active = await client.pump(await client.pump(await client.start({ popPoint: null })));
    const before = await client.state();
    const history = (await client.get('/api/history')).json<HistoryResponse>();

    const restarted = client.on(await harness.restart());
    expect(await restarted.state()).toEqual(before);
    expect((await restarted.get('/api/history')).json<HistoryResponse>()).toEqual(history);
    expect((await restarted.pump(active)).pumpCount).toBe(3);
  });
});

describe('verification', () => {
  it('withholds the seed of an active round', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    const response = await client.get(`/api/rounds/${round.id}/verify`);
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe('ROUND_IN_PROGRESS');
  });

  it('publishes data that two independent verifiers accept', async () => {
    const client = await Client.create(harness);
    const rounds = [
      await client.pump(await client.start({ popPoint: 1 })), // popped
      (await client.cashOut(await client.pump(await client.start({ popPoint: null })))).round,
      await (async () => {
        let round = await client.start({ autoCashout: '1.50', popPoint: null });
        while (round.status === 'ACTIVE') round = await client.pump(round);
        return round;
      })(),
    ];
    for (const round of rounds) {
      if (!round) throw new Error('missing round');
      const response = await client.get(`/api/rounds/${round.id}/verify`);
      expect(response.statusCode).toBe(200);
      const { verification } = response.json<VerifyResponse>();
      const report = verifyRound(PUMP_V1, {
        rulesVersion: verification.rulesVersion,
        commitment: verification.commitment,
        serverSeedHex: verification.serverSeed,
        roundId: verification.roundId,
        nonce: verification.nonce,
        clientSeed: verification.clientSeed,
        betCents: BigInt(verification.betCents),
        autoCashoutHundredths:
          verification.autoCashoutHundredths === null
            ? null
            : BigInt(verification.autoCashoutHundredths),
        recorded: {
          ...verification.outcome,
          payoutCents: BigInt(verification.outcome.payoutCents),
        },
      });
      expect(report.problems).toEqual([]);
      expect(report.verdict).toBe('VERIFIED');
      const cli = spawnSync(process.execPath, [VERIFIER], {
        input: response.body,
        encoding: 'utf8',
      });
      expect(cli.status, cli.stdout + cli.stderr).toBe(0);
      expect(JSON.parse(cli.stdout)).toMatchObject({ verified: true });
    }
  });
});

describe('commitment rotation', () => {
  it('reveals the unused seed, invalidates it and prepares a new commitment', async () => {
    const client = await Client.create(harness);
    const old = (await client.state()).nextCommitment;
    const response = await client.post('/api/fairness/rotate', { commitmentId: old.id });
    expect(response.statusCode).toBe(200);
    const { revoked, nextCommitment } = response.json<RotateCommitmentResponse>();
    expect(revoked.id).toBe(old.id);
    expect(commitmentFor(Buffer.from(revoked.serverSeed, 'hex'))).toBe(old.commitment);
    expect(nextCommitment.id).not.toBe(old.id);
    expect(nextCommitment.nonce).toBe(old.nonce + 1);
    expect((await client.state()).nextCommitment).toEqual(nextCommitment);
  });

  it('applies only one of two simultaneous rotations', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    const responses = await Promise.all([
      client.post('/api/fairness/rotate', { commitmentId: nextCommitment.id }),
      client.post('/api/fairness/rotate', { commitmentId: nextCommitment.id }),
    ]);
    const codes = responses.map((r) => r.statusCode).sort((a, b) => a - b);
    expect(codes).toEqual([200, 409]);
    const prepared = await harness.db.execute(
      sql`select count(*)::int as n from seed_commitments where player_id = ${client.playerId} and status = 'PREPARED'`,
    );
    expect(prepared.rows).toEqual([{ n: 1 }]);
  });
});

describe('operations', () => {
  it('reports health', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('rate-limits request floods and new-session floods', async () => {
    const limited = await createHarness({
      RATE_LIMIT_PER_MINUTE: '5',
      SESSIONS_PER_HOUR_PER_IP: '2',
    });
    try {
      const sessions = [];
      for (let i = 0; i < 3; i += 1) {
        sessions.push(await limited.app.inject({ method: 'POST', url: '/api/session' }));
      }
      expect(sessions.map((r) => r.statusCode)).toEqual([201, 201, 429]);
      const cookie = String(sessions[0]?.headers['set-cookie']).split(';')[0] ?? '';
      const reads = [];
      for (let i = 0; i < 4; i += 1) {
        reads.push(
          await limited.app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie } }),
        );
      }
      expect(reads.at(-1)?.statusCode).toBe(429);
      expect(reads.at(-1)?.json<ErrorResponse>().error.code).toBe('RATE_LIMITED');
      const health = await limited.app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
