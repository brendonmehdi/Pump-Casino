import { useId } from 'react';
import { MultiplierField } from '../game/fields';
import { money, plural } from '../lib/format';
import { MAX_AUTO_ROUNDS, describeStop, type AutoBetConfig } from './autobet';
import type { AutoBetDraft, DraftFields } from './useAutoBetDraft';
import type { AutoBetController } from './useAutoBet';

export function AutoBetSettings({
  draft,
  fields,
  disabled,
}: {
  readonly draft: AutoBetDraft;
  readonly fields: DraftFields;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <NumberField
        label="Number of rounds"
        value={fields.rounds}
        onChange={(value) => {
          fields.setRounds(value.replace(/[^0-9]/g, ''));
        }}
        error={draft.errors.rounds}
        help={`Up to ${MAX_AUTO_ROUNDS.toLocaleString('en-US')} per session`}
        disabled={disabled}
        testId="auto-rounds"
      />
      <MultiplierField
        label="Cash out each round at"
        value={fields.target}
        onChange={fields.setTarget}
        error={draft.errors.target}
        disabled={disabled}
        testId="auto-target"
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Stop at profit"
          prefix="$"
          value={fields.profit}
          onChange={(value) => {
            fields.setProfit(value.replace(/[^0-9.]/g, ''));
          }}
          error={draft.errors.profit}
          help="Optional"
          disabled={disabled}
          testId="auto-profit"
        />
        <NumberField
          label="Stop at loss"
          prefix="$"
          value={fields.loss}
          onChange={(value) => {
            fields.setLoss(value.replace(/[^0-9.]/g, ''));
          }}
          error={draft.errors.loss}
          help="Optional"
          disabled={disabled}
          testId="auto-loss"
        />
      </div>
      <p className="text-xs text-ink-faint">
        Every round uses the same bet. Auto-bet also stops when your balance can't cover the next
        bet, and Stop takes effect before the next pump.
      </p>
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly help: string;
  readonly disabled: boolean;
  readonly prefix?: string;
  readonly testId: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {props.label}
      </label>
      <div className="relative">
        {props.prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          >
            {props.prefix}
          </span>
        )}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
          aria-invalid={props.error !== null}
          aria-describedby={`${id}-help`}
          className={`w-full min-w-0 rounded-xl border border-ink/12 bg-night py-2.5 text-base text-ink tabular outline-none focus:border-gauge/60 disabled:opacity-50 aria-[invalid=true]:border-danger/70 ${props.prefix ? 'pl-7 pr-3' : 'px-3'}`}
          data-testid={props.testId}
        />
      </div>
      <p id={`${id}-help`} className={`text-xs ${props.error ? 'text-danger' : 'text-ink-faint'}`}>
        {props.error ?? props.help}
      </p>
    </div>
  );
}

/** Replaces Bet/Pump and Cash out while in auto mode; Pause and Stop are always reachable. */
export function AutoBetBar({
  controller,
  config,
  blockedReason,
}: {
  readonly controller: AutoBetController;
  readonly config: AutoBetConfig | null;
  readonly blockedReason: string | null;
}) {
  const { status, stats, stopReason } = controller;
  const running = status !== 'idle';
  const net = stats.netCents;
  return (
    <div className="flex flex-col gap-2" data-testid="autobet-bar">
      <div className="grid grid-cols-[1.35fr_1fr] gap-3">
        {running ? (
          <button
            type="button"
            onClick={status === 'paused' ? controller.resume : controller.pause}
            className="min-h-14 rounded-full bg-gauge px-6 text-lg font-semibold text-night active:scale-[0.97]"
            data-testid="autobet-pause"
          >
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        ) : (
          <button
            type="button"
            disabled={config === null || blockedReason !== null}
            onClick={() => {
              if (config) controller.start(config);
            }}
            className="min-h-14 rounded-full bg-latex px-6 text-lg font-semibold text-night shadow-[0_8px_30px_-8px_rgba(255,139,167,0.65)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
            data-testid="autobet-start"
          >
            Start auto-bet
          </button>
        )}
        <button
          type="button"
          disabled={!running}
          onClick={controller.stop}
          className="min-h-14 rounded-full border border-danger/60 px-4 font-semibold text-danger active:scale-[0.97] disabled:border-ink/15 disabled:text-ink-faint"
          data-testid="autobet-stop"
        >
          Stop
        </button>
      </div>
      <p
        className="text-center text-xs text-ink-muted tabular"
        role="status"
        data-testid="autobet-status"
      >
        {running
          ? `Round ${Math.min(stats.roundsPlayed + 1, config?.rounds ?? Infinity).toString()} of ${config?.rounds.toString() ?? '?'}, ${net >= 0n ? 'up' : 'down'} ${money(net >= 0n ? net : -net)}`
          : (blockedReason ??
            (stopReason
              ? `${describeStop(stopReason)} ${plural(stats.roundsPlayed, 'round')}, ${net >= 0n ? 'up' : 'down'} ${money(net >= 0n ? net : -net)}.`
              : 'Set your limits, then start.'))}
      </p>
    </div>
  );
}
