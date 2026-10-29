#!/usr/bin/env node
/**
 * Smoke test for a deployed Pump instance, using nothing but Node's built-in fetch.
 *
 * It plays real rounds over the public API (play money; outcomes are not rigged) and checks the
 * wallet, bets, pumps, cash-outs, idempotent retries, a double-clicked cash-out, history,
 * round restore, fairness verification, security headers, cookie flags, and that no seed or
 * internal detail appears in any response before it should.
 *
 * Usage:
 *   node tools/smoke-production.mjs https://<host> [--save session.json]
 *   node tools/smoke-production.mjs https://<host> --resume session.json
 *
 * A normal run ends with one round left open. --save writes that session to a file; after a
 * restart or redeploy, --resume checks that the same session still has the same balance and the
 * same open round, then cashes it out and verifies it. The file holds a play-money session
 * cookie: keep it out of the repository.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyRevealedRound } from './verify-round.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const base = URL.canParse(args[0] ?? '') ? new URL(args[0]).origin : '';
if (!/^https?:\/\//.test(base)) {
  process.stderr.write(
    'Usage: node tools/smoke-production.mjs https://<host> [--save file | --resume file]\n',
  );
  process.exit(2);
}
const https = base.startsWith('https://');
const savePath = option('--save');
const resumePath = option('--resume');

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}\n`);
}

/** One player: a cookie jar, plus every API response in order for the leak checks. */
class Player {
  cookie = null;
  setCookies = [];
  responses = [];

  async request(method, path, { body, key, headers = {} } = {}) {
    const sent = {
      accept: 'application/json',
      // What a browser sends with the game's own requests; other origins are refused.
      origin: base,
      'sec-fetch-site': 'same-origin',
      ...headers,
    };
    if (this.cookie) sent.cookie = this.cookie;
    if (key) sent['idempotency-key'] = key;
    if (body !== undefined && !sent['content-type']) sent['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method,
      headers: sent,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(90_000),
    });
    for (const header of response.headers.getSetCookie()) {
      this.setCookies.push(header);
      const pair = header.split(';')[0] ?? '';
      if (pair.startsWith('pump_session=')) this.cookie = pair;
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: such responses are checked by status only.
    }
    this.responses.push({ path, text, json });
    return { status: response.status, headers: response.headers, json, text };
  }

  action(path, body) {
    return this.request('POST', path, { body, key: randomUUID() });
  }
}

const isHex64 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Waits out a cold start: an idle free instance can take about a minute to wake up. */
async function waitForHealth() {
  const started = Date.now();
  let last = 'no response';
  while (Date.now() - started < 240_000) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(90_000) });
      const json = await response.json().catch(() => null);
      if (response.status === 200) return { json, ms: Date.now() - started };
      last = `HTTP ${response.status.toString()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return { json: null, ms: Date.now() - started, last };
}

async function checkEdge() {
  const health = await waitForHealth();
  check(
    'health: API and database are up',
    health.json?.status === 'ok' && health.json.database === 'ok',
    health.json
      ? `version ${String(health.json.version)}, answered after ${health.ms.toString()} ms`
      : String(health.last),
  );
  if (!health.json) return false;

  if (https) {
    const plain = await fetch(`${base.replace('https://', 'http://')}/`, { redirect: 'manual' });
    const location = plain.headers.get('location') ?? '';
    check(
      'plain HTTP redirects to HTTPS',
      plain.status >= 300 && plain.status < 400 && location.startsWith('https://'),
      `${plain.status.toString()} to ${location}`,
    );
  }

  const page = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
  const html = await page.text();
  check('the game page is served', page.status === 200 && html.includes('<div id="root">'));
  const csp = page.headers.get('content-security-policy') ?? '';
  check(
    'security headers: CSP, HSTS, nosniff, no framing',
    csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'") &&
      (!https || csp.includes('upgrade-insecure-requests')) &&
      (page.headers.get('strict-transport-security') ?? '').includes('max-age=') &&
      page.headers.get('x-content-type-options') === 'nosniff' &&
      !page.headers.has('x-powered-by'),
  );
  const script = /\/assets\/[^"']+\.js/.exec(html)?.[0];
  const asset = script ? await fetch(base + script) : null;
  check(
    'fingerprinted assets are cached immutably',
    asset?.status === 200 && (asset.headers.get('cache-control') ?? '').includes('immutable'),
    script ?? 'no script tag found',
  );
  const deepLink = await fetch(`${base}/history`, { headers: { accept: 'text/html' } });
  check('deep links load the app', deepLink.status === 200);
  return true;
}

async function checkGuards(player) {
  const noSession = await new Player().request('GET', '/api/pump/current');
  check(
    'requests without a session are refused',
    noSession.status === 401 && noSession.json?.error?.code === 'SESSION_REQUIRED',
  );
  const crossSite = await player.request('POST', '/api/pump/start', {
    key: randomUUID(),
    body: {},
    headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
  });
  check(
    'cross-site mutations are refused',
    crossSite.status === 403 && crossSite.json?.error?.code === 'ORIGIN_REJECTED',
  );
  const badJson = await player.request('POST', '/api/pump/pump', {
    key: randomUUID(),
    body: '{"roundId":',
  });
  check(
    'malformed JSON gets a plain error with no internals',
    badJson.status === 400 &&
      badJson.json?.error?.code === 'VALIDATION_ERROR' &&
      Object.keys(badJson.json).join() === 'error' &&
      Object.keys(badJson.json.error).sort().join() === 'code,message,requestId',
  );
  const textBody = await player.request('POST', '/api/pump/pump', {
    key: randomUUID(),
    body: 'roundId=1',
    headers: { 'content-type': 'text/plain' },
  });
  check('non-JSON bodies are refused', textBody.status === 415);
  const unknown = await player.request('GET', '/api/does-not-exist');
  check(
    'unknown API routes are a JSON 404',
    unknown.status === 404 && unknown.json?.error?.code === 'NOT_FOUND',
  );
}

/** Bets and pumps until a first pump survives; rounds that pop on the way go into `popped`. */
async function openPumpedRound(player, state, betCents, label, popped) {
  let current = state;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const start = await player.action('/api/pump/start', {
      betCents,
      clientSeed: `smoke-${label}-${attempt.toString()}`,
      commitmentId: current.nextCommitment.id,
      autoCashoutMultiplier: null,
    });
    if (start.status !== 201) throw new Error(`bet failed: ${start.text}`);
    const round = start.json.round;
    const pumped = await player.action('/api/pump/pump', {
      roundId: round.id,
      expectedVersion: round.version,
    });
    if (pumped.status !== 200) throw new Error(`pump failed: ${pumped.text}`);
    if (pumped.json.round.status === 'ACTIVE') return pumped.json;
    popped.push(pumped.json.round);
    current = pumped.json;
  }
  throw new Error('ten first pumps in a row popped');
}

function findRound(value, id) {
  if (value === null || typeof value !== 'object') return null;
  if (value.id === id && typeof value.status === 'string') return value;
  for (const child of Object.values(value)) {
    const found = findRound(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Internal details must never appear, an active round must never carry its seed, and each
 * revealed seed must first appear in a response where its round has already ended.
 */
function leakProblems(responses, revealedSeeds) {
  const problems = [];
  for (const response of responses) {
    if (/poppoint|pop_point|server_seed|node_modules|"stack"/i.test(response.text)) {
      problems.push(`${response.path}: internal detail in the body`);
    }
    const walk = (value) => {
      if (value === null || typeof value !== 'object') return;
      if (value.status === 'ACTIVE' && value.fairness && value.fairness.serverSeed !== null) {
        problems.push(`${response.path}: seed of an active round`);
      }
      Object.values(value).forEach(walk);
    };
    walk(response.json);
  }
  for (const [roundId, seed] of revealedSeeds) {
    const first = responses.find((response) => response.text.includes(seed));
    const round = first ? findRound(first.json, roundId) : null;
    if (round?.status === undefined || round.status === 'ACTIVE') {
      problems.push(`seed of round ${roundId} appeared before the round ended`);
    }
  }
  return problems;
}

async function freshRun() {
  if (!(await checkEdge())) return;

  const player = new Player();
  const session = await player.request('POST', '/api/session');
  check('a new player gets a session', session.status === 201 && session.json?.isNew === true);
  const cookie = player.setCookies.find((header) => header.startsWith('pump_session=')) ?? '';
  check(
    `session cookie is HttpOnly, SameSite=Strict, Path=/api${https ? ', Secure' : ''}`,
    /;\s*HttpOnly/i.test(cookie) &&
      /;\s*SameSite=Strict/i.test(cookie) &&
      /;\s*Path=\/api(;|$)/i.test(cookie) &&
      (!https || /;\s*Secure/i.test(cookie)),
  );
  const again = await player.request('POST', '/api/session');
  check(
    'the same cookie resumes the same player',
    again.status === 200 && again.json?.player?.id === session.json?.player?.id,
  );

  const initial = await player.request('GET', '/api/pump/current');
  check(
    'the wallet starts at $10,000 with no open round',
    initial.json?.wallet?.balanceCents === '1000000' && initial.json.round === null,
  );
  check(
    'the seed commitment is shown before betting',
    isHex64(initial.json?.nextCommitment?.commitment),
  );
  check(
    'rate limiting is on',
    initial.headers.get('x-ratelimit-limit') !== null,
    `limit ${String(initial.headers.get('x-ratelimit-limit'))} per minute`,
  );

  await checkGuards(player);

  // Round A: bet $1, refuse an early cash-out, pump with a retry, then double-click Cash Out.
  const popped = [];
  const shown = initial.json.nextCommitment;
  const bet = await player.action('/api/pump/start', {
    betCents: '100',
    clientSeed: 'smoke-a-0',
    commitmentId: shown.id,
    autoCashoutMultiplier: null,
  });
  check(
    'a bet opens a round on the commitment shown and debits the wallet',
    bet.status === 201 &&
      bet.json.round.status === 'ACTIVE' &&
      bet.json.round.fairness.commitment === shown.commitment &&
      bet.json.round.fairness.serverSeed === null &&
      bet.json.wallet.balanceCents === '999900',
  );
  const opening = bet.json.round;
  const early = await player.action('/api/pump/cashout', {
    roundId: opening.id,
    expectedVersion: opening.version,
  });
  check(
    'cash-out before the first pump is refused',
    early.status === 422 && early.json?.error?.code === 'CASHOUT_REQUIRES_PUMP',
  );

  const key = randomUUID();
  const pumpBody = { roundId: opening.id, expectedVersion: opening.version };
  const first = await player.request('POST', '/api/pump/pump', { key, body: pumpBody });
  const retry = await player.request('POST', '/api/pump/pump', { key, body: pumpBody });
  check(
    'a retried pump replays instead of pumping twice',
    first.status === 200 &&
      retry.status === 200 &&
      retry.headers.get('idempotent-replayed') === 'true' &&
      JSON.stringify(retry.json.round) === JSON.stringify(first.json.round),
  );
  let stateA = first.json;
  if (stateA.round.status === 'ACTIVE') {
    const stale = await player.action('/api/pump/pump', {
      roundId: stateA.round.id,
      expectedVersion: stateA.round.version - 1,
    });
    check(
      'a stale action is refused with the current state',
      stale.status === 409 &&
        stale.json?.error?.code === 'STALE_ROUND_VERSION' &&
        stale.json.state?.round?.version === stateA.round.version,
    );
  } else {
    popped.push(stateA.round);
    stateA = await openPumpedRound(player, stateA, '100', 'a', popped);
  }
  const roundA = stateA.round;
  const cashBody = { roundId: roundA.id, expectedVersion: roundA.version };
  const clicks = await Promise.all([
    player.action('/api/pump/cashout', cashBody),
    player.action('/api/pump/cashout', cashBody),
  ]);
  const won = clicks.find((response) => response.status === 200);
  const other = clicks.find((response) => response !== won);
  check(
    'a double-clicked cash-out pays exactly once',
    won?.json.round.status === 'CASHED_OUT' &&
      won.json.round.payoutCents === roundA.cashoutCents &&
      other?.status === 409,
    clicks.map((response) => response.status.toString()).join(' + '),
  );
  const wallet = await player.request('GET', '/api/wallet');
  check(
    'the balance rose by the payout once',
    BigInt(wallet.json.balanceCents) ===
      BigInt(stateA.wallet.balanceCents) + BigInt(roundA.cashoutCents),
    `won ${String(roundA.cashoutCents)} cents at pump ${roundA.pumpCount.toString()}`,
  );
  check('cashing out reveals the server seed', isHex64(won?.json.round.fairness.serverSeed));

  // Round B stays open: restored by a "refresh" now and, with --resume, after a restart.
  const afterA = await player.request('GET', '/api/pump/current');
  const stateB = await openPumpedRound(player, afterA.json, '250', 'b', popped);
  const roundB = stateB.round;
  const restored = await player.request('GET', '/api/pump/current');
  check(
    'a refresh restores the open round exactly',
    JSON.stringify(restored.json.round) === JSON.stringify(roundB) &&
      restored.json.wallet.balanceCents === stateB.wallet.balanceCents,
    `round ${roundB.id} at pump ${roundB.pumpCount.toString()}`,
  );

  const history = await player.request('GET', '/api/history?limit=50');
  const finished = history.json?.rounds ?? [];
  const finishedIds = new Set(finished.map((round) => round.id));
  check(
    'history lists the finished rounds with their seeds, not the open one',
    history.status === 200 &&
      finishedIds.has(roundA.id) &&
      popped.every((round) => finishedIds.has(round.id)) &&
      !finishedIds.has(roundB.id) &&
      finished.every((round) => isHex64(round.fairness.serverSeed)),
    `${finished.length.toString()} finished, ${popped.length.toString()} popped`,
  );

  let verified = 0;
  for (const round of finished) {
    const response = await player.request('GET', `/api/rounds/${round.id}/verify`);
    if (response.status === 200 && verifyRevealedRound(response.json.verification).verified) {
      verified += 1;
    }
  }
  check(
    'every finished round verifies with the independent verifier',
    verified > 0 && verified === finished.length,
    `${verified.toString()} of ${finished.length.toString()}`,
  );
  const open = await player.request('GET', `/api/rounds/${roundB.id}/verify`);
  check(
    'an open round cannot be verified yet',
    open.status === 409 && open.json?.error?.code === 'ROUND_IN_PROGRESS',
  );

  let expected = 1_000_000n - BigInt(roundB.betCents);
  for (const round of finished) {
    expected += BigInt(round.payoutCents ?? '0') - BigInt(round.betCents);
  }
  check(
    'the wallet matches the history to the cent',
    BigInt(restored.json.wallet.balanceCents) === expected,
  );

  const seeds = new Map(finished.map((round) => [round.id, round.fairness.serverSeed]));
  const problems = leakProblems(player.responses, seeds);
  check(
    'no seed or internal detail leaked',
    problems.length === 0,
    problems.slice(0, 3).join('; ') || `${player.responses.length.toString()} responses scanned`,
  );

  if (savePath) {
    const saved = {
      base,
      cookie: player.cookie,
      round: roundB,
      balanceCents: restored.json.wallet.balanceCents,
    };
    writeFileSync(savePath, `${JSON.stringify(saved, null, 2)}\n`);
    process.stdout.write(`Saved the session with round ${roundB.id} open to ${savePath}\n`);
  }
}

async function resumeRun() {
  const saved = JSON.parse(readFileSync(resumePath, 'utf8'));
  if (!(await checkEdge())) return;
  const player = new Player();
  player.cookie = saved.cookie;
  const current = await player.request('GET', '/api/pump/current');
  check('the saved session still works', current.status === 200);
  check(
    'the balance is unchanged',
    current.json?.wallet?.balanceCents === saved.balanceCents,
    `${String(saved.balanceCents)} cents`,
  );
  check(
    'the open round is restored exactly',
    JSON.stringify(current.json?.round) === JSON.stringify(saved.round),
    `round ${String(saved.round.id)} at pump ${String(saved.round.pumpCount)}`,
  );
  const cash = await player.action('/api/pump/cashout', {
    roundId: saved.round.id,
    expectedVersion: saved.round.version,
  });
  check(
    'the restored round cashes out for the amount shown before',
    cash.status === 200 &&
      cash.json.round.status === 'CASHED_OUT' &&
      cash.json.round.payoutCents === saved.round.cashoutCents,
    `${String(saved.round.cashoutCents)} cents`,
  );
  const verify = await player.request('GET', `/api/rounds/${String(saved.round.id)}/verify`);
  check(
    'it verifies with the independent verifier',
    verify.status === 200 && verifyRevealedRound(verify.json.verification).verified,
  );
  const seed = cash.json?.round?.fairness?.serverSeed;
  check(
    'its seed was hidden until it ended',
    isHex64(seed) &&
      !current.text.includes(seed) &&
      leakProblems(player.responses, new Map()).length === 0,
  );
}

try {
  await (resumePath ? resumeRun() : freshRun());
} catch (error) {
  check('the smoke run finished', false, error instanceof Error ? error.message : String(error));
}
process.stdout.write(
  `\n${passed.toString()} passed, ${failed.toString()} failed against ${base}\n`,
);
process.exitCode = failed === 0 ? 0 : 1;
