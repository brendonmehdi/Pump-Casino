import { money } from '../lib/format';
import { usePreferences } from '../prefs/preferencesContext';
import { useGame } from './gameContext';
import { useSettings } from './settingsContext';

interface ActionBarProps {
  /** Auto-bet owns the controls while it runs. */
  readonly locked: boolean;
}

/**
 * The primary button never moves: it reads "Bet" between rounds and "Pump" during one, with
 * Cash out beside it, so a quick second tap always lands on the same kind of action.
 */
export function ActionBar({ locked }: ActionBarProps) {
  const { state, pending, start, pump, cashOut } = useGame();
  const settings = useSettings();
  const { unlockAudio } = usePreferences();
  const round = state?.round ?? null;
  const active = round?.status === 'ACTIVE';
  const busy = pending !== null || locked || !state;
  const balance = state ? BigInt(state.wallet.balanceCents) : 0n;
  const betCents = settings.betCents;
  const settingsValid =
    betCents !== null && settings.clientSeedError === null && settings.autoCashoutError === null;
  const affordable = betCents !== null && betCents <= balance;

  const onPrimary = () => {
    unlockAudio();
    if (active) {
      void pump();
    } else if (betCents !== null && settingsValid && affordable) {
      void start({ betCents, clientSeed: settings.clientSeed, autoCashout: settings.autoCashout });
    }
  };
  const onCashOut = () => {
    unlockAudio();
    void cashOut();
  };

  const primaryLabel = active
    ? pending === 'pump'
      ? 'Pumping…'
      : 'Pump'
    : pending === 'start'
      ? 'Placing bet…'
      : !affordable && betCents !== null
        ? 'Balance too low'
        : `Bet ${betCents === null ? '' : money(betCents)}`;
  const canCashOut = active && round.cashoutCents !== null;

  return (
    <div className="grid grid-cols-[1.35fr_1fr] gap-3" data-game-hotkeys>
      <button
        type="button"
        onClick={onPrimary}
        disabled={busy || (!active && (!settingsValid || !affordable))}
        data-testid={active ? 'pump-button' : 'bet-button'}
        className="flex min-h-14 items-center justify-center gap-3 rounded-full bg-latex px-6 text-lg font-semibold text-night shadow-[0_8px_30px_-8px_rgba(255,139,167,0.65)] transition-[transform,background-color,box-shadow,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none hover:enabled:bg-[#ff9db5]"
      >
        <span className="tabular">{primaryLabel}</span>
        {active && (
          <kbd className="hidden rounded-md bg-night/15 px-1.5 py-0.5 font-sans text-xs font-medium lg:inline">
            Space
          </kbd>
        )}
      </button>
      <button
        type="button"
        onClick={onCashOut}
        disabled={busy || !canCashOut}
        data-testid="cashout-button"
        aria-describedby={active && !canCashOut ? 'cashout-hint' : undefined}
        className="flex min-h-14 flex-col items-center justify-center rounded-full border border-win/60 bg-win/10 px-4 font-semibold text-win transition-[transform,background-color,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-transparent disabled:text-ink-faint hover:enabled:bg-win/20"
      >
        <span className="flex items-center gap-2 text-base">
          {pending === 'cashout' ? 'Cashing out…' : 'Cash out'}
          {canCashOut && (
            <kbd className="hidden rounded-md bg-win/15 px-1.5 py-0.5 font-sans text-xs font-medium lg:inline">
              Enter
            </kbd>
          )}
        </span>
        {canCashOut && <span className="text-sm tabular">{money(round.cashoutCents ?? '0')}</span>}
      </button>
      {active && !canCashOut && (
        <p id="cashout-hint" className="col-span-2 text-center text-xs text-ink-muted">
          Cash out unlocks after your first pump.
        </p>
      )}
    </div>
  );
}
