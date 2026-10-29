import { randomUUID } from 'node:crypto';
import type { ErrorResponse, HistoryResponse } from '@pump/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createHarness,
  storedPopPoint,
  storedServerSeedHex,
  type Harness,
} from './support';

let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
beforeEach(() => harness.reset());
afterAll(() => harness.close());

describe('secrets never reach the client early', () => {
  it('no response during an active round contains its server seed or pop point', async () => {
    const client = await Client.create(harness);
    const responses: LightMyRequestResponse[] = [];
    const record = async (response: Promise<LightMyRequestResponse>) => {
      const resolved = await response;
      responses.push(resolved);
      return resolved;
    };
    const { nextCommitment } = await client.state();
    const started = await record(
      client.post('/api/pump/start', client.startRequest({}, nextCommitment.id)),
    );
    const round = started.json<{ round: { id: string; version: number } }>().round;
    const seedHex = await storedServerSeedHex(harness.db, round.id);
    const popPoint = await storedPopPoint(harness.db, round.id);
    await record(client.get('/api/pump/current'));
    await record(client.get('/api/wallet'));
    await record(client.get('/api/history'));
    await record(client.get(`/api/rounds/${round.id}/verify`));
    await record(client.act('cashout', round));
    for (const response of responses) {
      expect(response.body).not.toContain(seedHex);
      expect(response.body.toLowerCase()).not.toContain('poppoint');
      expect(response.body).not.toMatch(/"pop_?point"/i);
    }
    expect(popPoint === null || popPoint >= 1).toBe(true);
  });

  it('reveals the seed once the round has ended', async () => {
    const client = await Client.create(harness);
    const round = await client.pump(await client.start({ popPoint: 1 }));
    expect(round.status).toBe('POPPED');
    expect(round.fairness.serverSeed).toBe(await storedServerSeedHex(harness.db, round.id));
  });
});

describe('session isolation', () => {
  it("one player cannot act on, verify or list another player's round", async () => {
    const alice = await Client.create(harness);
    const bob = await Client.create(harness);
    const aliceRound = await alice.pump(await alice.start({ popPoint: null }));
    for (const kind of ['pump', 'cashout'] as const) {
      const response = await bob.act(kind, aliceRound);
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorResponse>().state?.round ?? null).toBeNull();
    }
    expect((await bob.get(`/api/rounds/${aliceRound.id}/verify`)).statusCode).toBe(404);
    await alice.cashOut(aliceRound);
    expect((await bob.get(`/api/rounds/${aliceRound.id}/verify`)).statusCode).toBe(404);
    expect((await bob.get('/api/history')).json<HistoryResponse>().rounds).toEqual([]);
    expect(await bob.balance()).toBe(1_000_000n);
  });

  it('ignores forged or malformed session cookies', async () => {
    for (const cookie of ['pump_session=forged', `pump_session=${'A'.repeat(43)}`]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/wallet',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('never trusts a player id sent by the client', async () => {
    const alice = await Client.create(harness);
    const bob = await Client.create(harness);
    const { nextCommitment } = await bob.state();
    const response = await bob.post('/api/pump/start', {
      ...bob.startRequest({}, nextCommitment.id),
      playerId: alice.playerId,
    });
    expect(response.statusCode).toBe(400);
    expect(await alice.balance()).toBe(1_000_000n);
  });
});

describe('request hardening', () => {
  it('rejects cross-site mutations (CSRF)', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    const body = client.startRequest({}, nextCommitment.id);
    const crossOrigin = await client.post('/api/pump/start', body, randomUUID(), {
      origin: 'https://evil.example',
    });
    const crossSite = await client.post('/api/pump/start', body, randomUUID(), {
      'sec-fetch-site': 'cross-site',
    });
    const nullOrigin = await client.post('/api/pump/start', body, randomUUID(), { origin: 'null' });
    for (const response of [crossOrigin, crossSite, nullOrigin]) {
      expect(response.statusCode).toBe(403);
      expect(response.json<ErrorResponse>().error.code).toBe('ORIGIN_REJECTED');
    }
    const sameOrigin = await client.post('/api/pump/start', body, randomUUID(), {
      origin: 'http://localhost:5173',
      host: 'localhost:5173',
      'sec-fetch-site': 'same-origin',
    });
    expect(sameOrigin.statusCode).toBe(201);
  });

  it('accepts only JSON bodies', async () => {
    const client = await Client.create(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/pump/start',
      payload: 'betCents=1000',
      headers: {
        cookie: client.cookie,
        'content-type': 'text/plain',
        'idempotency-key': randomUUID(),
      },
    });
    expect(response.statusCode).toBe(415);
    expect(response.json<ErrorResponse>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects oversized and malformed bodies', async () => {
    const client = await Client.create(harness);
    const big = await client.post('/api/pump/start', { padding: 'x'.repeat(10_000) });
    expect(big.statusCode).toBe(413);
    const broken = await harness.app.inject({
      method: 'POST',
      url: '/api/pump/pump',
      payload: '{"roundId":',
      headers: {
        cookie: client.cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
    });
    expect(broken.statusCode).toBe(400);
  });

  it('requires a well-formed Idempotency-Key on every mutation', async () => {
    const client = await Client.create(harness);
    const round = await client.start();
    for (const key of ['', 'short']) {
      const response = await client.post(
        '/api/pump/pump',
        { roundId: round.id, expectedVersion: 0 },
        key,
      );
      expect(response.statusCode).toBe(400);
    }
  });

  it('validates bets strictly', async () => {
    const client = await Client.create(harness);
    const { nextCommitment } = await client.state();
    for (const betCents of ['9', '100001', '10.00', ' 1000', '-5', '1e3', 'NaN', '']) {
      const response = await client.post(
        '/api/pump/start',
        client.startRequest({ betCents }, nextCommitment.id),
      );
      expect(response.statusCode, betCents).toBe(400);
    }
    expect(await client.balance()).toBe(1_000_000n);
  });

  it('answers unknown API routes with a JSON 404 and never leaks stack traces', async () => {
    const client = await Client.create(harness);
    const missing = await client.get('/api/does-not-exist');
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorResponse>().error.code).toBe('NOT_FOUND');
    const badId = await client.get('/api/rounds/not-a-uuid/verify');
    expect(badId.statusCode).toBe(400);
    expect(badId.body).not.toMatch(/at .*\.ts:\d+/);
  });

  it('sends security headers', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    // Without HTTPS (cookieSecure=false) the upgrade directive would break WebKit on localhost.
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});
