import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke tests for a deployed site (playwright.production.config.ts). Outcomes are real and
 * unrigged, so every step copes with a pop, and each test is a new player with $10,000.
 * Phones tap instead of clicking.
 */
async function press(page: Page, testId: string, isMobile: boolean): Promise<void> {
  const target = page.getByTestId(testId);
  if (isMobile) await target.tap();
  else await target.click();
}

/** Bets $1 and pumps until a first pump survives (pump 1 pops 8% of the time). */
async function openPumpedRound(page: Page, isMobile: boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.getByTestId('bet-input').fill('1');
    await press(page, 'bet-button', isMobile);
    await expect(page.getByTestId('pump-button')).toBeVisible();
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/pump/pump'));
    await press(page, 'pump-button', isMobile);
    const state = (await (await answered).json()) as { round: { status: string } };
    if (state.round.status === 'ACTIVE') {
      await expect(page.getByTestId('cashout-button')).toBeEnabled();
      return;
    }
    await expect(page.getByTestId('bet-button')).toBeEnabled();
  }
  throw new Error('ten first pumps in a row popped');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('a new player can bet, pump and cash out', async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('balance')).toContainText('$10,000.00');
  await openPumpedRound(page, isMobile);
  const value = (await page.getByTestId('cashout-value').textContent()) ?? '';
  await press(page, 'cashout-button', isMobile);
  await expect(page.getByTestId('round-result')).toHaveText(`Won ${value}`);
  await expect(page.getByTestId('recent-rounds').getByRole('link').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a refresh mid-round restores the round', async ({ page, isMobile }) => {
  await page.goto('/');
  await openPumpedRound(page, isMobile);
  const value = (await page.getByTestId('cashout-value').textContent()) ?? '';
  await page.reload();
  await expect(page.getByTestId('pump-button')).toBeVisible();
  await expect(page.getByTestId('cashout-value')).toHaveText(value);
  await press(page, 'cashout-button', isMobile);
  await expect(page.getByTestId('round-result')).toHaveText(`Won ${value}`);
});

test('a finished round verifies in the browser and is listed in history', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await openPumpedRound(page, isMobile);
  await press(page, 'cashout-button', isMobile);
  await expect(page.getByTestId('round-result')).toContainText('Won');
  await page.getByTestId('recent-rounds').getByRole('link').first().click();
  await expect(page.getByTestId('verify-verdict')).toContainText('Verified');
  await page.goto('/history');
  await expect(page.getByTestId('history-list')).toContainText('×, paid $');
});

test('the game fits the screen with the actions in reach', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByTestId('bet-button')).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await openPumpedRound(page, isMobile);
  for (const testId of ['pump-button', 'cashout-button']) {
    const target = page.getByTestId(testId);
    await expect(target).toBeInViewport();
    if (isMobile) expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await press(page, 'cashout-button', isMobile);
  await expect(page.getByTestId('round-result')).toContainText('Won');
});
