import { CLIENT_SEED_PATTERN } from '@pump/engine';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { isBoolean, isString, usePersistentState } from '../lib/usePersistentState';
import {
  SettingsContext,
  validateBet,
  validateMultiplier,
  type PlaySettings,
} from './settingsContext';

function randomClientSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function SettingsProvider({ children }: { readonly children: ReactNode }) {
  const [betInput, setBetInput] = usePersistentState('bet', () => '1.00', isString);
  const [autoCashoutEnabled, setAutoCashoutEnabled] = usePersistentState(
    'auto-cashout-enabled',
    () => false,
    isBoolean,
  );
  const [autoCashoutInput, setAutoCashoutInput] = usePersistentState(
    'auto-cashout',
    () => '2.00',
    isString,
  );
  const [clientSeed, setClientSeed] = usePersistentState('client-seed', randomClientSeed, isString);
  const randomizeClientSeed = useCallback(() => {
    setClientSeed(randomClientSeed());
  }, [setClientSeed]);

  const value = useMemo<PlaySettings>(() => {
    const bet = validateBet(betInput);
    const auto = validateMultiplier(autoCashoutInput);
    return {
      betInput,
      setBetInput,
      betCents: bet.cents,
      betError: bet.error,
      autoCashoutEnabled,
      setAutoCashoutEnabled,
      autoCashoutInput,
      setAutoCashoutInput,
      autoCashout: autoCashoutEnabled ? auto.value : null,
      autoCashoutError: autoCashoutEnabled ? auto.error : null,
      clientSeed,
      setClientSeed,
      clientSeedError: CLIENT_SEED_PATTERN.test(clientSeed)
        ? null
        : '1–64 letters, digits or symbols; no spaces or "|"',
      randomizeClientSeed,
    };
  }, [
    betInput,
    setBetInput,
    autoCashoutEnabled,
    setAutoCashoutEnabled,
    autoCashoutInput,
    setAutoCashoutInput,
    clientSeed,
    setClientSeed,
    randomizeClientSeed,
  ]);
  return <SettingsContext value={value}>{children}</SettingsContext>;
}
