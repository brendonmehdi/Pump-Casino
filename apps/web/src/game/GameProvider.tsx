import type { GameState, PublicRound } from '@pump/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, type RetryObserver } from '../api/client';
import { rememberShownCommitment } from './shownCommitments';
import {
  GAME_KEY,
  GameContext,
  RECENT_KEY,
  RECENT_LIMIT,
  type ActionResult,
  type GameContextValue,
  type Notice,
  type PendingAction,
  type StartInput,
} from './gameContext';

const SESSION_KEY = ['session'] as const;

/**
 * Owns the client's copy of server state. The server decides every outcome; this provider only
 * sends one action at a time, replaces its state with whatever the server returns (including
 * the authoritative state attached to conflicts), and never predicts a result.
 */
export function GameProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: api.ensureSession,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const ready = session.isSuccess;
  const game = useQuery({
    queryKey: GAME_KEY,
    queryFn: api.current,
    enabled: ready,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const recent = useQuery({
    queryKey: RECENT_KEY,
    queryFn: async () => (await api.history(RECENT_LIMIT)).rounds,
    enabled: ready,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);

  const applyState = useCallback(
    (state: GameState) => {
      // An action's response is newer than any GET /current still in flight; cancel those so a
      // slow, older snapshot can't land afterwards and overwrite it.
      void queryClient.cancelQueries({ queryKey: GAME_KEY });
      queryClient.setQueryData(GAME_KEY, state);
      const round = state.round;
      if (round && round.status !== 'ACTIVE') {
        queryClient.setQueryData<PublicRound[]>(RECENT_KEY, (previous = []) =>
          [round, ...previous.filter((item) => item.id !== round.id)].slice(0, RECENT_LIMIT),
        );
        void queryClient.invalidateQueries({ queryKey: ['history', 'page'] });
      }
    },
    [queryClient],
  );

  /** Reloads state from the server when a failure leaves us unsure what was committed. */
  const resync = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GAME_KEY });
    void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
  }, [queryClient]);

  const run = useCallback(
    async (
      action: PendingAction,
      perform: (observer: RetryObserver) => Promise<GameState>,
    ): Promise<ActionResult> => {
      if (inFlight.current) return { ok: false, reason: 'busy' };
      inFlight.current = true;
      setPending(action);
      setNotice(null);
      try {
        const state = await perform({
          onRetry: () => {
            setReconnecting(true);
          },
        });
        applyState(state);
        return { ok: true, state };
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.body.state) applyState(error.body.state);
          // A 5xx (or any error without state) may have come after the action committed.
          else resync();
          if (error.code === 'SESSION_REQUIRED') {
            void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
          }
          setNotice({
            message:
              error.status >= 500
                ? 'Something went wrong. Your balance and round were reloaded from the server.'
                : error.message,
            code: error.code,
          });
          return { ok: false, reason: 'rejected', code: error.code };
        }
        setNotice({
          message: 'Lost connection to the server. Showing the latest saved state.',
          code: 'NETWORK',
        });
        resync();
        return { ok: false, reason: 'network' };
      } finally {
        inFlight.current = false;
        setPending(null);
        setReconnecting(false);
      }
    },
    [applyState, queryClient, resync],
  );

  const start = useCallback(
    async (input: StartInput): Promise<ActionResult> => {
      const state = queryClient.getQueryData<GameState>(GAME_KEY);
      if (!state) return { ok: false, reason: 'unavailable' };
      const shown = state.nextCommitment;
      const result = await run('start', (observer) =>
        api.start(
          {
            betCents: input.betCents.toString(),
            clientSeed: input.clientSeed,
            commitmentId: shown.id,
            autoCashoutMultiplier: input.autoCashout,
          },
          observer,
        ),
      );
      // Keep our own record of the hash the player saw, and check the round actually uses it,
      // rather than trusting the server's later report of what it committed to.
      const round = result.ok ? result.state.round : null;
      if (round) {
        rememberShownCommitment(shown.id, shown.commitment);
        if (round.id !== shown.id || round.fairness.commitment !== shown.commitment) {
          setNotice({
            message:
              "This round started on a different seed hash than the one you were shown, so don't trust its result.",
            code: 'COMMITMENT_CHANGED',
          });
        }
      }
      return result;
    },
    [queryClient, run],
  );

  const act = useCallback(
    (action: 'pump' | 'cashout'): Promise<ActionResult> => {
      const round = queryClient.getQueryData<GameState>(GAME_KEY)?.round;
      if (round?.status !== 'ACTIVE') return Promise.resolve({ ok: false, reason: 'unavailable' });
      const body = { roundId: round.id, expectedVersion: round.version };
      return run(action, (observer) =>
        action === 'pump' ? api.pump(body, observer) : api.cashOut(body, observer),
      );
    },
    [queryClient, run],
  );
  const pump = useCallback(() => act('pump'), [act]);
  const cashOut = useCallback(() => act('cashout'), [act]);

  const retryLoad = useCallback(() => {
    void session.refetch();
    void game.refetch();
    void recent.refetch();
  }, [session, game, recent]);

  const failed = session.isError || game.isError;
  const value = useMemo<GameContextValue>(
    () => ({
      phase: failed ? 'error' : game.data ? 'ready' : 'loading',
      state: game.data,
      recent: recent.data ?? [],
      pending,
      reconnecting,
      notice,
      dismissNotice: () => {
        setNotice(null);
      },
      retryLoad,
      start,
      pump,
      cashOut,
    }),
    [
      failed,
      game.data,
      recent.data,
      pending,
      reconnecting,
      notice,
      retryLoad,
      start,
      pump,
      cashOut,
    ],
  );
  return <GameContext value={value}>{children}</GameContext>;
}
