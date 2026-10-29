import { parseDollarsToCents } from '@pump/contracts';
import { useSettings, validateMultiplier } from '../game/settingsContext';
import { isString, usePersistentState } from '../lib/usePersistentState';
import { MAX_AUTO_ROUNDS, type AutoBetConfig } from './autobet';

export interface AutoBetDraft {
  readonly config: AutoBetConfig | null;
  readonly errors: {
    readonly rounds: string | null;
    readonly target: string | null;
    readonly profit: string | null;
    readonly loss: string | null;
  };
}

function parseOptionalAmount(input: string): { cents: bigint | null; error: string | null } {
  if (input === '') return { cents: null, error: null };
  const cents = parseDollarsToCents(input);
  return cents === null || cents === 0n
    ? { cents: null, error: 'Enter an amount like 25 or 25.50, or leave empty' }
    : { cents, error: null };
}

export function useAutoBetDraft() {
  const { betCents } = useSettings();
  const [rounds, setRounds] = usePersistentState('auto-rounds', () => '10', isString);
  const [target, setTarget] = usePersistentState('auto-target', () => '2.00', isString);
  const [profit, setProfit] = usePersistentState('auto-profit', () => '', isString);
  const [loss, setLoss] = usePersistentState('auto-loss', () => '', isString);

  const roundCount = /^[1-9][0-9]{0,3}$/.test(rounds) ? Number(rounds) : NaN;
  const roundsError =
    Number.isInteger(roundCount) && roundCount <= MAX_AUTO_ROUNDS
      ? null
      : `Choose 1 to ${MAX_AUTO_ROUNDS.toLocaleString('en-US')} rounds`;
  const targetResult = validateMultiplier(target);
  const profitResult = parseOptionalAmount(profit);
  const lossResult = parseOptionalAmount(loss);
  const draft: AutoBetDraft = {
    errors: {
      rounds: roundsError,
      target: targetResult.error,
      profit: profitResult.error,
      loss: lossResult.error,
    },
    config:
      roundsError === null &&
      targetResult.value !== null &&
      profitResult.error === null &&
      lossResult.error === null &&
      betCents !== null
        ? {
            betCents,
            rounds: roundCount,
            target: targetResult.value,
            stopOnProfitCents: profitResult.cents,
            stopOnLossCents: lossResult.cents,
          }
        : null,
  };
  return {
    draft,
    fields: { rounds, setRounds, target, setTarget, profit, setProfit, loss, setLoss },
  };
}

export type DraftFields = ReturnType<typeof useAutoBetDraft>['fields'];
