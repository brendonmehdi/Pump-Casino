import { useEffect, useRef } from 'react';

interface Hotkeys {
  readonly enabled: boolean;
  readonly onPump: () => void;
  readonly onCashOut: () => void;
  readonly onEscape: () => void;
}

/**
 * Space pumps and Enter cashes out — each key does one thing and neither ever places a bet.
 * Keys are ignored while typing (inputs, dialogs) and when focus is on a control outside the
 * game area, held keys never repeat an action, and the browser's own button activation is
 * suppressed so a focused button cannot fire the action a second time.
 */
export function useGameHotkeys({ enabled, onPump, onCashOut, onEscape }: Hotkeys): void {
  const handlers = useRef({ onPump, onCashOut, onEscape });
  useEffect(() => {
    handlers.current = { onPump, onCashOut, onEscape };
  });

  useEffect(() => {
    let swallowSpaceUp = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handlers.current.onEscape();
        return;
      }
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (
        !enabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !isGameTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === ' ') swallowSpaceUp = true;
      if (event.repeat) return;
      if (event.key === ' ') handlers.current.onPump();
      else handlers.current.onCashOut();
    };
    // Buttons activate on Space at keyup; cancel that if keydown already handled the key.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && swallowSpaceUp) {
        event.preventDefault();
        swallowSpaceUp = false;
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, [enabled]);
}

function isGameTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return true;
  if (target.isContentEditable) return false;
  if (target.closest('input, textarea, select, [role="dialog"]')) return false;
  return target.closest('[data-game-hotkeys]') !== null;
}
