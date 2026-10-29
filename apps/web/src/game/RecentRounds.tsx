import type { PublicRound } from '@pump/contracts';
import { Link } from 'react-router';
import { money, times } from '../lib/format';
import { useGame } from './gameContext';

/** The last 10 finished rounds, newest first; each one opens its verification. */
export function RecentRounds() {
  const { recent } = useGame();
  return (
    <section aria-labelledby="recent-title" className="flex min-h-9 items-center gap-3">
      <h2 id="recent-title" className="shrink-0 text-xs text-ink-muted">
        Last 10
      </h2>
      {recent.length === 0 ? (
        <p className="text-xs text-ink-faint">Your results will line up here.</p>
      ) : (
        <ol
          className="flex min-w-0 gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]"
          data-testid="recent-rounds"
        >
          {recent.map((round) => (
            <li key={round.id} className="shrink-0">
              <Link
                to={`/verify/${round.id}`}
                aria-label={`${describe(round)} Verify this round.`}
                className={`block rounded-full px-2.5 py-1 text-xs font-semibold tabular transition-colors ${
                  round.status === 'CASHED_OUT'
                    ? 'bg-win/12 text-win hover:bg-win/20'
                    : 'bg-ink/5 text-loss hover:bg-ink/10'
                }`}
              >
                {label(round)}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function label(round: PublicRound): string {
  switch (round.status) {
    case 'CASHED_OUT':
      return times(round.multiplier ?? '');
    case 'POPPED':
      return `Pop ${(round.pumpCount + 1).toString()}`;
    case 'EXPIRED':
      return 'Expired';
    case 'ACTIVE':
      return 'Live';
  }
}

function describe(round: PublicRound): string {
  switch (round.status) {
    case 'CASHED_OUT':
      return `Cashed out at ${times(round.multiplier ?? '')}, won ${money(round.payoutCents ?? '0')}.`;
    case 'POPPED':
      return `Popped on pump ${(round.pumpCount + 1).toString()}, lost ${money(round.betCents)}.`;
    case 'EXPIRED':
      return `Expired, ${money(round.betCents)} forfeited.`;
    case 'ACTIVE':
      return 'In progress.';
  }
}
