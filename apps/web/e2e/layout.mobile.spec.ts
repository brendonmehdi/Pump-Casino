import type { Page } from '@playwright/test';
import { expect, openGame, placeBet, test } from './support';

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function expectThumbTarget(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId);
  await expect(target).toBeInViewport();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

test('fits a phone in portrait with the actions in thumb reach', async ({ page }) => {
  await openGame(page);
  await expectNoHorizontalScroll(page);
  await expectThumbTarget(page, 'bet-button');
  await placeBet(page, '1');
  await expectThumbTarget(page, 'pump-button');
  await expectThumbTarget(page, 'cashout-button');
  await expect(page.getByTestId('multiplier')).toBeInViewport();
  await expect(page.getByTestId('next-risk')).toBeInViewport();
});

test('stays usable in landscape', async ({ page }) => {
  const portrait = page.viewportSize();
  if (!portrait) throw new Error('no viewport');
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await openGame(page);
  await expectNoHorizontalScroll(page);
  await expectThumbTarget(page, 'bet-button');
});

test('the menu offers navigation and sound controls on small screens', async ({ page }) => {
  await openGame(page);
  await page.getByLabel('Sound, motion and shortcuts').click();
  await expect(page.getByTestId('sound-toggle')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('link', { name: 'Verify' })
    .click();
  await expect(page.getByRole('heading', { name: 'Verify a round' })).toBeVisible();
});
