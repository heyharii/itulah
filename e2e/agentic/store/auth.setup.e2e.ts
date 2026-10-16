// Sessions `maya-store` (store manager / supervisor) and `dian-store` (cashier) for the store app.
// The shop node's login sets the same HttpOnly session + CSRF cookies as the cloud's, through the
// Vite proxy; signing in by API keeps screenshots available (see support/session.ts). The form itself
// is covered by store/sign-in.e2e.ts.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { signInByApi } from '../support/session.ts';

for (const [who, name] of [['maya', 'maya-store'], ['dian', 'dian-store']] as const) {
  test.setup(`${who} signs in to the store app`, { sessions: [name] }, async ({ app, screen, browser, session }) => {
    await app.open('/');
    await signInByApi(browser, who);
    await app.open('/');
    await expect(screen.getByRole('button', 'Sign in')).toBeHidden({ timeout: 30_000 });
    await session.save(name);
  });
}
