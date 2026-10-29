import { AutoBetBar, AutoBetSettings } from '../autobet/AutoBetPanel';
import { useAutoBetDraft } from '../autobet/useAutoBetDraft';
import { useAutoBet } from '../autobet/useAutoBet';
import { usePersistentState } from '../lib/usePersistentState';
import { usePreferences } from '../prefs/preferencesContext';
import { ActionBar } from './ActionBar';
import { FairnessPanel } from './FairnessPanel';
import { AutoCashoutSetting, BetAmountField } from './fields';
import { useGame } from './gameContext';
import { PressureLadder } from './PressureLadder';
import { RecentRounds } from './RecentRounds';
import { useSettings } from './settingsContext';
import { Stage } from './Stage';
import { useFreshClientSeed } from './useFreshClientSeed';
import { useGameHotkeys } from './useGameHotkeys';

type Mode = 'manual' | 'auto';
const isMode = (value: unknown): value is Mode => value === 'manual' || value === 'auto';

export function GamePage() {
  const game = useGame();
  const settings = useSettings();
  const { unlockAudio } = usePreferences();
  const autoBet = useAutoBet();
  const { draft, fields } = useAutoBetDraft();
  const [mode, setMode] = usePersistentState<Mode>('mode', () => 'manual', isMode);
  const roundActive = game.state?.round?.status === 'ACTIVE';
  const autoRunning = autoBet.status !== 'idle';
  // An open round always gets Pump and Cash out, whatever the mode, unless auto-bet is
  // driving it. Otherwise stopping auto-bet mid-round would leave no way to finish it.
  const manualControls = mode === 'manual' || (roundActive && !autoRunning);
  useFreshClientSeed();

  useGameHotkeys({
    enabled: manualControls && !autoRunning && game.phase === 'ready',
    roundActive,
    onPump: () => {
      unlockAudio();
      void game.pump();
    },
    onCashOut: () => {
      unlockAudio();
      void game.cashOut();
    },
    onEscape: () => {
      if (autoRunning) autoBet.stop();
      else game.dismissNotice();
    },
  });

  if (game.phase !== 'ready')
    return <BootScreen failed={game.phase === 'error'} onRetry={game.retryLoad} />;

  const settingsLocked = roundActive || autoRunning || game.pending !== null;
  const autoBlocked = settings.clientSeedError ? 'Fix your client seed first.' : null;

  return (
    <main className="mx-auto grid w-full max-w-[1440px] gap-4 px-4 pb-44 lg:grid-cols-[19.5rem_minmax(0,1fr)_17.5rem] lg:gap-6 lg:px-6 lg:pb-8">
      <div className="flex min-w-0 flex-col gap-3 lg:order-2">
        <RecentRounds />
        <NoticeBar />
        <Stage />
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/10 bg-night/90 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-md lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <div className="mx-auto w-full max-w-lg">
            {manualControls ? (
              <>
                {mode === 'auto' && (
                  <p className="mb-2 text-center text-xs text-ink-muted" role="status">
                    Auto-bet is stopped and this round is still open. Finish it here.
                  </p>
                )}
                <ActionBar locked={autoRunning} />
              </>
            ) : (
              <AutoBetBar controller={autoBet} config={draft.config} blockedReason={autoBlocked} />
            )}
          </div>
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:order-3 lg:flex lg:max-h-[calc(100dvh-5.5rem)] lg:flex-col">
        <PressureLadder />
      </aside>

      <aside className="lg:order-1">
        <section
          aria-label="Bet settings"
          className="flex flex-col gap-5 rounded-3xl border border-ink/10 bg-night-2/80 p-4"
        >
          <div
            role="tablist"
            aria-label="Play mode"
            className="grid grid-cols-2 rounded-full bg-night p-1"
          >
            {(['manual', 'auto'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={mode === option}
                disabled={autoRunning}
                onClick={() => {
                  setMode(option);
                }}
                className="rounded-full py-2 text-sm font-semibold text-ink-muted transition-colors aria-selected:bg-night-3 aria-selected:text-ink disabled:cursor-not-allowed"
                data-testid={`mode-${option}`}
              >
                {option === 'manual' ? 'Manual' : 'Auto-bet'}
              </button>
            ))}
          </div>
          <BetAmountField disabled={settingsLocked} />
          {mode === 'manual' ? (
            <AutoCashoutSetting disabled={settingsLocked} />
          ) : (
            <AutoBetSettings draft={draft} fields={fields} disabled={autoRunning} />
          )}
          <FairnessPanel disabled={settingsLocked} />
          <p className="text-xs leading-relaxed text-ink-faint">
            Play money with no cash value. A round left unfinished for 24 hours is forfeited.
          </p>
        </section>
      </aside>
    </main>
  );
}

function NoticeBar() {
  const { notice, reconnecting, dismissNotice } = useGame();
  if (reconnecting) {
    return (
      <p role="status" className="rounded-2xl bg-gauge/10 px-4 py-2 text-sm text-gauge">
        Reconnecting… your last action will be retried safely.
      </p>
    );
  }
  if (!notice) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-2xl bg-danger/10 px-4 py-2 text-sm text-ink"
      data-testid="notice"
    >
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={dismissNotice}
        className="shrink-0 text-ink-muted hover:text-ink"
        aria-label="Dismiss message"
      >
        ✕
      </button>
    </div>
  );
}

function BootScreen({
  failed,
  onRetry,
}: {
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      {failed ? (
        <>
          <p className="text-lg text-ink">Can't reach the game server.</p>
          <p className="max-w-sm text-sm text-ink-muted">
            Check your connection, then try again. Your balance and any open round are saved on the
            server.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-latex px-6 py-3 font-semibold text-night"
          >
            Try again
          </button>
        </>
      ) : (
        <p className="animate-pulse text-sm text-ink-muted" role="status">
          Loading your wallet…
        </p>
      )}
    </main>
  );
}
