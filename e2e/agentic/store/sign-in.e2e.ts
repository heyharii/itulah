// STORE-01..03: the shop back office's own door (cookie session from the store node).
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';

test('STORE-01 maya signs in with the form and lands on the catalogue', { tags: ['pos', 'smoke'] }, async ({ app, screen, browser }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'Sign in')).toBeVisible();
  await screen.getByLabel('Username').fill('maya');
  await screen.getByRole('textbox', { name: /^Password/ }).fill(PASSWORD);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden({ timeout: 30_000 });
  await expect(browser).toHaveURL(/\/catalogue/);
});

test('STORE-02 a wrong password is refused with the node\'s words; the form stays', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Username').fill('maya');
  await screen.getByRole('textbox', { name: /^Password/ }).fill('bukan-sandinya');
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByText(/invalid username or password/)).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible();
});

test('STORE-03 a deep link without a session shows the sign-in door, not the screen', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/money/expenses');
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible();
  await expect(screen.getByText('New expense', { exact: true })).toBeHidden();
});
