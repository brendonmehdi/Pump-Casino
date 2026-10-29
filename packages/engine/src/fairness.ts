import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { ladderStep, type RuleSet } from './rules';

/**
 * Provably-fair draw specification, version 1 (docs/FAIRNESS.md is the human-readable copy).
 *
 * For pump i (1-based) and attempt c (0, 1, …):
 *   digest = HMAC-SHA256(key = serverSeed bytes,
 *                        message = UTF-8("pump:v1|" + roundId + "|" + nonce + "|" + clientSeed
 *                                        + "|" + i + "|" + c))
 *   u      = first 4 digest bytes as an unsigned big-endian integer
 *   accept if u < floor(2^32 / 10000) · 10000, giving sample = u mod 10000; otherwise c += 1
 * Pump i pops exactly when sample < popBasisPoints(i).
 */
export const FAIRNESS_ALGORITHM = 'pump:v1';
export const SERVER_SEED_BYTES = 32;
/** Printable ASCII without space or "|": no Unicode normalisation or delimiter ambiguity. */
export const CLIENT_SEED_PATTERN = /^[\x21-\x7B\x7D\x7E]{1,64}$/;
export const ROUND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const UINT32_RANGE = 2 ** 32;

export interface FairnessInputs {
  /** 32 random bytes, committed to (SHA-256) before the player chose the client seed. */
  readonly serverSeed: Uint8Array;
  /** Canonical lowercase UUID, allocated together with the commitment. */
  readonly roundId: string;
  /** Positive integer, allocated together with the commitment. */
  readonly nonce: number;
  /** Chosen by the player after seeing the commitment. */
  readonly clientSeed: string;
}

export interface PumpDraw {
  readonly pump: number;
  /** Uniform integer in [0, probabilityScale). */
  readonly sample: number;
  /** HMAC evaluations used; more than 1 only when rejection sampling discarded a value. */
  readonly attempts: number;
  readonly popBasisPoints: number;
  readonly pops: boolean;
}

/** Lowercase hex SHA-256 of the raw seed bytes — what players see before the first pump. */
export function commitmentFor(serverSeed: Uint8Array): string {
  return bytesToHex(sha256(serverSeed));
}

/** Returns a human-readable problem with the inputs, or null when they are valid. */
export function findFairnessInputProblem(inputs: FairnessInputs): string | null {
  if (inputs.serverSeed.length !== SERVER_SEED_BYTES) {
    return `server seed must be ${SERVER_SEED_BYTES} bytes`;
  }
  if (!ROUND_ID_PATTERN.test(inputs.roundId)) return 'round id must be a lowercase UUID';
  if (!Number.isSafeInteger(inputs.nonce) || inputs.nonce < 1) {
    return 'nonce must be a positive integer';
  }
  if (!CLIENT_SEED_PATTERN.test(inputs.clientSeed)) {
    return 'client seed must be 1–64 printable ASCII characters without spaces or "|"';
  }
  return null;
}

/** The exact message (before UTF-8 encoding) that is HMAC'd for one draw attempt. */
export function drawMessage(inputs: FairnessInputs, pump: number, attempt: number): string {
  return [FAIRNESS_ALGORITHM, inputs.roundId, inputs.nonce, inputs.clientSeed, pump, attempt].join(
    '|',
  );
}

/**
 * Unbiased integer in [0, range) from a stream of digests. Values in the incomplete top block
 * of the uint32 space are rejected so every result is exactly equally likely.
 */
export function sampleUniform(
  range: number,
  digestForAttempt: (attempt: number) => Uint8Array,
): { readonly sample: number; readonly attempts: number } {
  const limit = Math.floor(UINT32_RANGE / range) * range;
  for (let attempt = 0; ; attempt += 1) {
    const digest = digestForAttempt(attempt);
    const value = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0);
    if (value < limit) return { sample: value % range, attempts: attempt + 1 };
  }
}

export function drawPump(ruleSet: RuleSet, inputs: FairnessInputs, pump: number): PumpDraw {
  const { popBasisPoints } = ladderStep(ruleSet, pump);
  const { sample, attempts } = sampleUniform(ruleSet.rules.probabilityScale, (attempt) =>
    hmac(sha256, inputs.serverSeed, utf8ToBytes(drawMessage(inputs, pump, attempt))),
  );
  return { pump, sample, attempts, popBasisPoints, pops: sample < popBasisPoints };
}

/** Draws pumps 1, 2, … until one pops or the ladder ends. */
export function traceDraws(ruleSet: RuleSet, inputs: FairnessInputs): PumpDraw[] {
  const problem = findFairnessInputProblem(inputs);
  if (problem !== null) throw new RangeError(problem);
  const draws: PumpDraw[] = [];
  for (let pump = 1; pump <= ruleSet.rules.maxPumps; pump += 1) {
    const draw = drawPump(ruleSet, inputs, pump);
    draws.push(draw);
    if (draw.pops) break;
  }
  return draws;
}

/** The pump that pops (1-based), or null when the balloon survives the whole ladder. */
export function derivePopPoint(ruleSet: RuleSet, inputs: FairnessInputs): number | null {
  const last = traceDraws(ruleSet, inputs).at(-1);
  return last?.pops ? last.pump : null;
}
