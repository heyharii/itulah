// Sign in without typing into the form: a fill of a credential would withhold
// screenshots (and `vision`) for every test restoring the session. The cloud's
// login sets the HttpOnly session cookie + CSRF cookie through the Vite proxy,
// exactly as the form does. The form itself is covered by hub/sign-in.e2e.ts.
import type { Person } from './base.ts';
import { PASSWORD } from './base.ts';

export async function signInByApi(
  browser: { evaluate: (fn: (arg: [string, string]) => Promise<number>, arg: [string, string]) => Promise<number> },
  who: Person,
) {
  const status = await browser.evaluate(async ([username, password]) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    return res.status;
  }, [who, PASSWORD]);
  if (status !== 200) throw new Error(`${who} sign-in answered ${status}`);
}
