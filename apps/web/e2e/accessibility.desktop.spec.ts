import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openGame, placeBet, pump, test } from './support';

/** Fails on WCAG 2.x A/AA violations that axe rates serious or critical. */
async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
  expect(serious).toEqual([]);
}

test('the game screen has no serious accessibility violations, idle or mid-round', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await expectNoSeriousViolations(page);
  await oracle.rigNextRound(page, null);
  await placeBet(page, '1');
  await pump(page);
  await expectNoSeriousViolations(page);
});

test('the verify and history pages have no serious accessibility violations', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, 1);
  await placeBet(page, '1');
  await pump(page);
  await page.getByTestId('recent-rounds').getByRole('link').first().click();
  await expect(page.getByTestId('verify-verdict')).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.goto('/history');
  await expect(page.getByTestId('history-list')).toBeVisible();
  await expectNoSeriousViolations(page);
  // The game screen again, now with a popped round's pill in the recent rounds.
  await page.goto('/');
  await expect(page.getByTestId('recent-rounds')).toContainText('Pop 1');
  await expectNoSeriousViolations(page);
});
