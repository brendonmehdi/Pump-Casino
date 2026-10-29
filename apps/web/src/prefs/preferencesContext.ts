import { createContext, useContext } from 'react';
import type { SoundCue } from './soundEngine';

export interface Preferences {
  readonly muted: boolean;
  readonly setMuted: (muted: boolean) => void;
  readonly volume: number;
  readonly setVolume: (volume: number) => void;
  /** The in-game switch; `reducedMotion` also honours the operating-system setting. */
  readonly reduceMotionSetting: boolean;
  readonly setReduceMotionSetting: (value: boolean) => void;
  readonly reducedMotion: boolean;
  /** Plays a cue; the first call from a user gesture also unlocks audio. */
  readonly play: (cue: SoundCue, intensity?: number) => void;
  readonly unlockAudio: () => void;
  /** False when the browser has no Web Audio; the sound controls say so. */
  readonly soundSupported: boolean;
}

export const PreferencesContext = createContext<Preferences | null>(null);

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}
