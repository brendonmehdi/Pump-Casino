import type { PublicRound } from '@pump/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import { money, times } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const PAGE_SIZE = 20;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function HistoryPage() {
  useDocumentTitle('History · Pump');
  const query = useInfiniteQuery({
    queryKey: ['history', 'page'],
    queryFn: ({ pageParam }) => api.history(PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rounds = query.data?.pages.flatMap((page) => page.rounds) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-16">
      <h1 className="font-display text-3xl font-[800]" style={{ fontStretch: '125%' }}>
        History
      </h1>
      {query.isPending && (
        <p className="text-sm text-ink-muted" role="status">
          Loading rounds…
        </p>
      )}
      {query.isError && (
        <p className="text-sm text-danger" role="alert">
          Could not load your rounds. Check your connection and reload.
        </p>
      )}
      {query.isSuccess && rounds.length === 0 && (
        <p className="text-sm text-ink-muted">
          No finished rounds yet.{' '}
          <Link to="/" className="text-gauge underline underline-offset-4">
            Play one
          </Link>{' '}
          and it will appear here with its seeds.
        </p>
      )}
      {rounds.length > 0 && (
        <ol
          className="flex flex-col divide-y divide-ink/8 rounded-3xl border border-ink/10 bg-night-2/60"
          data-testid="history-list"
        >
          {rounds.map((round) => (
            <HistoryRow key={round.id} round={round} />
          ))}
        </ol>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="self-center rounded-full border border-ink/15 px-5 py-2 text-sm text-ink hover:border-ink/30 disabled:opacity-50"
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Show older rounds'}
        </button>
      )}
    </main>
  );
}

function HistoryRow({ round }: { readonly round: PublicRound }) {
  const won = round.status === 'CASHED_OUT';
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[5rem_1fr_7rem_7rem_auto]">
      <span className="text-ink-muted tabular">Round {round.fairness.nonce.toString()}</span>
      <span className="order-last text-xs text-ink-faint sm:order-none sm:text-sm">
        {dateFormat.format(new Date(round.startedAt))}
      </span>
      <span className="tabular">Bet {money(round.betCents)}</span>
      <span className={`tabular ${won ? 'text-win' : 'text-loss'}`}>
        {won
          ? `${times(round.multiplier ?? '')}, paid ${money(round.payoutCents ?? '0')}`
          : round.status === 'POPPED'
            ? `Popped on ${(round.pumpCount + 1).toString()}`
            : 'Expired'}
      </span>
      <Link to={`/verify/${round.id}`} className="text-gauge underline-offset-4 hover:underline">
        Verify
      </Link>
    </li>
  );
}
