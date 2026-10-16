// One session per person the hub suites act as. Tests declare `{ session: 'rina' }`.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { signInByApi } from '../support/session.ts';

for (const who of ['rina', 'nina', 'yusuf', 'admin'] as const) {
  test.setup(`${who} signs in to Central`, { sessions: [who] }, async ({ app, screen, browser, session }) => {
    await app.open('/');
    await signInByApi(browser, who);
    await app.open('/');
    await expect(screen.getByRole('button', 'Sign in')).toBeHidden({ timeout: 30_000 });
    await session.save(who);
  });
}
