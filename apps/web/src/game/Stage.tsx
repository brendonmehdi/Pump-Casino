import type { PublicRound } from '@pump/contracts';
import { motion } from 'motion/react';
import { chance, ladderMultiplier, money, times } from '../lib/format';
import { usePreferences } from '../prefs/preferencesContext';
import { Balloon, type BalloonMood } from './Balloon';
import { useGame } from './gameContext';
import { useRoundSounds } from './useRoundEvents';

function moodFor(round: PublicRound | null): BalloonMood {
  switch (round?.status) {
    case undefined:
      return 'idle';
    case 'ACTIVE':
      return 'active';
    case 'POPPED':
      return 'popped';
    case 'CASHED_OUT':
      return 'released';
    case 'EXPIRED':
      return 'expired';
  }
}

export function Stage() {
  const { state, pending } = useGame();
  const { reducedMotion } = usePreferences();
  const round = state?.round ?? null;
  useRoundSounds(round);
  const pressure = round ? round.pumpCount / round.maxPumps : 0;

  return (
    <section aria-label="Balloon" className="relative flex flex-col items-center gap-1 pt-1">
      {/* The room warms as the pressure rises: tension without flashing the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[22%] -z-10 mx-auto aspect-square w-[min(90%,34rem)] rounded-full blur-3xl transition-[background-color,opacity] duration-700"
        style={{
          backgroundColor: `hsl(${(190 - 190 * pressure).toFixed(0)} 70% 45%)`,
          opacity: round?.status === 'ACTIVE' ? 0.1 + 0.22 * pressure : 0.08,
        }}
      />
      <Readout round={round} />
      <div className="relative w-full">
        <Balloon
          pressure={pressure}
          mood={moodFor(round)}
          pulseKey={round ? `${round.id}:${round.pumpCount.toString()}` : 'none'}
          straining={pending === 'pump'}
          reducedMotion={reducedMotion}
        />
      </div>
      <RoundStats round={round} />
      <p className="sr-only" aria-live="polite">
        {describeForScreenReader(round)}
      </p>
    </section>
  );
}

/** The big number. Its width axis inflates with the balloon (Anybody's font-stretch 72–150%). */
function Readout({ round }: { readonly round: PublicRound | null }) {
  const pressure = round ? round.pumpCount / round.maxPumps : 0;
  const reached = round?.multiplier ?? null;
  const ghost = reached === null && round?.status !== 'POPPED' && round?.status !== 'EXPIRED';
  const value =
    reached ?? (round?.status === 'ACTIVE' ? round.nextMultiplier : null) ?? ladderMultiplier(1);
  const tone =
    round?.status === 'CASHED_OUT'
      ? 'text-win'
      : round?.status === 'POPPED' || round?.status === 'EXPIRED'
        ? 'text-loss'
        : ghost
          ? 'text-ink/35'
          : 'text-ink';

  return (
    <div className="flex min-h-[7rem] flex-col items-center justify-end text-center lg:min-h-[9rem]">
      <motion.p
        key={round?.status === 'CASHED_OUT' ? `${round.id}-won` : 'readout'}
        className={`font-display tabular leading-[0.9] font-[800] ${tone} text-[clamp(3.5rem,13vw,7.5rem)] transition-[font-stretch] duration-300`}
        style={{ fontStretch: `${(72 + 78 * pressure).toFixed(0)}%` }}
        initial={round?.status === 'CASHED_OUT' ? { scale: 0.9 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        data-testid="multiplier"
      >
        {value}
        <span
          className="ml-[0.06em] align-[0.42em] text-[0.46em] font-[600] opacity-85"
          aria-hidden="true"
        >
          ×
        </span>
        <span className="sr-only">times</span>
      </motion.p>
      <p className="mt-2 text-sm text-ink-muted">{caption(round)}</p>
    </div>
  );
}

function caption(round: PublicRound | null): string {
  if (!round) return `Place a bet, then pump. The first pump pays ${times(ladderMultiplier(1))}`;
  switch (round.status) {
    case 'ACTIVE':
      return round.pumpCount === 0
        ? 'First pump pays'
        : `After ${round.pumpCount.toString()} of ${round.maxPumps.toString()} pumps`;
    case 'CASHED_OUT':
      if (round.settlementReason === 'LADDER_TOP')
        return 'Top of the ladder, cashed out automatically';
      if (round.settlementReason === 'AUTO_TARGET') return 'Auto cash-out target reached';
      return 'Cashed out';
    case 'POPPED':
      return `Popped on pump ${(round.pumpCount + 1).toString()}`;
    case 'EXPIRED':
      return 'Left unfinished for 24 hours, so the bet was forfeited';
  }
}

function RoundStats({ round }: { readonly round: PublicRound | null }) {
  if (!round) return <div className="h-16" />;
  if (round.status === 'CASHED_OUT') {
    return (
      <motion.div
        className="flex h-16 flex-col items-center justify-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <p className="font-display text-3xl font-[750] text-win tabular" data-testid="round-result">
          Won {money(round.payoutCents ?? '0')}
        </p>
        <p className="text-sm text-ink-muted">on a {money(round.betCents)} bet</p>
      </motion.div>
    );
  }
  if (round.status !== 'ACTIVE') {
    return (
      <div className="flex h-16 flex-col items-center justify-center">
        <p className="text-lg text-loss tabular" data-testid="round-result">
          {round.status === 'POPPED' ? 'Lost' : 'Forfeited'} {money(round.betCents)}
        </p>
      </div>
    );
  }
  return (
    <dl className="grid h-16 w-full max-w-md grid-cols-2 items-center gap-4 text-center">
      <div>
        <dt className="text-xs text-ink-muted">Cash out now</dt>
        <dd className="text-xl font-semibold tabular text-ink" data-testid="cashout-value">
          {round.cashoutCents === null ? 'Pump once first' : money(round.cashoutCents)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-muted">Next pump pops</dt>
        <dd className="text-xl font-semibold tabular text-ink" data-testid="next-risk">
          {round.nextPopChanceBasisPoints === null
            ? 'No more pumps'
            : chance(round.nextPopChanceBasisPoints)}
          {round.nextMultiplier !== null && (
            <span className="ml-2 text-sm font-normal text-ink-muted">
              to {times(round.nextMultiplier)}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function describeForScreenReader(round: PublicRound | null): string {
  if (!round) return '';
  switch (round.status) {
    case 'ACTIVE':
      return round.pumpCount === 0
        ? 'Round started. Pump to inflate the balloon.'
        : `Pump ${round.pumpCount.toString()} survived. Multiplier ${round.multiplier ?? ''} times. Cash out now for ${money(round.cashoutCents ?? '0')}.`;
    case 'CASHED_OUT':
      return `Cashed out. Won ${money(round.payoutCents ?? '0')}.`;
    case 'POPPED':
      return `The balloon popped on pump ${(round.pumpCount + 1).toString()}. Bet lost.`;
    case 'EXPIRED':
      return 'The round expired and the bet was forfeited.';
  }
}
