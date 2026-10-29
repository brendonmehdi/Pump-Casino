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
  if (v.rulesVersion !== 'pump-v1') throw new Error(`Unsupported rules version ${v.rulesVersion}`);
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
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const raw = readFileSync(process.argv[2] ?? 0, 'utf8');
  const parsed = JSON.parse(raw);
  const result = verifyRevealedRound(parsed.verification ?? parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verified ? 0 : 1;
}
