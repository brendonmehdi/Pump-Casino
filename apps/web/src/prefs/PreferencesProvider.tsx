import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { isBoolean, isUnitInterval, usePersistentState } from '../lib/usePersistentState';
import { PreferencesContext, type Preferences } from './preferencesContext';
import { SoundEngine } from './soundEngine';

export function PreferencesProvider({ children }: { readonly children: ReactNode }) {
  const [engine] = useState(() => new SoundEngine());
  const [muted, setMuted] = usePersistentState('muted', () => false, isBoolean);
  const [volume, setVolume] = usePersistentState('volume', () => 0.6, isUnitInterval);
  const [reduceMotionSetting, setReduceMotionSetting] = usePersistentState(
    'reduce-motion',
    () => false,
    isBoolean,
  );
  const systemPrefersReduced = useReducedMotion() ?? false;
  const reducedMotion = systemPrefersReduced || reduceMotionSetting;

  useEffect(() => {
    engine.setMuted(muted);
  }, [engine, muted]);
  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  const value = useMemo<Preferences>(
    () => ({
      muted,
      setMuted,
      volume,
      setVolume,
      reduceMotionSetting,
      setReduceMotionSetting,
      reducedMotion,
      play: (cue, intensity) => {
        engine.play(cue, intensity);
      },
      unlockAudio: () => {
        engine.unlock();
      },
      soundSupported: engine.supported,
    }),
    [
      engine,
      muted,
      setMuted,
      volume,
      setVolume,
      reduceMotionSetting,
      setReduceMotionSetting,
      reducedMotion,
    ],
  );
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}
