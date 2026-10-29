import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  PUMP_V1,
  commitmentFor,
  derivePopPoint,
  drawMessage,
  findFairnessInputProblem,
  sampleUniform,
  traceDraws,
  type FairnessInputs,
} from '../src';
import { TEST_VECTORS } from './vectors';

describe('published test vectors (docs/FAIRNESS.md)', () => {
  for (const vector of TEST_VECTORS) {
    it(`reproduces vector ${vector.name}`, () => {
      const inputs: FairnessInputs = {
        serverSeed: hexToBytes(vector.serverSeedHex),
        roundId: vector.roundId,
        nonce: vector.nonce,
        clientSeed: vector.clientSeed,
      };
      expect(commitmentFor(inputs.serverSeed)).toBe(vector.commitment);
      const draws = traceDraws(PUMP_V1, inputs);
      expect(draws.map((draw) => draw.sample)).toEqual(vector.samples);
      expect(draws.map((draw) => draw.attempts)).toEqual(vector.attempts);
      expect(derivePopPoint(PUMP_V1, inputs)).toBe(vector.popPoint);
    });
  }

  it('includes a vector where the balloon survives the whole ladder', () => {
    expect(TEST_VECTORS.some((vector) => vector.popPoint === null)).toBe(true);
  });

  it('includes a vector that exercises the rejection branch', () => {
    expect(TEST_VECTORS.some((vector) => vector.attempts.some((attempts) => attempts > 1))).toBe(
      true,
    );
  });
});

describe('message encoding', () => {
  it('joins the fields with "|" exactly as specified', () => {
    const inputs: FairnessInputs = {
      serverSeed: new Uint8Array(32),
      roundId: '00000000-0000-4000-8000-000000000001',
      nonce: 42,
      clientSeed: 'abc',
    };
    expect(drawMessage(inputs, 7, 0)).toBe(
      'pump:v1|00000000-0000-4000-8000-000000000001|42|abc|7|0',
    );
  });
});

describe('rejection sampling', () => {
  const digestStartingWith = (value: number): Uint8Array => {
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
  };
  const limit = Math.floor(2 ** 32 / 10_000) * 10_000; // 4_294_960_000

  it('accepts the largest value below the limit', () => {
    expect(sampleUniform(10_000, () => digestStartingWith(limit - 1))).toEqual({
      sample: 9999,
      attempts: 1,
    });
  });

  it('rejects values at or above the limit and moves to the next attempt', () => {
    const digests = [limit, 2 ** 32 - 1, 12_345];
    const result = sampleUniform(10_000, (attempt) => digestStartingWith(digests[attempt] ?? 0));
    expect(result).toEqual({ sample: 2345, attempts: 3 });
  });

  it('reads the first four bytes big-endian', () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x00, 0x00, 0x27, 0x10]); // 10_000
    expect(sampleUniform(10_000, () => bytes).sample).toBe(0);
  });
});

describe('input validation', () => {
  const valid: FairnessInputs = {
    serverSeed: new Uint8Array(32),
    roundId: '0e9f2d3c-7b1a-4c5d-8e6f-0123456789ab',
    nonce: 1,
    clientSeed: 'seed',
  };

  it('accepts valid inputs', () => {
    expect(findFairnessInputProblem(valid)).toBeNull();
  });

  it.each([
    ['short server seed', { serverSeed: new Uint8Array(31) }],
    ['uppercase round id', { roundId: '0E9F2D3C-7B1A-4C5D-8E6F-0123456789AB' }],
    ['malformed round id', { roundId: 'not-a-uuid' }],
    ['zero nonce', { nonce: 0 }],
    ['fractional nonce', { nonce: 1.5 }],
    ['empty client seed', { clientSeed: '' }],
    ['client seed with a space', { clientSeed: 'a b' }],
    ['client seed with the delimiter', { clientSeed: 'a|b' }],
    ['non-ASCII client seed', { clientSeed: 'café' }],
    ['client seed over 64 characters', { clientSeed: 'x'.repeat(65) }],
  ])('rejects %s', (_label, patch) => {
    expect(findFairnessInputProblem({ ...valid, ...patch })).not.toBeNull();
  });

  it('refuses to draw from invalid inputs', () => {
    expect(() => traceDraws(PUMP_V1, { ...valid, nonce: -1 })).toThrow(/nonce/);
  });
});
