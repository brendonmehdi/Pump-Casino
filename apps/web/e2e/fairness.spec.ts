import type { Response } from '@playwright/test';
import { expect, openGame, placeBet, pump, test } from './support';

test('the server seed and pop point never reach the browser before the round ends', async ({
  page,
  oracle,
}) => {
  const bodies: Promise<string>[] = [];
  const record = (response: Response) => {
    if (response.url().includes('/api/')) bodies.push(response.text());
  };
  page.on('response', record);

  await openGame(page);
  await oracle.rigNextRound(page, 4);
  await placeBet(page, '1');
  for (let i = 0; i < 3; i += 1) await pump(page);
  await page.reload();
  await expect(page.getByTestId('pump-button')).toBeVisible();

  const roundId = (await (await page.request.get('/api/pump/current')).json()) as {
    round: { id: string };
  };
  const seed = await oracle.serverSeedOf(roundId.round.id);
  const whileActive = await Promise.all(bodies.splice(0));
  expect(whileActive.length).toBeGreaterThan(5);
  for (const body of whileActive) {
    expect(body).not.toContain(seed);
    expect(body.toLowerCase()).not.toContain('poppoint');
    expect(body).not.toMatch(/pop_point/);
  }

  await pump(page); // pump 4 pops, as committed
  await expect(page.getByTestId('round-result')).toHaveText('Lost $1.00');
  const afterEnd = await Promise.all(bodies.splice(0));
  expect(afterEnd.some((body) => body.includes(seed))).toBe(true);
});

test('a finished round verifies in the browser from its revealed seed', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, 3);
  await placeBet(page, '1');
  for (let i = 0; i < 3; i += 1) await pump(page);
  await expect(page.getByTestId('round-result')).toHaveText('Lost $1.00');

  await page.getByTestId('recent-rounds').getByRole('link').first().click();
  await expect(page.getByTestId('verify-verdict')).toContainText('Verified');
  const report = page.getByTestId('verify-report');
  await expect(report).toContainText('Matches SHA-256 of the revealed seed');
  await expect(report).toContainText('The balloon was always going to pop on pump 3.');
  await expect(report.getByRole('row')).toHaveCount(4); // header + 3 draws
  // The hash is checked against this browser's own record, not just the server's report.
  await expect(page.getByTestId('verify-shown-hash')).toHaveText(
    'Same hash this browser recorded when you placed the bet',
  );
});

test('every bet sends a fresh client seed, picked only after the next hash is fixed', async ({
  page,
}) => {
  await openGame(page);
  await page.locator('details', { hasText: 'Provably fair' }).locator('summary').click();
  const seedField = page.getByTestId('client-seed');
  const seeds: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    const seed = await seedField.inputValue();
    await placeBet(page, '1');
    const state = (await (await page.request.get('/api/pump/current')).json()) as {
      round: { id: string; version: number; fairness: { clientSeed: string } };
    };
    expect(state.round.fairness.clientSeed).toBe(seed);
    // Replaced as soon as it has been used, so the server can't know the next one in advance.
    await expect(seedField).not.toHaveValue(seed);
    seeds.push(seed);
    await pump(page);
    if (await page.getByTestId('cashout-button').isEnabled()) {
      await page.getByTestId('cashout-button').click();
    }
    await expect(page.getByTestId('bet-button')).toBeEnabled();
  }
  expect(new Set(seeds).size).toBe(2);
});
