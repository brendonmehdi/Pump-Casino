import {
  centsToDollarString,
  formatHundredths,
  parseDollarsToCents,
  parseMultiplierToHundredths,
} from '@pump/contracts';
import { PUMP_RULES_V1 } from '@pump/engine';
import { createContext, useContext } from 'react';

const rules = PUMP_RULES_V1;

export interface PlaySettings {
  readonly betInput: string;
  readonly setBetInput: (value: string) => void;
  /** Parsed bet in cents, or null while the input is invalid. */
  readonly betCents: bigint | null;
  readonly betError: string | null;
  readonly autoCashoutEnabled: boolean;
  readonly setAutoCashoutEnabled: (value: boolean) => void;
  readonly autoCashoutInput: string;
  readonly setAutoCashoutInput: (value: string) => void;
  /** Normalised multiplier ("2.50") when enabled and valid; null for manual play. */
  readonly autoCashout: string | null;
  readonly autoCashoutError: string | null;
  readonly clientSeed: string;
  readonly setClientSeed: (value: string) => void;
  readonly clientSeedError: string | null;
  readonly randomizeClientSeed: () => void;
}

export const SettingsContext = createContext<PlaySettings | null>(null);

export function validateBet(input: string): { cents: bigint | null; error: string | null } {
  const cents = parseDollarsToCents(input);
  if (cents === null) return { cents: null, error: 'Enter an amount like 10 or 10.50' };
  if (cents < rules.minBetCents) return { cents: null, error: 'The minimum bet is $0.10' };
  if (cents > rules.maxBetCents) return { cents: null, error: 'The maximum bet is $1,000' };
  return { cents, error: null };
}

export function validateMultiplier(input: string): { value: string | null; error: string | null } {
  const hundredths = parseMultiplierToHundredths(input);
  if (
    hundredths === null ||
    hundredths < rules.minAutoCashoutHundredths ||
    hundredths > rules.maxAutoCashoutHundredths
  ) {
    return { value: null, error: 'Use a multiplier from 1.01 to 1000 with up to 2 decimals' };
  }
  return { value: formatHundredths(hundredths), error: null };
}

export function useSettings(): PlaySettings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}

/** Halves or doubles a bet within the allowed range, for the quick-adjust buttons. */
export function scaleBet(cents: bigint, factor: 'half' | 'double'): string {
  const next = factor === 'half' ? cents / 2n : cents * 2n;
  const clamped =
    next < rules.minBetCents
      ? rules.minBetCents
      : next > rules.maxBetCents
        ? rules.maxBetCents
        : next;
  return centsToDollarString(clamped);
}
