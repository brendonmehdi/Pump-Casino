import { expect, openGame, placeBet, test } from './support';

// Common laptop screens are only 720–768px tall. The primary action must be fully visible there
// without scrolling, before a round (Bet) and during one (Pump, Cash out).
const LAPTOP_SCREENS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
];

for (const viewport of LAPTOP_SCREENS) {
  test(`keeps Bet, Pump and Cash out fully on screen at ${viewport.width.toString()}×${viewport.height.toString()}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openGame(page);
    await expect(page.getByTestId('bet-button')).toBeInViewport({ ratio: 1 });
    await placeBet(page, '1');
    await expect(page.getByTestId('pump-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('cashout-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('multiplier')).toBeInViewport({ ratio: 1 });
  });
}
