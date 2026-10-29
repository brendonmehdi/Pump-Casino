import { PUMP_V1, formatRatioFloor, payoutCents } from '@pump/engine';
import { useEffect, useRef } from 'react';
import { chance, money, times } from '../lib/format';
import { usePreferences } from '../prefs/preferencesContext';
import { useGame } from './gameContext';
import { useSettings } from './settingsContext';

/** Pop chance at which a rung enters the red zone. */
const RED_ZONE_BASIS_POINTS = 3_000;

type RungState = 'done' | 'current' | 'next' | 'ahead' | 'popped';

/**
 * The signature feature: all 25 rungs of the public schedule as a pressure gauge. Each rung
 * shows its multiplier, the chance that pump pops, and what it would pay on your bet, so the
 * risk/reward of the next pump is always in plain sight. It uses only the published rules —
 * never the hidden outcome — and payouts here are previews; the server's cash-out value is
 * the authoritative one.
 */
export function PressureLadder() {
  const { state } = useGame();
  const { betCents } = useSettings();
  const { reducedMotion } = usePreferences();
  const round = state?.round ?? null;
  const pumpCount = round?.pumpCount ?? 0;
  const live = round?.status === 'ACTIVE';
  // During a round: that round's bet. Between rounds: the bet you're about to place.
  const previewBet = live ? BigInt(round.betCents) : betCents;
  const remaining = PUMP_V1.rules.maxPumps - pumpCount;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const focus = list?.querySelector<HTMLElement>(
      '[data-rung-state="next"], [data-rung-state="current"]',
    );
    if (!list || !focus) return;
    const behavior = reducedMotion ? 'auto' : 'smooth';
    if (list.scrollWidth > list.clientWidth) {
      list.scrollTo({
        left: focus.offsetLeft - list.clientWidth / 2 + focus.clientWidth / 2,
        behavior,
      });
    } else if (list.scrollHeight > list.clientHeight) {
      list.scrollTo({
        top: focus.offsetTop - list.clientHeight / 2 + focus.clientHeight / 2,
        behavior,
      });
    }
  }, [pumpCount, round?.id, reducedMotion]);

  const rungState = (pump: number): RungState => {
    if (!round) return pump === 1 ? 'next' : 'ahead';
    if (round.status === 'POPPED' && pump === round.pumpCount + 1) return 'popped';
    if (pump < pumpCount) return 'done';
    if (pump === pumpCount) return 'current';
    if (live && pump === pumpCount + 1) return 'next';
    return 'ahead';
  };

  return (
    <section aria-labelledby="ladder-title" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="ladder-title" className="text-sm font-semibold text-ink">
          Pressure ladder
        </h2>
        <p className="text-xs text-ink-muted tabular" data-testid="pumps-left">
          {live ? `${remaining.toString()} ${remaining === 1 ? 'pump' : 'pumps'} left` : '25 pumps'}
        </p>
      </div>
      <ol
        ref={listRef}
        aria-label="Multiplier, pop chance and payout for each pump"
        tabIndex={0}
        className="flex snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] lg:min-h-0 lg:flex-col-reverse lg:overflow-x-visible lg:overflow-y-auto lg:pb-0"
      >
        {PUMP_V1.ladder.map((step) => {
          const status = rungState(step.pump);
          const hot = step.popBasisPoints >= RED_ZONE_BASIS_POINTS;
          const heat = step.pump / PUMP_V1.rules.maxPumps;
          return (
            <li
              key={step.pump}
              data-rung-state={status}
              aria-current={status === 'current' ? 'step' : undefined}
              className={`relative flex min-w-[6.25rem] shrink-0 snap-center flex-col rounded-xl border px-2.5 py-1.5 transition-colors duration-300 lg:min-w-0 lg:flex-row lg:items-center lg:gap-3 lg:py-1 ${rungClasses(status)}`}
            >
              {(status === 'done' || status === 'current') && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl opacity-30"
                  style={{
                    background: `linear-gradient(90deg, hsl(${(347 + 8 * heat).toFixed(0)} 100% 70% / 0.55), transparent)`,
                  }}
                />
              )}
              <span className="relative w-6 text-xs text-ink-faint tabular">{step.pump}</span>
              <span className="relative text-sm font-semibold tabular lg:w-[5.5rem]">
                {times(formatRatioFloor(step.multiplier, 2))}
              </span>
              <span
                className={`relative text-xs tabular lg:w-14 lg:text-right ${hot ? 'text-danger' : 'text-ink-muted'}`}
              >
                {chance(step.popBasisPoints)}
              </span>
              <span className="relative hidden text-xs text-ink-muted tabular lg:ml-auto lg:block">
                {previewBet === null ? '' : money(payoutCents(PUMP_V1, previewBet, step.pump))}
              </span>
              <span className="sr-only">{describeRung(status)}</span>
            </li>
          );
        })}
      </ol>
      <p className="px-1 text-xs text-ink-faint">
        Surviving pump 25 cashes out automatically. Pop chances in red are 30% or higher.
      </p>
    </section>
  );
}

function rungClasses(status: RungState): string {
  switch (status) {
    case 'current':
      return 'border-latex/70 bg-night-3 text-ink';
    case 'next':
      return 'border-gauge/60 bg-night-3/70 text-ink ring-1 ring-gauge/25';
    case 'done':
      return 'border-transparent bg-night-2 text-ink/80';
    case 'popped':
      return 'border-loss/50 bg-night-2 text-loss line-through';
    case 'ahead':
      return 'border-transparent bg-night-2/50 text-ink/55';
  }
}

function describeRung(status: RungState): string {
  switch (status) {
    case 'current':
      return 'Reached';
    case 'next':
      return 'Next pump';
    case 'done':
      return 'Passed';
    case 'popped':
      return 'Popped here';
    case 'ahead':
      return '';
  }
}
