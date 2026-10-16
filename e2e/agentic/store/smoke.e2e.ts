import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('maya opens the stock screen from a saved session', { session: 'maya-store', tags: ['pos', 'smoke'] }, async ({ app, screen, browser }) => {
  await app.open('/stock');
  await expect(browser).toHaveURL(/\/stock/);
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden();
});
