import { PUMP_V1, derivePopPoint } from '@pump/engine';
import { expect, test as base, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../playwright.config';

interface Oracle {
  /**
   * TEST-ONLY. Reads the secret prepared server seed straight from the database, finds a client
   * seed that makes the next round pop on `popPoint` (null = never pops) and types it into the
   * client-seed field like a player would. Players cannot do this: the seed is only revealed
   * after the round, which is exactly what keeps the game fair.
   */
  readonly rigNextRound: (page: Page, popPoint: number | null) => Promise<void>;
  readonly serverSeedOf: (roundId: string) => Promise<string>;
}

export const test = base.extend<object, { oracle: Oracle }>({
  oracle: [
    async ({}, use) => {
      const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 2 });
      await use({
        rigNextRound: async (page, popPoint) => {
          const state = (await (await page.request.get('/api/pump/current')).json()) as {
            nextCommitment: { id: string };
          };
          const { rows } = await pool.query<{ server_seed: Buffer; nonce: number }>(
            'select server_seed, nonce from seed_commitments where id = $1',
            [state.nextCommitment.id],
          );
          const commitment = rows[0];
          if (!commitment) throw new Error('prepared commitment not found');
          let clientSeed: string | null = null;
          for (let attempt = 0; attempt < 200_000 && clientSeed === null; attempt += 1) {
            const candidate = `e2e-${attempt.toString()}`;
            const found = derivePopPoint(PUMP_V1, {
              serverSeed: commitment.server_seed,
              roundId: state.nextCommitment.id,
              nonce: commitment.nonce,
              clientSeed: candidate,
            });
            if (found === popPoint) clientSeed = candidate;
          }
          if (clientSeed === null) throw new Error('no client seed found');
          const details = page.locator('details', { hasText: 'Provably fair' });
          if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
            await details.locator('summary').click();
          }
          await page.getByTestId('client-seed').fill(clientSeed);
        },
        serverSeedOf: async (roundId) => {
          const { rows } = await pool.query<{ server_seed: Buffer }>(
            'select server_seed from seed_commitments where id = $1',
            [roundId],
          );
          const row = rows[0];
          if (!row) throw new Error('round not found');
          return row.server_seed.toString('hex');
        },
      });
      await pool.end();
    },
    { scope: 'worker' },
  ],
});

export { expect };

export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('bet-button')).toBeVisible();
}

export async function placeBet(page: Page, dollars: string): Promise<void> {
  await page.getByTestId('bet-input').fill(dollars);
  await page.getByTestId('bet-button').click();
  await expect(page.getByTestId('pump-button')).toBeVisible();
}

/** Clicks Pump and waits for the server to answer, so the next action sees the new version. */
export async function pump(page: Page): Promise<void> {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/pump/pump'));
  await page.getByTestId('pump-button').click();
  await response;
}
