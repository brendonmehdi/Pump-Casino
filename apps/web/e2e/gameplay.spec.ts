import { expect, openGame, placeBet, pump, test } from './support';

test('a new player starts with $10,000 and sees the seed hash before betting', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('balance')).toContainText('$10,000.00');
  await page.locator('details', { hasText: 'Provably fair' }).locator('summary').click();
  await expect(page.getByTestId('next-commitment')).toHaveText(/^[0-9a-f]{64}$/);
});

test('bet, pump twice and cash out at the exact floored payout', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await placeBet(page, '10');
  await expect(page.getByTestId('balance')).toContainText('$9,990.00');
  await expect(page.getByTestId('cashout-button')).toBeDisabled();
  await expect(page.getByTestId('next-risk')).toContainText('8.00%');

  await pump(page);
  await expect(page.getByTestId('cashout-value')).toHaveText('$10.54');
  await expect(page.getByTestId('next-risk')).toContainText('9.25%');
  await pump(page);
  await expect(page.getByTestId('cashout-value')).toHaveText('$11.61');

  await page.getByTestId('cashout-button').click();
  await expect(page.getByTestId('round-result')).toHaveText('Won $11.61');
  await expect(page.getByTestId('balance')).toContainText('$10,001.61');
  await expect(page.getByTestId('recent-rounds')).toContainText('1.16×');
});

test('the balloon pops on the committed pump and the bet is lost', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, 2);
  await placeBet(page, '5');
  await pump(page);
  await expect(page.getByTestId('cashout-value')).toHaveText('$5.27');
  await pump(page);
  await expect(page.getByTestId('round-result')).toHaveText('Lost $5.00');
  await expect(page.getByTestId('balance')).toContainText('$9,995.00');
  await expect(page.getByTestId('recent-rounds')).toContainText('Pop 2');
  await expect(page.getByTestId('bet-button')).toBeEnabled();
});

test('a refresh mid-round restores the round exactly', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await placeBet(page, '2');
  for (let i = 0; i < 3; i += 1) await pump(page);
  await expect(page.getByTestId('cashout-value')).toHaveText('$2.59');

  await page.reload();
  await expect(page.getByTestId('pump-button')).toBeVisible();
  await expect(page.getByTestId('multiplier')).toContainText('1.29');
  await expect(page.getByTestId('cashout-value')).toHaveText('$2.59');
  await page.getByTestId('cashout-button').click();
  await expect(page.getByTestId('round-result')).toHaveText('Won $2.59');
});

test('cash out stays locked until the first pump', async ({ page }) => {
  await openGame(page);
  await placeBet(page, '1');
  await expect(page.getByTestId('cashout-button')).toBeDisabled();
  await expect(page.getByTestId('cashout-button')).toContainText('after your first pump');
});

test('bets outside the limits are refused before they are sent', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('bet-input').fill('0.05');
  await expect(page.getByText('The minimum bet is $0.10')).toBeVisible();
  await expect(page.getByTestId('bet-button')).toBeDisabled();
  await page.getByTestId('bet-input').fill('1000.01');
  await expect(page.getByText('The maximum bet is $1,000')).toBeVisible();
  await expect(page.getByTestId('bet-button')).toBeDisabled();
});

test('between rounds the ladder previews payouts for the bet you are about to place', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await placeBet(page, '10');
  await pump(page);
  await page.getByTestId('cashout-button').click();
  await expect(page.getByTestId('round-result')).toHaveText('Won $10.54');
  const ladder = page.getByRole('list', {
    name: 'Multiplier, pop chance and payout for each pump',
  });
  await page.getByTestId('bet-input').fill('100');
  // Pump 1 on $100 pays floor(10,000¢ × 1.0543…) = $105.43, not the finished round's $10.54.
  await expect(ladder).toContainText('$105.43');
  await expect(ladder).not.toContainText('$10.54');
});
