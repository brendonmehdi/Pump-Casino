import type { PublicRound } from '@pump/contracts';
import { useEffect, useRef } from 'react';
import { usePreferences } from '../prefs/preferencesContext';

/**
 * Plays the cue for each server-confirmed change to the round on screen: a pump that survived,
 * a cash-out (a brighter cue at the top of the ladder) or a pop. Only transitions observed in
 * this session make a sound; a round restored after a refresh stays silent.
 */
export function useRoundSounds(round: PublicRound | null): void {
  const { play } = usePreferences();
  const previous = useRef<PublicRound | null>(round);

  useEffect(() => {
    const before = previous.current;
    previous.current = round;
    if (!round || before?.id !== round.id || before.version === round.version) return;
    const pressure = round.pumpCount / round.maxPumps;
    if (round.status === 'ACTIVE' && round.pumpCount > before.pumpCount) play('pump', pressure);
    else if (round.status === 'POPPED') play('pop');
    else if (round.status === 'CASHED_OUT') {
      play(round.settlementReason === 'LADDER_TOP' ? 'top' : 'cashout');
    }
  }, [round, play]);
}
