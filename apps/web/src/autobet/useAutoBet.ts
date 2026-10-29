import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame, type ActionResult } from '../game/gameContext';
import { useSettings } from '../game/settingsContext';
import { usePreferences } from '../prefs/preferencesContext';
import {
  EMPTY_STATS,
  decideNext,
  recordRound,
  type AutoBetConfig,
  type AutoBetStats,
  type StopReason,
} from './autobet';

export type AutoBetStatus = 'idle' | 'running' | 'paused';

/** Pacing that keeps each pump readable; faster when animations are reduced. */
const PUMP_GAP_MS = { normal: 380, reduced: 120 };
const ROUND_GAP_MS = { normal: 900, reduced: 250 };

export interface AutoBetController {
  readonly status: AutoBetStatus;
  readonly stats: AutoBetStats;
  readonly stopReason: StopReason | null;
  readonly start: (config: AutoBetConfig) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  /** Takes effect before the next request; an open round stays open for manual play. */
  readonly stop: () => void;
}

export function useAutoBet(): AutoBetController {
  const game = useGame();
  const { clientSeed } = useSettings();
  const { reducedMotion, unlockAudio } = usePreferences();
  const [status, setStatus] = useState<AutoBetStatus>('idle');
  const [stats, setStats] = useState<AutoBetStats>(EMPTY_STATS);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);

  // The loop is async, so it reads the latest values through a ref instead of stale closures.
  // Every await in the loop yields to React, so the ref is current whenever it is read.
  const latest = useRef({ game, clientSeed, reducedMotion });
  useEffect(() => {
    latest.current = { game, clientSeed, reducedMotion };
  });
  const control = useRef<{ stop: boolean; paused: boolean; wake: (() => void) | null }>({
    stop: false,
    paused: false,
    wake: null,
  });
  const running = useRef(false);
  // Flipped by Stop while the loop awaits; reading it via a call keeps TypeScript from
  // treating the value as narrowed for the rest of the iteration.
  const stopRequested = useCallback(() => control.current.stop, []);

  useEffect(
    () => () => {
      control.current.stop = true;
      control.current.wake?.();
    },
    [],
  );

  const wait = useCallback(async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    while (control.current.paused && !control.current.stop) {
      await new Promise<void>((resolve) => {
        control.current.wake = resolve;
      });
    }
  }, []);

  const start = useCallback(
    (config: AutoBetConfig) => {
      if (running.current) return;
      running.current = true;
      control.current = { stop: false, paused: false, wake: null };
      unlockAudio();
      setStats(EMPTY_STATS);
      setStopReason(null);
      setStatus('running');

      const loop = async (): Promise<StopReason> => {
        let session = EMPTY_STATS;
        for (;;) {
          const { game: current, clientSeed: seed, reducedMotion: reduced } = latest.current;
          if (stopRequested()) return 'STOPPED';
          const balance = BigInt(current.state?.wallet.balanceCents ?? '0');
          const decision = decideNext(config, session, balance);
          if (decision.kind === 'stop') return decision.reason;

          let result: ActionResult = await current.start({
            betCents: config.betCents,
            clientSeed: seed,
            autoCashout: config.target,
          });
          if (!result.ok)
            return result.reason === 'rejected' && result.code === 'INSUFFICIENT_BALANCE'
              ? 'INSUFFICIENT_BALANCE'
              : 'ERROR';
          let round = result.state.round;
          while (round?.status === 'ACTIVE') {
            await wait(reduced ? PUMP_GAP_MS.reduced : PUMP_GAP_MS.normal);
            if (stopRequested()) return 'STOPPED';
            result = await latest.current.game.pump();
            if (!result.ok) return 'ERROR';
            round = result.state.round;
          }
          if (!round) return 'ERROR';
          session = recordRound(session, round);
          setStats(session);
          await wait(reduced ? ROUND_GAP_MS.reduced : ROUND_GAP_MS.normal);
        }
      };

      void loop().then((reason) => {
        running.current = false;
        setStopReason(reason);
        setStatus('idle');
      });
    },
    [unlockAudio, wait, stopRequested],
  );

  const pause = useCallback(() => {
    control.current.paused = true;
    setStatus((current) => (current === 'running' ? 'paused' : current));
  }, []);
  const resume = useCallback(() => {
    control.current.paused = false;
    control.current.wake?.();
    setStatus((current) => (current === 'paused' ? 'running' : current));
  }, []);
  const stop = useCallback(() => {
    control.current.stop = true;
    control.current.paused = false;
    control.current.wake?.();
  }, []);

  return { status, stats, stopReason, start, pause, resume, stop };
}
