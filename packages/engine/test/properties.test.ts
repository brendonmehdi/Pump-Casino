import fc from 'fast-check';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  PUMP_RULES_V1,
  PUMP_V1,
  applyAction,
  commitmentFor,
  createRound,
  derivePopPoint,
  ladderStep,
  traceDraws,
  verifyRound,
  type FairnessInputs,
  type Round,
  type RoundAction,
} from '../src';

const CLIENT_SEED_CHARS = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
  String.fromCharCode(0x21 + i),
).filter((char) => char !== '|');

const fairnessArb: fc.Arbitrary<FairnessInputs> = fc.record({
  serverSeed: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  roundId: fc.uuid(),
  nonce: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  clientSeed: fc.string({
    unit: fc.constantFrom(...CLIENT_SEED_CHARS),
    minLength: 1,
    maxLength: 64,
  }),
});
const betArb = fc.bigInt({ min: PUMP_RULES_V1.minBetCents, max: PUMP_RULES_V1.maxBetCents });
const targetArb = fc.option(
  fc.bigInt({
    min: PUMP_RULES_V1.minAutoCashoutHundredths,
    max: PUMP_RULES_V1.maxAutoCashoutHundredths,
  }),
);
const actionArb: fc.Arbitrary<RoundAction> = fc.constantFrom<RoundAction>(
  { type: 'PUMP' },
  { type: 'CASH_OUT' },
  { type: 'EXPIRE' },
);

function mustCreate(betCents: bigint, target: bigint | null, fairness: FairnessInputs): Round {
  const created = createRound(PUMP_V1, { betCents, autoCashoutHundredths: target, fairness });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe('engine properties', () => {
  it('derives the same pop point from the same inputs, and it is consistent with the draws', () => {
    fc.assert(
      fc.property(fairnessArb, (fairness) => {
        const popPoint = derivePopPoint(PUMP_V1, fairness);
        expect(derivePopPoint(PUMP_V1, fairness)).toBe(popPoint);
        const draws = traceDraws(PUMP_V1, fairness);
        draws.forEach((draw, index) => {
          expect(draw.sample).toBeGreaterThanOrEqual(0);
          expect(draw.sample).toBeLessThan(PUMP_RULES_V1.probabilityScale);
          expect(draw.pops).toBe(index === draws.length - 1 && popPoint !== null);
        });
        expect(popPoint === null || (popPoint >= 1 && popPoint <= 25)).toBe(true);
      }),
    );
  });

  it('keeps every round valid under any sequence of actions', () => {
    fc.assert(
      fc.property(
        betArb,
        targetArb,
        fairnessArb,
        fc.array(actionArb, { maxLength: 40 }),
        (bet, target, fairness, actions) => {
          let round = mustCreate(bet, target, fairness);
          let settlements = 0;
          for (const action of actions) {
            const wasActive = round.status === 'ACTIVE';
            const result = applyAction(PUMP_V1, round, action);
            if (!wasActive) {
              // Terminal rounds are absorbing.
              expect(result.ok).toBe(false);
              continue;
            }
            if (!result.ok) {
              expect(result.error.code).toBe('CASHOUT_REQUIRES_PUMP');
              continue;
            }
            round = result.value.round;
            if (result.value.event.type === 'CASHED_OUT') settlements += 1;
            expect(round.pumpCount).toBeLessThanOrEqual(PUMP_RULES_V1.maxPumps);
            if (round.status === 'ACTIVE') expect(round.pumpCount).toBeLessThan(25);
            if (round.status === 'POPPED') expect(round.popPoint).toBe(round.pumpCount + 1);
            if (round.status === 'CASHED_OUT') {
              const { multiplier } = ladderStep(PUMP_V1, round.pumpCount);
              // Paid at most bet × multiplier and at most bet × 1,000.
              expect(round.payoutCents * multiplier.denominator).toBeLessThanOrEqual(
                bet * multiplier.numerator,
              );
              expect(round.payoutCents).toBeLessThanOrEqual(bet * PUMP_RULES_V1.maxMultiplier);
              expect(round.pumpCount).toBeGreaterThanOrEqual(1);
            }
          }
          expect(settlements).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it('verifies every honestly played round, whatever the strategy', () => {
    fc.assert(
      fc.property(
        betArb,
        targetArb,
        fairnessArb,
        fc.integer({ min: 0, max: 25 }),
        (bet, target, fairness, stopAfter) => {
          let round = mustCreate(bet, target, fairness);
          for (let i = 0; i < stopAfter && round.status === 'ACTIVE'; i += 1) {
            const result = applyAction(PUMP_V1, round, { type: 'PUMP' });
            if (result.ok) round = result.value.round;
          }
          if (round.status === 'ACTIVE') {
            const finish = applyAction(PUMP_V1, round, {
              type: round.pumpCount > 0 ? 'CASH_OUT' : 'EXPIRE',
            });
            if (finish.ok) round = finish.value.round;
          }
          const report = verifyRound(PUMP_V1, {
            rulesVersion: 'pump-v1',
            commitment: commitmentFor(fairness.serverSeed),
            serverSeedHex: bytesToHex(fairness.serverSeed),
            roundId: fairness.roundId,
            nonce: fairness.nonce,
            clientSeed: fairness.clientSeed,
            betCents: bet,
            autoCashoutHundredths: target,
            recorded: {
              status: round.status,
              pumpCount: round.pumpCount,
              settlementReason: round.status === 'CASHED_OUT' ? round.settlementReason : null,
              payoutCents: round.status === 'CASHED_OUT' ? round.payoutCents : 0n,
            },
          });
          expect(report.problems).toEqual([]);
          expect(report.verdict).toBe('VERIFIED');
        },
      ),
      { numRuns: 300 },
    );
  });
});
