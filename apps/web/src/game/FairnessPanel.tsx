import type { GameState, RotateCommitmentResponse } from '@pump/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, api } from '../api/client';
import { shortHash } from '../lib/format';
import { GAME_KEY, useGame } from './gameContext';
import { useSettings } from './settingsContext';

/**
 * Commit-reveal in plain sight: the hash of the next server seed is shown before the player
 * chooses a client seed or bets, and the seed itself is revealed when the round ends.
 */
export function FairnessPanel({ disabled }: { readonly disabled: boolean }) {
  const { state } = useGame();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const seedId = useId();
  const [revoked, setRevoked] = useState<RotateCommitmentResponse['revoked'] | null>(null);
  const rotate = useMutation({
    mutationFn: (commitmentId: string) => api.rotateCommitment({ commitmentId }),
    onSuccess: (response) => {
      setRevoked(response.revoked);
      queryClient.setQueryData<GameState>(
        GAME_KEY,
        (previous) => previous && { ...previous, nextCommitment: response.nextCommitment },
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.body.state) {
        queryClient.setQueryData(GAME_KEY, error.body.state);
      }
    },
  });
  const round = state?.round?.status === 'ACTIVE' ? state.round : null;

  return (
    <details className="group rounded-2xl border border-ink/10 bg-night/40 px-4 py-3 open:pb-4">
      <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:hidden">
        <span className="flex items-center justify-between">
          Provably fair
          <span className="text-xs font-normal text-ink-faint group-open:hidden">Show seeds</span>
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {round && (
          <HashRow
            label="This round's seed hash"
            value={round.fairness.commitment}
            detail={`Nonce ${round.fairness.nonce.toString()}, revealed when the round ends`}
          />
        )}
        {state && (
          <HashRow
            label="Next round's seed hash"
            value={state.nextCommitment.commitment}
            detail={`Nonce ${state.nextCommitment.nonce.toString()}, fixed before you bet`}
            testId="next-commitment"
          />
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={seedId} className="text-ink-muted">
            Your client seed
          </label>
          <div className="flex gap-2">
            <input
              id={seedId}
              value={settings.clientSeed}
              maxLength={64}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                settings.setClientSeed(event.target.value);
              }}
              aria-invalid={settings.clientSeedError !== null}
              aria-describedby={`${seedId}-help`}
              className="w-full min-w-0 rounded-xl border border-ink/12 bg-night px-3 py-2 font-sans text-sm text-ink outline-none focus:border-gauge/60 aria-[invalid=true]:border-danger/70"
              data-testid="client-seed"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={settings.randomizeClientSeed}
              className="shrink-0 rounded-xl border border-ink/12 px-3 text-ink-muted hover:enabled:border-ink/30 disabled:opacity-40"
            >
              New
            </button>
          </div>
          <p
            id={`${seedId}-help`}
            className={`text-xs ${settings.clientSeedError ? 'text-danger' : 'text-ink-faint'}`}
          >
            {settings.clientSeedError ??
              'A new random seed is picked after every bet, once the next hash is fixed, so the server can never know it in advance. You can type your own for your next bet.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            disabled={disabled || !state || rotate.isPending}
            onClick={() => {
              if (state) rotate.mutate(state.nextCommitment.id);
            }}
            className="text-sm text-gauge underline-offset-4 hover:underline disabled:opacity-40"
          >
            Get a new seed hash
          </button>
          <Link to="/verify" className="text-sm text-gauge underline-offset-4 hover:underline">
            Verify a round
          </Link>
        </div>
        {revoked && (
          <p className="rounded-xl bg-night-2 p-3 text-xs text-ink-muted" role="status">
            The previous hash {shortHash(revoked.commitment)} will never be used. Its seed is now
            public: <span className="break-all text-ink">{revoked.serverSeed}</span>
          </p>
        )}
        {rotate.error && (
          <p className="text-xs text-danger" role="alert">
            {rotate.error.message}
          </p>
        )}
      </div>
    </details>
  );
}

function HashRow({
  label,
  value,
  detail,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink-muted">{label}</span>
      <code
        className="break-all font-sans text-xs text-ink tabular"
        data-testid={testId}
        title={value}
      >
        {value}
      </code>
      <span className="text-xs text-ink-faint">{detail}</span>
    </div>
  );
}
