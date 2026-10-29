import { useCallback, useState } from 'react';

/**
 * React state mirrored to localStorage for per-browser conveniences (bet size, sound, seed).
 * Storage can be unavailable (private windows, blocked site data); the game then still works
 * and the preference simply is not remembered. Nothing authoritative is ever stored here.
 */
export function usePersistentState<T>(
  key: string,
  fallback: () => T,
  isValid: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStorage(key);
    return isValid(stored) ? stored : fallback();
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStorage(key, next);
    },
    [key],
  );
  return [value, update];
}

function readStorage(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`pump:${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined; // unavailable or corrupt: fall back to the default
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`pump:${key}`, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference lasts for this page view only.
  }
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isUnitInterval = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1;
