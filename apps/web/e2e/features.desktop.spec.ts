import { expect, openGame, placeBet, pump, test } from './support';

test('auto cash-out settles inside the pump that reaches the target', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await page.getByTestId('auto-cashout-toggle').click();
  await page.getByTestId('auto-cashout-input').fill('1.50');
  await expect(
    page.getByText('Reached on pump 5, a 57.37% chance of getting there.'),
  ).toBeVisible();
  await placeBet(page, '10');
  for (let i = 0; i < 4; i += 1) await pump(page);
  await expect(page.getByTestId('cashout-value')).toHaveText('$14.70');
  await pump(page);
  await expect(page.getByText('Auto cash-out target reached')).toBeVisible();
  await expect(page.getByTestId('round-result')).toHaveText('Won $16.90');
});

test('auto-bet plays a bounded number of rounds one after another', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('mode-auto').click();
  await page.getByTestId('bet-input').fill('0.10');
  await page.getByTestId('auto-rounds').fill('3');
  await page.getByTestId('auto-target').fill('1.10');
  await page.getByTestId('autobet-start').click();
  await expect(page.getByTestId('autobet-status')).toContainText('Finished all rounds. 3 rounds', {
    timeout: 30_000,
  });
  const history = (await (await page.request.get('/api/history')).json()) as {
    rounds: { status: string }[];
  };
  expect(history.rounds).toHaveLength(3);
  expect(history.rounds.every((round) => round.status !== 'ACTIVE')).toBe(true);
});

test('Stop halts auto-bet before the next bet', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('mode-auto').click();
  await page.getByTestId('bet-input').fill('0.10');
  await page.getByTestId('auto-rounds').fill('200');
  await page.getByTestId('auto-target').fill('1.05');
  await page.getByTestId('autobet-start').click();
  await expect(page.getByTestId('autobet-status')).toContainText('Round 2 of 200', {
    timeout: 15_000,
  });
  await page.getByTestId('autobet-stop').click();
  await expect(page.getByTestId('autobet-status')).toContainText('Stopped by you.');
  const played = (await (await page.request.get('/api/history?limit=50')).json()) as {
    rounds: unknown[];
  };
  expect(played.rounds.length).toBeLessThan(10);
});

test('stopping auto-bet mid-round hands the open round back to the player', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, null); // this round never pops
  await page.getByTestId('mode-auto').click();
  await page.getByTestId('bet-input').fill('1');
  await page.getByTestId('auto-rounds').fill('5');
  await page.getByTestId('auto-target').fill('100.00'); // first reached on pump 22
  await page.getByTestId('autobet-start').click();
  await expect(page.getByTestId('cashout-value')).toHaveText('$1.16', { timeout: 15_000 });
  await page.getByTestId('autobet-stop').click();

  await expect(page.getByText('Auto-bet is stopped and this round is still open.')).toBeVisible();
  await page.getByTestId('cashout-button').click();
  await expect(page.getByTestId('round-result')).toContainText('Won $');
  await expect(page.getByTestId('autobet-start')).toBeVisible();
  await expect(page.getByTestId('autobet-status')).toContainText('Stopped by you.');
});

test('auto-bet stops at the loss limit before risking more', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, 1);
  await page.getByTestId('mode-auto').click();
  await page.getByTestId('bet-input').fill('1');
  await page.getByTestId('auto-rounds').fill('100');
  await page.getByTestId('auto-target').fill('2.00');
  // A $1 limit with $1 bets allows exactly one losing round: after it, the next bet could
  // take the session to -$2, past the limit.
  await page.getByTestId('auto-loss').fill('1');
  await page.getByTestId('autobet-start').click();
  await expect(page.getByTestId('autobet-status')).toContainText('loss limit', { timeout: 15_000 });
  await expect(page.getByTestId('autobet-status')).toContainText('1 round, down $1.00');
  await expect(page.getByTestId('balance')).toContainText('$9,999.00');
});

test('keyboard: Space pumps, Enter cashes out, held keys never repeat', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  // Keys typed into a text field stay in the field: the seed input gets the space, no game action.
  const seedInput = page.getByTestId('client-seed');
  const seed = await seedInput.inputValue();
  await seedInput.press('Space');
  await expect(seedInput).toHaveValue(`${seed} `);
  await seedInput.press('Backspace');
  await expect(page.getByTestId('bet-button')).toBeEnabled();
  // Outside a field, Space still never places a bet.
  await page.getByRole('region', { name: 'Balloon' }).click();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('bet-button')).toBeEnabled();
  await placeBet(page, '1');

  const firstPump = page.waitForResponse((r) => r.url().endsWith('/api/pump/pump'));
  await page.keyboard.down(' ');
  await page.keyboard.down(' '); // auto-repeat while held
  await page.keyboard.down(' ');
  await page.keyboard.up(' ');
  await firstPump;
  await expect(page.getByTestId('cashout-value')).toHaveText('$1.05'); // exactly one pump

  await page.keyboard.press('Space');
  await expect(page.getByTestId('cashout-value')).toHaveText('$1.16');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('round-result')).toHaveText('Won $1.16');
});

test('keyboard users can place a bet from the focused Bet button (WCAG 2.1.1)', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await page.getByTestId('bet-input').fill('1');
  // Enter on the focused Bet button places exactly one bet.
  const started = page.waitForResponse((r) => r.url().endsWith('/api/pump/start'));
  await page.getByTestId('bet-button').focus();
  await page.keyboard.press('Enter');
  await started;
  await expect(page.getByTestId('pump-button')).toBeVisible();
  await expect(page.getByTestId('balance')).toContainText('$9,999.00');
  // During the round the shortcuts apply as before: Space pumps once, Enter cashes out.
  await page.keyboard.press('Space');
  await expect(page.getByTestId('cashout-value')).toHaveText('$1.05');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('round-result')).toHaveText('Won $1.05');
  // Space on the focused Bet button works too, between rounds.
  await page.getByTestId('bet-button').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('pump-button')).toBeVisible();
});

test('a pump whose response is lost is retried with the same key and applied once', async ({
  page,
  oracle,
}) => {
  await openGame(page);
  await oracle.rigNextRound(page, null);
  await placeBet(page, '1');
  const keys: string[] = [];
  let dropNext = true;
  await page.route('**/api/pump/pump', async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (dropNext) {
      dropNext = false;
      await route.fetch(); // the server commits the pump...
      await route.abort('connectionreset'); // ...but the browser never sees the response
      return;
    }
    await route.continue();
  });
  await page.getByTestId('pump-button').click();
  await expect(page.getByTestId('cashout-value')).toHaveText('$1.05');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const current = (await (await page.request.get('/api/pump/current')).json()) as {
    round: { pumpCount: number };
  };
  expect(current.round.pumpCount).toBe(1);
});

test('shows a recoverable error screen when the server is unreachable', async ({ page }) => {
  await page.route('**/api/pump/current', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByText("Can't reach the game server.")).toBeVisible({ timeout: 15_000 });
  await page.unroute('**/api/pump/current');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('bet-button')).toBeVisible();
});

test('history lists finished rounds with links to verify them', async ({ page, oracle }) => {
  await openGame(page);
  await oracle.rigNextRound(page, 1);
  await placeBet(page, '1');
  await pump(page);
  await expect(page.getByTestId('round-result')).toHaveText('Lost $1.00');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'History' })
    .click();
  const list = page.getByTestId('history-list');
  await expect(list).toContainText('Popped on 1');
  await list.getByRole('link', { name: 'Verify' }).first().click();
  await expect(page.getByTestId('verify-verdict')).toContainText('Verified');
});
