import { expect, openGame, placeBet, test } from './support';

// Common laptop screens are only 720–768px tall. The primary action must be fully visible there
// without scrolling, before a round (Bet) and during one (Pump, Cash out).
for (const [width, height] of [
  [1280, 720],
  [1366, 768],
]) {
  test(`keeps Bet, Pump and Cash out fully on screen at ${width.toString()}×${height.toString()}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
    await expect(page.getByTestId('bet-button')).toBeInViewport({ ratio: 1 });
    await placeBet(page, '1');
    await expect(page.getByTestId('pump-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('cashout-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('multiplier')).toBeInViewport({ ratio: 1 });
  });
}
