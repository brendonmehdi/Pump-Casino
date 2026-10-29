import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  PUMP_V1,
  applyAction,
  createRound,
  derivePopPoint,
  ladderStep,
  payoutCents,
  type FairnessInputs,
  type Ratio,
  type Round,
} from '../src';

/**
 * Monte Carlo evidence on top of the exact proof in ladder.test.ts. Seeds are derived
 * deterministically, so every run replays the same 100,000 rounds through the real fairness
 * derivation. Statistical checks use a 5σ band: wide enough that a correct implementation
 * cannot fail by bad luck, narrow enough that a wrong hazard or multiplier at the early,
 * frequently reached steps would fail.
 */
const ROUNDS = 100_000;
const BET_CENTS = 100_000n; // $1,000: makes cent rounding negligible next to sampling noise
const Z_LIMIT = 5;

function simulationInputs(index: number): FairnessInputs {
  return {
    serverSeed: sha256(utf8ToBytes(`pump-simulation|${index}`)),
    roundId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    nonce: index + 1,
    clientSeed: 'simulation',
  };
}

const popPoints = Array.from({ length: ROUNDS }, (_, index) =>
  derivePopPoint(PUMP_V1, simulationInputs(index)),
);
const survives = (popPoint: number | null, pumps: number) => popPoint === null || popPoint > pumps;
const toNumber = (value: Ratio) => Number(value.numerator) / Number(value.denominator);

describe(`${ROUNDS.toLocaleString('en-US')}-round seeded simulation`, () => {
  it('pops each pump at its configured rate', () => {
    for (const step of PUMP_V1.ladder) {
      const reached = popPoints.filter((popPoint) => survives(popPoint, step.pump - 1)).length;
      if (reached < 1_000) continue; // too few rounds this deep for a meaningful rate
      const popped = popPoints.filter((popPoint) => popPoint === step.pump).length;
      const p = step.popBasisPoints / 10_000;
      const z = (popped / reached - p) / Math.sqrt((p * (1 - p)) / reached);
      expect(Math.abs(z), `pump ${step.pump}: ${popped}/${reached} vs ${p}`).toBeLessThan(Z_LIMIT);
    }
  });

  it('returns 97% at every fixed cash-out point', () => {
    for (const step of PUMP_V1.ladder) {
      const wins = popPoints.filter((popPoint) => survives(popPoint, step.pump)).length;
      const paid = BigInt(wins) * payoutCents(PUMP_V1, BET_CENTS, step.pump);
      const observed = Number(paid) / Number(BigInt(ROUNDS) * BET_CENTS);
      const s = toNumber(step.survival);
      const sigma = 0.97 * Math.sqrt((1 - s) / (s * ROUNDS));
      expect(Math.abs(observed - 0.97), `cash out at pump ${step.pump}: ${observed}`).toBeLessThan(
        Z_LIMIT * sigma,
      );
    }
  });

  it('returns 97% when played through the engine with a 2.00× auto cash-out', () => {
    let wagered = 0n;
    let paid = 0n;
    for (let index = 0; index < ROUNDS; index += 1) {
      const created = createRound(PUMP_V1, {
        betCents: BET_CENTS,
        autoCashoutHundredths: 200n,
        fairness: simulationInputs(index),
      });
      if (!created.ok) throw new Error(created.error.message);
      let round: Round = created.value;
      wagered += round.betCents;
      while (round.status === 'ACTIVE') {
        const result = applyAction(PUMP_V1, round, { type: 'PUMP' });
        if (!result.ok) throw new Error(result.error.message);
        round = result.value.round;
      }
      if (round.status === 'CASHED_OUT') {
        expect(round.pumpCount).toBe(7); // 2.00× is first met on pump 7 (2.33×)
        paid += round.payoutCents;
      }
    }
    const observed = Number(paid) / Number(wagered);
    const s = toNumber(ladderStep(PUMP_V1, 7).survival);
    const sigma = 0.97 * Math.sqrt((1 - s) / (s * ROUNDS));
    expect(Math.abs(observed - 0.97)).toBeLessThan(Z_LIMIT * sigma);
  });
});
