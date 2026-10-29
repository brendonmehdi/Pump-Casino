import { useEffect } from 'react';
import { useGame } from './gameContext';
import { useSettings } from './settingsContext';

/**
 * Picks a new random client seed as soon as the current one has been sent with a bet. The same
 * request fixes the next round's server seed, so the next client seed is chosen only after the
 * server has committed to its own: the server can never know it in advance, and so cannot search
 * for a server seed that suits it. A seed the player types is used for their next bet only.
 */
export function useFreshClientSeed(): void {
  const { state } = useGame();
  const { clientSeed, randomizeClientSeed } = useSettings();
  const usedSeed = state?.round?.fairness.clientSeed;
  useEffect(() => {
    if (usedSeed !== undefined && usedSeed === clientSeed) randomizeClientSeed();
  }, [usedSeed, clientSeed, randomizeClientSeed]);
}
