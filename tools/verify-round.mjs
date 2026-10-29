#!/usr/bin/env node
/**
 * Independent Pump round verifier.
 *
 * Written only from the published specification in docs/FAIRNESS.md and docs/MATH.md, using
 * nothing but Node's built-in crypto. It deliberately shares no code with the game engine, so
 * agreement between the two is evidence that the specification is complete.
 *
 * Usage:
 *   node tools/verify-round.mjs round.json
 *   curl -s -b cookies.txt https://<host>/api/rounds/<id>/verify | node tools/verify-round.mjs
 *
 * Input: the JSON returned by GET /api/rounds/:id/verify (or its `verification` object).
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SCALE = 10_000;
const MAX_PUMPS = 25;
const LIMIT = Math.floor(2 ** 32 / SCALE) * SCALE;
const popBasisPoints = (pump) => 800 + 125 * (pump - 1);

/** Chance of pump n popping is popBasisPoints(n) / 10000; multiplier M(n) = 0.97 / S(n). */
function multiplier(pumps) {
  let numerator = 97n;
  let denominator = 100n;
  for (let pump = 1; pump <= pumps; pump += 1) {
    numerator *= BigInt(SCALE);
    denominator *= BigInt(SCALE - popBasisPoints(pump));
  }
  return { numerator, denominator };
}

const payout = (betCents, pumps) => {
  const m = multiplier(pumps);
  return (betCents * m.numerator) / m.denominator;
};

function draw(seed, v, pump) {
  for (let attempt = 0; ; attempt += 1) {
    const message = `pump:v1|${v.roundId}|${v.nonce}|${v.clientSeed}|${pump}|${attempt}`;
    const u = createHmac('sha256', seed).update(message, 'utf8').digest().readUInt32BE(0);
    if (u < LIMIT) return { pump, sample: u % SCALE, attempts: attempt + 1 };
  }
}

/** Plays the recorded actions against the recomputed pop point. */
function replay(popPoint, v, betCents) {
  const target = v.autoCashoutHundredths === null ? null : BigInt(v.autoCashoutHundredths);
  const recorded = v.outcome;
  const pumpsToTry = recorded.status === 'POPPED' ? recorded.pumpCount + 1 : recorded.pumpCount;
  let pumps = 0;
  for (let pump = 1; pump <= pumpsToTry; pump += 1) {
    if (pump === popPoint) return { status: 'POPPED', pumpCount: pumps, reason: null, payout: 0n };
    pumps = pump;
    if (pump === MAX_PUMPS) return settled(pumps, 'LADDER_TOP', betCents);
    const m = multiplier(pump);
    if (target !== null && m.numerator * 100n >= target * m.denominator) {
      return settled(pumps, 'AUTO_TARGET', betCents);
    }
  }
  if (recorded.status === 'CASHED_OUT' && pumps > 0) return settled(pumps, 'MANUAL', betCents);
  if (recorded.status === 'EXPIRED')
    return { status: 'EXPIRED', pumpCount: pumps, reason: null, payout: 0n };
  return { status: 'ACTIVE', pumpCount: pumps, reason: null, payout: 0n };
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const ROUND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_SEED = /^[\x21-\x7B\x7D\x7E]{1,64}$/; // printable ASCII without space or "|"
const INTEGER = /^(0|[1-9][0-9]*)$/;

/** The encoding and range rules of the specification; anything else cannot be a real round. */
function inputProblems(v) {
  const problems = [];
  const inRange = (text, min, max) =>
    typeof text === 'string' && INTEGER.test(text) && BigInt(text) >= min && BigInt(text) <= max;
  if (v.rulesVersion !== 'pump-v1')
    problems.push(`unsupported rules version ${String(v.rulesVersion)}`);
  if (!HEX_32_BYTES.test(v.serverSeed))
    problems.push('server seed must be 64 lowercase hex characters');
  if (!HEX_32_BYTES.test(v.commitment))
    problems.push('commitment must be 64 lowercase hex characters');
  if (!ROUND_ID.test(v.roundId)) problems.push('round id must be a lowercase UUID');
  if (!Number.isSafeInteger(v.nonce) || v.nonce < 1)
    problems.push('nonce must be a positive integer');
  if (!CLIENT_SEED.test(v.clientSeed)) problems.push('client seed is not in the allowed alphabet');
  if (!inRange(v.betCents, 10n, 100_000n)) problems.push('bet must be 10 to 100000 cents');
  if (v.autoCashoutHundredths !== null && !inRange(v.autoCashoutHundredths, 101n, 100_000n)) {
    problems.push('auto cash-out must be null or 101 to 100000 hundredths');
  }
  const outcome = v.outcome ?? {};
  if (!['POPPED', 'CASHED_OUT', 'EXPIRED'].includes(outcome.status)) {
    problems.push('only finished rounds (POPPED, CASHED_OUT, EXPIRED) can be verified');
  }
  if (
    !Number.isInteger(outcome.pumpCount) ||
    outcome.pumpCount < 0 ||
    outcome.pumpCount > MAX_PUMPS
  ) {
    problems.push('pump count must be 0 to 25');
  }
  if (!inRange(outcome.payoutCents, 0n, 10n ** 15n)) problems.push('payout must be integer cents');
  return problems;
}

function settled(pumps, reason, betCents) {
  return { status: 'CASHED_OUT', pumpCount: pumps, reason, payout: payout(betCents, pumps) };
}

/**
 * @param {{ rulesVersion: string, commitment: string, serverSeed: string, roundId: string,
 *   nonce: number, clientSeed: string, betCents: string, autoCashoutHundredths: string | null,
 *   outcome: { status: string, pumpCount: number, settlementReason: string | null,
 *   payoutCents: string } }} v
 */
export function verifyRevealedRound(v) {
  const problems = inputProblems(v);
  if (problems.length > 0) {
    return {
      verified: false,
      commitmentMatches: false,
      outcomeMatches: false,
      popPoint: null,
      draws: [],
      replayed: null,
      problems,
    };
  }
  const seed = Buffer.from(v.serverSeed, 'hex');
  const commitmentMatches = createHash('sha256').update(seed).digest('hex') === v.commitment;
  const draws = [];
  let popPoint = null;
  for (let pump = 1; pump <= MAX_PUMPS && popPoint === null; pump += 1) {
    const d = draw(seed, v, pump);
    draws.push(d);
    if (d.sample < popBasisPoints(pump)) popPoint = pump;
  }
  const betCents = BigInt(v.betCents);
  const replayed = replay(popPoint, v, betCents);
  const outcomeMatches =
    replayed.status === v.outcome.status &&
    replayed.pumpCount === v.outcome.pumpCount &&
    replayed.reason === v.outcome.settlementReason &&
    replayed.payout === BigInt(v.outcome.payoutCents);
  return {
    verified: commitmentMatches && outcomeMatches,
    commitmentMatches,
    outcomeMatches,
    popPoint,
    draws,
    replayed: { ...replayed, payout: replayed.payout.toString() },
    problems: [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
  const parsed = JSON.parse(raw);
  const result = verifyRevealedRound(parsed.verification ?? parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verified ? 0 : 1;
}
