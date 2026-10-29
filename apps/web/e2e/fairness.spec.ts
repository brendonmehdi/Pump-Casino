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
});
