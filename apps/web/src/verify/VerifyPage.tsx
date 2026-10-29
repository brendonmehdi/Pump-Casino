import { verificationDataSchema, type PublicRound, type VerificationData } from '@pump/contracts';
import {
  FAIRNESS_ALGORITHM,
  PUMP_V1,
  formatRatioFloor,
  ladderStep,
  verifyRound,
  type RevealedRound,
  type VerificationReport,
} from '@pump/engine';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api } from '../api/client';
import { useGame } from '../game/gameContext';
import { shownCommitmentFor } from '../game/shownCommitments';
import { chance, money, times } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const REPO_FAIRNESS_DOC = 'https://github.com/brendonmehdi/Pump-Casino/blob/main/docs/FAIRNESS.md';

export function VerifyPage() {
  useDocumentTitle('Verify a round · Pump');
  const { roundId } = useParams();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-[800]" style={{ fontStretch: '125%' }}>
          Verify a round
        </h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          Each round's server seed is fixed and hashed before you bet, then revealed when the round
          ends. This page recomputes the round in your browser from the revealed values alone: it
          checks the hash, redraws every pump and replays your actions.
        </p>
      </div>
      {roundId ? <FetchedRound roundId={roundId} /> : <PickOrPaste />}
      <Specification />
    </main>
  );
}

function FetchedRound({ roundId }: { readonly roundId: string }) {
  const query = useQuery({
    queryKey: ['verify', roundId],
    queryFn: () => api.verify(roundId),
    retry: false,
  });
  if (query.isPending)
    return (
      <p className="text-sm text-ink-muted" role="status">
        Loading round…
      </p>
    );
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : null;
    return (
      <Callout tone="neutral">
        {code === 'ROUND_IN_PROGRESS'
          ? 'This round is still running. Its server seed is revealed the moment it ends.'
          : code === 'ROUND_NOT_FOUND' || code === 'VALIDATION_ERROR'
            ? 'No finished round with this id belongs to your session. You can still paste revealed values below.'
            : 'Could not load this round. Check your connection and reload.'}
      </Callout>
    );
  }
  return <Report data={query.data.verification} round={query.data.round} />;
}

function PickOrPaste() {
  const { recent } = useGame();
  const textareaId = useId();
  const [text, setText] = useState('');
  const parsed = parsePasted(text);
  return (
    <div className="flex flex-col gap-6">
      {recent.length > 0 && (
        <section aria-labelledby="pick-title" className="flex flex-col gap-2">
          <h2 id="pick-title" className="text-sm font-semibold">
            Your recent rounds
          </h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((round) => (
              <li key={round.id}>
                <Link
                  to={`/verify/${round.id}`}
                  className="block rounded-full bg-night-2 px-3 py-1.5 text-sm text-ink tabular hover:bg-night-3"
                >
                  Round {round.fairness.nonce.toString()}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <label htmlFor={textareaId} className="text-sm font-semibold">
          Or paste revealed values
        </label>
        <p className="text-xs text-ink-faint">
          The JSON from <code className="font-sans">GET /api/rounds/:id/verify</code>, or its
          verification object.
        </p>
        <textarea
          id={textareaId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          rows={7}
          spellCheck={false}
          className="rounded-2xl border border-ink/12 bg-night-2 p-3 text-xs text-ink outline-none focus:border-gauge/60"
          data-testid="verify-input"
        />
        {text.trim() !== '' && 'error' in parsed && <Callout tone="bad">{parsed.error}</Callout>}
      </section>
      {'data' in parsed && <Report data={parsed.data} round={null} />}
    </div>
  );
}

function parsePasted(text: string): { data: VerificationData } | { error: string } {
  if (text.trim() === '') return { error: '' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'That is not valid JSON.' };
  }
  const candidate =
    typeof json === 'object' && json !== null && 'verification' in json ? json.verification : json;
  const result = verificationDataSchema.safeParse(candidate);
  return result.success
    ? { data: result.data }
    : { error: 'Some fields are missing or malformed. Paste the full verification object.' };
}

function toRevealed(data: VerificationData): RevealedRound {
  return {
    rulesVersion: data.rulesVersion,
    commitment: data.commitment,
    serverSeedHex: data.serverSeed,
    roundId: data.roundId,
    nonce: data.nonce,
    clientSeed: data.clientSeed,
    betCents: BigInt(data.betCents),
    autoCashoutHundredths:
      data.autoCashoutHundredths === null ? null : BigInt(data.autoCashoutHundredths),
    recorded: {
      status: data.outcome.status,
      pumpCount: data.outcome.pumpCount,
      settlementReason: data.outcome.settlementReason,
      payoutCents: BigInt(data.outcome.payoutCents),
    },
  };
}

function Report({
  data,
  round,
}: {
  readonly data: VerificationData;
  readonly round: PublicRound | null;
}) {
  const report: VerificationReport = verifyRound(PUMP_V1, toRevealed(data));
  // The hash this browser recorded when the bet was placed, if it was placed here.
  const shown = shownCommitmentFor(data.roundId);
  const hashChanged = shown !== null && shown !== data.commitment;
  const pastedHashAsSeed = data.serverSeed === data.commitment;
  const { pumpCount } = data.outcome;
  const reached =
    pumpCount > 0 && pumpCount <= PUMP_V1.rules.maxPumps ? ladderStep(PUMP_V1, pumpCount) : null;
  return (
    <section
      aria-label="Verification result"
      className="flex flex-col gap-5"
      data-testid="verify-report"
    >
      <Callout tone={report.verdict === 'VERIFIED' && !hashChanged ? 'good' : 'bad'}>
        <span className="font-semibold" data-testid="verify-verdict">
          {hashChanged
            ? 'Does not match: this is not the seed hash you were shown before the bet.'
            : report.verdict === 'VERIFIED'
              ? 'Verified: this round was played exactly as committed.'
              : report.verdict === 'MISMATCH'
                ? 'Does not match: the revealed values do not reproduce the recorded result.'
                : "Can't verify these values."}
        </span>
        {pastedHashAsSeed && (
          <span className="block">
            The seed field holds the hash. Use the revealed server seed instead.
          </span>
        )}
        {report.problems.map((problem) => (
          <span key={problem} className="block text-sm">
            {problem}
          </span>
        ))}
      </Callout>

      <dl className="grid gap-x-6 gap-y-3 rounded-3xl border border-ink/10 bg-night-2/70 p-5 text-sm sm:grid-cols-[11rem_1fr]">
        <Row label="Round">
          {data.roundId} (nonce {data.nonce.toString()})
        </Row>
        <Row label="Hash shown before the bet">
          <span className="break-all">{data.commitment}</span>
          <span
            className={`block text-xs ${report.commitmentMatches ? 'text-win' : 'text-danger'}`}
          >
            {report.commitmentMatches
              ? 'Matches SHA-256 of the revealed seed'
              : 'Does not match the revealed seed'}
          </span>
          {shown !== null && (
            <span
              className={`block text-xs ${hashChanged ? 'text-danger' : 'text-win'}`}
              data-testid="verify-shown-hash"
            >
              {hashChanged
                ? `This browser recorded a different hash when you bet: ${shown}`
                : 'Same hash this browser recorded when you placed the bet'}
            </span>
          )}
        </Row>
        <Row label="Revealed server seed">
          <span className="break-all">{data.serverSeed}</span>
        </Row>
        <Row label="Client seed">{data.clientSeed}</Row>
        <Row label="Bet">{money(data.betCents)}</Row>
        <Row label="Recorded result">
          {describeOutcome(data)}
          {reached && data.outcome.status === 'CASHED_OUT' && (
            <span className="block text-xs text-ink-muted">
              {money(data.betCents)} × {times(formatRatioFloor(reached.multiplier, 6))}, floored to
              the cent
            </span>
          )}
        </Row>
        {round && <Row label="Played">{new Date(round.startedAt).toLocaleString()}</Row>}
      </dl>

      <div className="overflow-x-auto rounded-3xl border border-ink/10">
        <table className="w-full min-w-[30rem] text-left text-sm tabular">
          <caption className="px-5 pt-4 pb-2 text-left text-sm font-semibold">
            Every draw, recomputed with HMAC-SHA256
          </caption>
          <thead className="text-xs text-ink-muted">
            <tr>
              <th scope="col" className="px-5 py-2 font-normal">
                Pump
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Sample (0–9999)
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Pops below
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Chance
              </th>
              <th scope="col" className="px-5 py-2 font-normal">
                Draw
              </th>
            </tr>
          </thead>
          <tbody>
            {report.draws.map((draw) => (
              <tr key={draw.pump} className="border-t border-ink/8">
                <td className="px-5 py-1.5">{draw.pump}</td>
                <td className="px-3 py-1.5">
                  {draw.sample}
                  {draw.attempts > 1 && (
                    <span className="ml-1 text-xs text-ink-faint">
                      after {draw.attempts - 1} rejected
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">{draw.popBasisPoints}</td>
                <td className="px-3 py-1.5 text-ink-muted">{chance(draw.popBasisPoints)}</td>
                <td className={`px-5 py-1.5 ${draw.pops ? 'text-danger' : 'text-ink-muted'}`}>
                  {draw.pops ? 'Pops' : 'Survives'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-5 py-3 text-xs text-ink-faint">
          {report.popPoint === null
            ? 'No draw pops: this balloon would have survived all 25 pumps.'
            : `The balloon was always going to pop on pump ${report.popPoint.toString()}.`}
        </p>
      </div>
    </section>
  );
}

function describeOutcome(data: VerificationData): string {
  const { status, pumpCount, settlementReason, payoutCents } = data.outcome;
  switch (status) {
    case 'POPPED':
      return `Popped on pump ${(pumpCount + 1).toString()}, paid $0.00`;
    case 'EXPIRED':
      return `Expired after ${pumpCount.toString()} pumps, paid $0.00`;
    case 'CASHED_OUT': {
      const how =
        settlementReason === 'LADDER_TOP'
          ? 'at the top'
          : settlementReason === 'AUTO_TARGET'
            ? 'automatically'
            : 'manually';
      return `Cashed out ${how} after ${pumpCount.toString()} pumps, paid ${money(payoutCents)}`;
    }
  }
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

function Callout({
  tone,
  children,
}: {
  readonly tone: 'good' | 'bad' | 'neutral';
  readonly children: ReactNode;
}) {
  const style =
    tone === 'good'
      ? 'border-win/40 bg-win/8 text-win'
      : tone === 'bad'
        ? 'border-danger/40 bg-danger/8 text-ink'
        : 'border-ink/12 bg-night-2 text-ink-muted';
  return (
    <div
      role="status"
      className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm ${style}`}
    >
      {children}
    </div>
  );
}

function Specification() {
  return (
    <section
      aria-labelledby="spec-title"
      className="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted"
    >
      <h2 id="spec-title" className="font-semibold text-ink">
        How each pump is drawn
      </h2>
      <p>
        For pump <em>i</em> and attempt <em>c</em> (starting at 0), compute HMAC-SHA256 keyed with
        the server seed bytes over the text{' '}
        <code className="font-sans text-ink">
          {FAIRNESS_ALGORITHM}|roundId|nonce|clientSeed|i|c
        </code>
        . Read the first 4 bytes as a big-endian number <em>u</em>. If <em>u</em> is 4,294,960,000
        or more, try the next attempt; otherwise the sample is <em>u</em> mod 10,000. Pump{' '}
        <em>i</em> pops when the sample is below its pop chance in basis points (800 on pump 1,
        rising by 125 per pump).
      </p>
      <p>
        Prefer your own tools? Run{' '}
        <code className="font-sans text-ink">node tools/verify-round.mjs round.json</code> from the
        repository, or read the{' '}
        <a
          href={REPO_FAIRNESS_DOC}
          className="text-gauge underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          full specification and test vectors
        </a>
        .
      </p>
    </section>
  );
}
