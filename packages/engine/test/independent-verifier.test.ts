import fc from 'fast-check';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  PUMP_V1,
  applyAction,
  commitmentFor,
  createRound,
  traceDraws,
  type FairnessInputs,
  type Round,
} from '../src';
import { verifyRevealedRound } from '../../../tools/verify-round.mjs';

/**
 * tools/verify-round.mjs re-implements the published spec with node:crypto and no shared code.
 * If it agrees with the engine on arbitrary rounds, the spec in docs/FAIRNESS.md is sufficient
 * for anyone to verify a round independently.
 */
const fairnessArb: fc.Arbitrary<FairnessInputs> = fc.record({
  serverSeed: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  roundId: fc.uuid(),
  nonce: fc.integer({ min: 1, max: 1_000_000 }),
  clientSeed: fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
});

function play(fairness: FairnessInputs, bet: bigint, target: bigint | null, stopAfter: number) {
  const created = createRound(PUMP_V1, { betCents: bet, autoCashoutHundredths: target, fairness });
  if (!created.ok) throw new Error(created.error.message);
  let round: Round = created.value;
  for (let i = 0; i < stopAfter && round.status === 'ACTIVE'; i += 1) {
    const result = applyAction(PUMP_V1, round, { type: 'PUMP' });
    if (result.ok) round = result.value.round;
  }
  if (round.status === 'ACTIVE') {
    const result = applyAction(PUMP_V1, round, {
      type: round.pumpCount > 0 ? 'CASH_OUT' : 'EXPIRE',
    });
    if (result.ok) round = result.value.round;
  }
  return round;
}

describe('independent verifier (tools/verify-round.mjs)', () => {
  it('agrees with the engine on arbitrary honestly played rounds', () => {
    fc.assert(
      fc.property(
        fairnessArb,
        fc.bigInt({ min: 10n, max: 100_000n }),
        fc.option(fc.bigInt({ min: 101n, max: 100_000n })),
        fc.integer({ min: 0, max: 25 }),
        (fairness, bet, target, stopAfter) => {
          const round = play(fairness, bet, target, stopAfter);
          const result = verifyRevealedRound({
            rulesVersion: 'pump-v1',
            commitment: commitmentFor(fairness.serverSeed),
            serverSeed: bytesToHex(fairness.serverSeed),
            roundId: fairness.roundId,
            nonce: fairness.nonce,
            clientSeed: fairness.clientSeed,
            betCents: bet.toString(),
            autoCashoutHundredths: target === null ? null : target.toString(),
            outcome: {
              status: round.status,
              pumpCount: round.pumpCount,
              settlementReason: round.status === 'CASHED_OUT' ? round.settlementReason : null,
              payoutCents: (round.status === 'CASHED_OUT' ? round.payoutCents : 0n).toString(),
            },
          });
          expect(result.verified).toBe(true);
          expect(result.popPoint).toBe(round.popPoint);
          expect(result.draws.map((d) => d.sample)).toEqual(
            traceDraws(PUMP_V1, fairness).map((d) => d.sample),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects a tampered payout', () => {
    const fairness: FairnessInputs = {
      serverSeed: new Uint8Array(32).fill(7),
      roundId: '00000000-0000-4000-8000-000000000123',
      nonce: 3,
      clientSeed: 'tamper-check',
    };
    const round = play(fairness, 1_000n, null, 1);
    const result = verifyRevealedRound({
      rulesVersion: 'pump-v1',
      commitment: commitmentFor(fairness.serverSeed),
      serverSeed: bytesToHex(fairness.serverSeed),
      roundId: fairness.roundId,
      nonce: fairness.nonce,
      clientSeed: fairness.clientSeed,
      betCents: '1000',
      autoCashoutHundredths: null,
      outcome: {
        status: round.status,
        pumpCount: round.pumpCount,
        settlementReason: round.status === 'CASHED_OUT' ? round.settlementReason : null,
        payoutCents: '999999',
      },
    });
    expect(result.verified).toBe(false);
    expect(result.outcomeMatches).toBe(false);
  });
});
