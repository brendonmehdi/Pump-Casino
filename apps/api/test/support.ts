import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { GameState, PublicRound } from '@pump/contracts';
import { PUMP_V1, derivePopPoint } from '@pump/engine';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { loadConfig } from '../src/config';
import { createDatabase, type Database } from '../src/db/client';
import { rounds, seedCommitments } from '../src/db/schema';
import { buildApp } from '../src/http/app';
import { GameService } from '../src/services/game-service';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pump:pump_local_only@localhost:55432/pump_test';
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Refuses to run destructive setup against anything that is not a *_test database. */
export function assertTestDatabase(url: string): void {
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`Refusing to use ${new URL(url).pathname} for tests: name must end in _test`);
  }
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly db: Database;
  /** Moves the service clock (rounds expire after 24 hours of this clock). */
  advanceClock(ms: number): void;
  /** Builds a second app instance on the same database, as after a server restart. */
  restart(): Promise<FastifyInstance>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  assertTestDatabase(TEST_DATABASE_URL);
  const { db, pool } = createDatabase(TEST_DATABASE_URL, 20);
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_MINUTE: '1000000',
    SESSIONS_PER_HOUR_PER_IP: '1000000',
    ...env,
  });
  const build = () =>
    buildApp({
      config,
      service: new GameService(db, clock),
      pingDatabase: async () => {
        await pool.query('select 1');
      },
    });
  const first = await build();
  const apps = [first];
  return {
    app: first,
    db,
    advanceClock: (ms) => {
      offsetMs += ms;
    },
    restart: async () => {
      const next = await build();
      apps.push(next);
      return next;
    },
    reset: async () => {
      offsetMs = 0;
      await db.execute(
        sql`truncate action_requests, wallet_transactions, rounds, seed_commitments, players restart identity cascade`,
      );
    },
    close: async () => {
      await Promise.all(apps.map((app) => app.close()));
      await pool.end();
    },
  };
}

/** A browser-like client holding one session cookie. */
export class Client {
  private constructor(
    readonly app: FastifyInstance,
    private readonly db: Database,
    readonly cookie: string,
    readonly playerId: string,
  ) {}

  static async create(harness: Pick<Harness, 'app' | 'db'>): Promise<Client> {
    const response = await harness.app.inject({ method: 'POST', url: '/api/session' });
    expect(response.statusCode).toBe(201);
    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!raw) throw new Error('no session cookie');
    const body = response.json<{ player: { id: string } }>();
    return new Client(harness.app, harness.db, raw.split(';')[0] ?? '', body.player.id);
  }

  /** Same session against a different app instance (e.g. after a restart). */
  on(app: FastifyInstance): Client {
    return new Client(app, this.db, this.cookie, this.playerId);
  }

  get(url: string): Promise<LightMyRequestResponse> {
    return this.app.inject({ method: 'GET', url, headers: { cookie: this.cookie } });
  }

  post(
    url: string,
    body: unknown,
    idempotencyKey: string = randomUUID(),
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    return this.app.inject({
      method: 'POST',
      url,
      payload: JSON.stringify(body),
      headers: {
        cookie: this.cookie,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        ...headers,
      },
    });
  }

  async state(): Promise<GameState> {
    const response = await this.get('/api/pump/current');
    expect(response.statusCode).toBe(200);
    return response.json<GameState>();
  }

  async balance(): Promise<bigint> {
    return BigInt((await this.state()).wallet.balanceCents);
  }

  startRequest(options: StartOptions, commitmentId: string) {
    return {
      betCents: options.betCents ?? '1000',
      clientSeed: options.clientSeed ?? 'test-seed',
      commitmentId,
      autoCashoutMultiplier: options.autoCashout ?? null,
    };
  }

  /** Starts a round; with `popPoint` set, picks a client seed that makes it pop there. */
  async start(options: StartOptions = {}): Promise<PublicRound> {
    const { nextCommitment } = await this.state();
    const clientSeed =
      options.popPoint === undefined
        ? options.clientSeed
        : await clientSeedForPopPoint(this.db, nextCommitment.id, options.popPoint);
    const response = await this.post(
      '/api/pump/start',
      this.startRequest({ ...options, clientSeed }, nextCommitment.id),
    );
    expect(response.statusCode, response.body).toBe(201);
    const round = response.json<GameState>().round;
    if (!round) throw new Error('start returned no round');
    return round;
  }

  act(kind: 'pump' | 'cashout', round: Pick<PublicRound, 'id' | 'version'>, key?: string) {
    return this.post(
      `/api/pump/${kind}`,
      { roundId: round.id, expectedVersion: round.version },
      key ?? randomUUID(),
    );
  }

  async pump(round: PublicRound): Promise<PublicRound> {
    const response = await this.act('pump', round);
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json<GameState>().round;
    if (!next) throw new Error('pump returned no round');
    return next;
  }

  async cashOut(round: PublicRound): Promise<GameState> {
    const response = await this.act('cashout', round);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<GameState>();
  }
}

export interface StartOptions {
  readonly betCents?: string;
  readonly clientSeed?: string | undefined;
  readonly autoCashout?: string | null;
  /** Desired pop point (null = survives all 25 pumps), chosen via the test-only seed oracle. */
  readonly popPoint?: number | null;
}

/**
 * TEST-ONLY ORACLE. Reads the secret prepared server seed straight from the database and searches
 * for a client seed that produces the requested pop point. Real players cannot do this because
 * the seed is only revealed after the round — which is exactly what makes it fair.
 */
export async function clientSeedForPopPoint(
  db: Database,
  commitmentId: string,
  popPoint: number | null,
): Promise<string> {
  const [commitment] = await db
    .select()
    .from(seedCommitments)
    .where(and(eq(seedCommitments.id, commitmentId), eq(seedCommitments.status, 'PREPARED')));
  if (!commitment) throw new Error('commitment not prepared');
  for (let attempt = 0; attempt < 200_000; attempt += 1) {
    const clientSeed = `rig-${attempt.toString()}`;
    const found = derivePopPoint(PUMP_V1, {
      serverSeed: commitment.serverSeed,
      roundId: commitment.id,
      nonce: commitment.nonce,
      clientSeed,
    });
    if (found === popPoint) return clientSeed;
  }
  throw new Error(`no client seed found for pop point ${String(popPoint)}`);
}

export async function storedPopPoint(db: Database, roundId: string): Promise<number | null> {
  const [round] = await db
    .select({ popPoint: rounds.popPoint })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (!round) throw new Error('round not found');
  return round.popPoint;
}

export async function storedServerSeedHex(db: Database, roundId: string): Promise<string> {
  const [commitment] = await db
    .select({ serverSeed: seedCommitments.serverSeed })
    .from(seedCommitments)
    .where(eq(seedCommitments.id, roundId));
  if (!commitment) throw new Error('commitment not found');
  return commitment.serverSeed.toString('hex');
}

/**
 * Ledger integrity for every player: balance equals the sum of entries; the balance_after chain
 * is a running sum; every round has exactly one debit equal to its bet; only cashed-out rounds
 * have a credit, and it equals the payout.
 */
export async function assertLedgerReconciles(db: Database): Promise<void> {
  const balanceMismatch = await db.execute(sql`
    select p.id from players p
    left join wallet_transactions w on w.player_id = p.id
    group by p.id, p.balance_cents
    having p.balance_cents <> coalesce(sum(w.amount_cents), 0)`);
  expect(balanceMismatch.rows).toEqual([]);

  const brokenChain = await db.execute(sql`
    select id from (
      select id, balance_after_cents,
             sum(amount_cents) over (partition by player_id order by id) as running
      from wallet_transactions) t
    where balance_after_cents <> running`);
  expect(brokenChain.rows).toEqual([]);

  const badDebits = await db.execute(sql`
    select r.id from rounds r
    left join wallet_transactions w on w.round_id = r.id and w.entry_type = 'BET_DEBIT'
    group by r.id, r.bet_cents
    having count(w.id) <> 1 or min(w.amount_cents) <> -r.bet_cents`);
  expect(badDebits.rows).toEqual([]);

  const badCredits = await db.execute(sql`
    select r.id from rounds r
    left join wallet_transactions w on w.round_id = r.id and w.entry_type = 'PAYOUT_CREDIT'
    group by r.id, r.status, r.payout_cents
    having (r.status = 'CASHED_OUT' and (count(w.id) <> 1 or min(w.amount_cents) <> r.payout_cents))
        or (r.status <> 'CASHED_OUT' and count(w.id) <> 0)`);
  expect(badCredits.rows).toEqual([]);
}
