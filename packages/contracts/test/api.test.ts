import { describe, expect, it } from 'vitest';
import {
  ERROR_STATUS,
  historyQuerySchema,
  idempotencyKeySchema,
  publicRoundSchema,
  roundActionRequestSchema,
  startRoundRequestSchema,
  type PublicRound,
} from '../src';

const validStart = {
  betCents: '1000',
  clientSeed: 'my-seed',
  commitmentId: '0e9f2d3c-7b1a-4c5d-8e6f-0123456789ab',
  autoCashoutMultiplier: null,
};

describe('startRoundRequestSchema', () => {
  it('accepts a valid request, with or without an auto cash-out', () => {
    expect(startRoundRequestSchema.safeParse(validStart).success).toBe(true);
    expect(
      startRoundRequestSchema.safeParse({ ...validStart, autoCashoutMultiplier: '2.50' }).success,
    ).toBe(true);
  });

  it.each([
    ['bet below the minimum', { betCents: '9' }],
    ['bet above the maximum', { betCents: '100001' }],
    ['bet as a JSON number', { betCents: 1000 }],
    ['bet with decimals', { betCents: '10.00' }],
    ['bet with whitespace', { betCents: ' 1000' }],
    ['negative bet', { betCents: '-1000' }],
    ['overflowing bet', { betCents: '99999999999999999999' }],
    ['client seed with a space', { clientSeed: 'a b' }],
    ['oversized client seed', { clientSeed: 'x'.repeat(65) }],
    ['uppercase commitment id', { commitmentId: '0E9F2D3C-7B1A-4C5D-8E6F-0123456789AB' }],
    ['auto cash-out of 1.00×', { autoCashoutMultiplier: '1.00' }],
    ['auto cash-out above 1,000×', { autoCashoutMultiplier: '1000.01' }],
    ['auto cash-out with 3 decimals', { autoCashoutMultiplier: '2.505' }],
    ['missing auto cash-out', { autoCashoutMultiplier: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(startRoundRequestSchema.safeParse({ ...validStart, ...patch }).success).toBe(false);
  });

  it('rejects unknown fields such as a client-supplied player id', () => {
    const result = startRoundRequestSchema.safeParse({ ...validStart, playerId: 'someone-else' });
    expect(result.success).toBe(false);
  });
});

describe('roundActionRequestSchema', () => {
  const valid = { roundId: '0e9f2d3c-7b1a-4c5d-8e6f-0123456789ab', expectedVersion: 3 };

  it('accepts a valid request', () => {
    expect(roundActionRequestSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['fractional version', { expectedVersion: 1.5 }],
    ['negative version', { expectedVersion: -1 }],
    ['string version', { expectedVersion: '3' }],
    ['NaN version', { expectedVersion: Number.NaN }],
    ['infinite version', { expectedVersion: Number.POSITIVE_INFINITY }],
  ])('rejects a %s', (_label, patch) => {
    expect(roundActionRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('historyQuerySchema', () => {
  it('parses limit and cursor strings strictly', () => {
    expect(historyQuerySchema.parse({ limit: '10', cursor: '42' })).toEqual({
      limit: 10,
      cursor: 42,
    });
    expect(historyQuerySchema.parse({})).toEqual({});
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: '1e1' }, { limit: ' 5' }, { cursor: '-1' }])(
    'rejects %j',
    (query) => {
      expect(historyQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('idempotencyKeySchema', () => {
  it('accepts UUIDs and rejects short or unsafe keys', () => {
    expect(idempotencyKeySchema.safeParse('6f1d3c1e-2a4b-4c8d-9e0f-1a2b3c4d5e6f').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('a'.repeat(65)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in the key!!').success).toBe(false);
  });
});

describe('publicRoundSchema', () => {
  const active: PublicRound = {
    id: '0e9f2d3c-7b1a-4c5d-8e6f-0123456789ab',
    status: 'ACTIVE',
    settlementReason: null,
    version: 1,
    betCents: '1000',
    pumpCount: 1,
    maxPumps: 25,
    multiplier: '1.05',
    cashoutCents: '1054',
    nextPopChanceBasisPoints: 925,
    nextMultiplier: '1.16',
    autoCashoutMultiplier: null,
    payoutCents: null,
    startedAt: '2026-10-29T04:00:00.000Z',
    endedAt: null,
    expiresAt: '2026-10-30T04:00:00.000Z',
    fairness: {
      rulesVersion: 'pump-v1',
      commitment: 'a'.repeat(64),
      clientSeed: 'seed',
      nonce: 1,
      serverSeed: null,
    },
  };

  it('accepts an active round without a revealed seed', () => {
    expect(publicRoundSchema.safeParse(active).success).toBe(true);
  });

  it('refuses an active round that carries the server seed', () => {
    const leaking = { ...active, fairness: { ...active.fairness, serverSeed: 'b'.repeat(64) } };
    expect(publicRoundSchema.safeParse(leaking).success).toBe(false);
  });

  it('refuses any extra field, so a hidden pop point can never be serialised', () => {
    expect(publicRoundSchema.safeParse({ ...active, popPoint: 4 }).success).toBe(false);
  });

  it('refuses a finished round without its seed', () => {
    expect(publicRoundSchema.safeParse({ ...active, status: 'POPPED' }).success).toBe(false);
  });
});

describe('ERROR_STATUS', () => {
  it('maps every code to a 4xx or 5xx status', () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status >= 400 && status < 600).toBe(true);
    }
  });
});
