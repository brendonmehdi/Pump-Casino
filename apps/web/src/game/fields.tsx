import { parseMultiplierToHundredths } from '@pump/contracts';
import { PUMP_V1, meetsAutoCashoutTarget } from '@pump/engine';
import { useId } from 'react';
import { percent } from '../lib/format';
import { scaleBet, useSettings } from './settingsContext';

const inputClass =
  'w-full min-w-0 rounded-xl border border-ink/12 bg-night px-3 py-2.5 text-base text-ink tabular outline-none transition-colors placeholder:text-ink-faint focus:border-gauge/60 disabled:opacity-50 aria-[invalid=true]:border-danger/70';

/** Keeps typing to digits and one decimal point; the value is still validated strictly. */
const decimalOnly = (value: string) => value.replace(/[^0-9.]/g, '');

export function BetAmountField({ disabled }: { readonly disabled: boolean }) {
  const id = useId();
  const { betInput, setBetInput, betCents, betError } = useSettings();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-ink-muted">
        Bet amount
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          >
            $
          </span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={betInput}
            disabled={disabled}
            onChange={(event) => {
              setBetInput(decimalOnly(event.target.value));
            }}
            aria-invalid={betError !== null}
            aria-describedby={`${id}-help`}
            className={`${inputClass} pl-7`}
            data-testid="bet-input"
          />
        </div>
        <button
          type="button"
          disabled={disabled || betCents === null}
          onClick={() => {
            if (betCents !== null) setBetInput(scaleBet(betCents, 'half'));
          }}
          className="min-h-11 rounded-xl border border-ink/12 px-3 text-sm text-ink-muted hover:enabled:border-ink/30 disabled:opacity-40"
          aria-label="½: halve the bet"
        >
          ½
        </button>
        <button
          type="button"
          disabled={disabled || betCents === null}
          onClick={() => {
            if (betCents !== null) setBetInput(scaleBet(betCents, 'double'));
          }}
          className="min-h-11 rounded-xl border border-ink/12 px-3 text-sm text-ink-muted hover:enabled:border-ink/30 disabled:opacity-40"
          aria-label="2×: double the bet"
        >
          2×
        </button>
      </div>
      <p id={`${id}-help`} className={`text-xs ${betError ? 'text-danger' : 'text-ink-faint'}`}>
        {betError ?? 'From $0.10 to $1,000'}
      </p>
    </div>
  );
}

/** Explains a target in terms of the ladder: which pump first reaches it and how likely that is. */
function describeTarget(multiplier: string): string {
  const hundredths = parseMultiplierToHundredths(multiplier);
  if (hundredths === null) return '';
  const step = PUMP_V1.ladder.find((rung) => meetsAutoCashoutTarget(rung.multiplier, hundredths));
  if (!step) return 'Higher than the top rung, so the round cashes out at pump 25 instead.';
  return `Reached on pump ${step.pump.toString()}, a ${percent(step.survival)} chance of getting there.`;
}

interface TargetFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly testId: string;
}

export function MultiplierField({
  label,
  value,
  onChange,
  error,
  disabled,
  testId,
}: TargetFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(decimalOnly(event.target.value));
          }}
          aria-invalid={error !== null}
          aria-describedby={`${id}-help`}
          className={`${inputClass} pr-8`}
          data-testid={testId}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-faint"
        >
          ×
        </span>
      </div>
      <p id={`${id}-help`} className={`text-xs ${error ? 'text-danger' : 'text-ink-faint'}`}>
        {error ?? describeTarget(value)}
      </p>
    </div>
  );
}

export function AutoCashoutSetting({ disabled }: { readonly disabled: boolean }) {
  const settings = useSettings();
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-ink-muted">
          Auto cash-out
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={settings.autoCashoutEnabled}
          disabled={disabled}
          onClick={() => {
            settings.setAutoCashoutEnabled(!settings.autoCashoutEnabled);
          }}
          className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${settings.autoCashoutEnabled ? 'bg-win/70' : 'bg-ink/15'}`}
          data-testid="auto-cashout-toggle"
        >
          <span
            className={`absolute top-1 left-1 size-5 rounded-full bg-ink transition-transform ${settings.autoCashoutEnabled ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      {settings.autoCashoutEnabled && (
        <MultiplierField
          label="Cash out at"
          value={settings.autoCashoutInput}
          onChange={settings.setAutoCashoutInput}
          error={settings.autoCashoutError}
          disabled={disabled}
          testId="auto-cashout-input"
        />
      )}
    </div>
  );
}
