// The foundation works: a restored session opens a screen of each domain.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('rina opens the PO list from a saved session', { session: 'rina', tags: ['smoke'] }, async ({ app, screen, browser }) => {
  await app.open('/procurement/orders');
  await expect(browser).toHaveURL(/\/procurement\/orders/);
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden();
});
