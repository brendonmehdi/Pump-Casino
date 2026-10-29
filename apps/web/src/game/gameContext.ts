import type { ErrorCode, GameState, PublicRound } from '@pump/contracts';
import { createContext, useContext } from 'react';

export const GAME_KEY = ['game'] as const;
export const RECENT_KEY = ['history', 'recent'] as const;
export const RECENT_LIMIT = 10;

export type PendingAction = 'start' | 'pump' | 'cashout';

export type ActionResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: 'busy' | 'unavailable' | 'network' }
  | { readonly ok: false; readonly reason: 'rejected'; readonly code: ErrorCode };

export interface Notice {
  readonly message: string;
  /** COMMITMENT_CHANGED: a round started on a different seed hash than the one shown. */
  readonly code: ErrorCode | 'NETWORK' | 'COMMITMENT_CHANGED';
}

export interface StartInput {
  readonly betCents: bigint;
  readonly clientSeed: string;
  /** Multiplier string such as "2.00", or null for manual play. */
  readonly autoCashout: string | null;
}

export interface GameContextValue {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly state: GameState | undefined;
  readonly recent: readonly PublicRound[];
  readonly pending: PendingAction | null;
  readonly reconnecting: boolean;
  readonly notice: Notice | null;
  readonly dismissNotice: () => void;
  readonly retryLoad: () => void;
  readonly start: (input: StartInput) => Promise<ActionResult>;
  readonly pump: () => Promise<ActionResult>;
  readonly cashOut: () => Promise<ActionResult>;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame must be used inside <GameProvider>');
  return value;
}
