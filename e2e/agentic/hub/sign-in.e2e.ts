// The sign-in form itself, typed the way a person does. The password field's
// accessible name is "Password Show password" (the reveal button is read into
// it), so it is found by role and a name that starts with Password.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';

test('rina signs in with the form', { tags: ['smoke'] }, async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Username').fill('rina');
  await screen.getByRole('textbox', { name: /^Password/ }).fill(PASSWORD);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden({ timeout: 30_000 });
});

test('a wrong password is refused and the form stays', { tags: ['smoke'] }, async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Username').fill('rina');
  await screen.getByRole('textbox', { name: /^Password/ }).fill('not-the-password');
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible({ timeout: 15_000 });
});
