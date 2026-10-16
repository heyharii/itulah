// STORE-10..: every screen of the shop back office opens for the manager and shows its own words.
// (People and GA are head-office data relayed through the node; they are opened here, their flows
// belong to the HR / GA suites.)
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

const routes: [string, string, string][] = [
  ['STORE-10', '/catalogue', 'By article'],
  ['STORE-11', '/promotions', 'Promotions'],
  ['STORE-12', '/promotions/campaigns', 'Campaigns'],
  ['STORE-13', '/promotions/price-changes', 'Price changes'],
  ['STORE-14', '/promotions/vouchers', 'Vouchers'],
  ['STORE-15', '/stock', 'Move stock'],
  ['STORE-16', '/receive', 'Receive'],
  ['STORE-17', '/stock/count', 'Count'],
  ['STORE-18', '/stock/returns', 'Return to HO'],
  ['STORE-19', '/stock/movements', 'Stock ledger'],
  ['STORE-20', '/money/sales', 'Sales'],
  ['STORE-21', '/money/reconciliation', 'Coming soon'],
  ['STORE-22', '/money/expenses', 'New expense'],
  ['STORE-23', '/money/cash-count', 'Past counts'],
  ['STORE-24', '/reports', 'How it was paid'],
  ['STORE-25', '/news', 'New chat'],
  ['STORE-26', '/node/sync', 'Send now'],
  ['STORE-27', '/node/tills', 'No tills waiting.'],
  ['STORE-28', '/node/password', 'Sign-in name'],
  ['STORE-29', '/hr/overview', 'Headcount'],
  ['STORE-30', '/hr/roster', 'Roster'],
  ['STORE-31', '/hr/leave', 'New leave request'],
  ['STORE-32', '/hr/directory', 'Employees'],
  ['STORE-33', '/hr/overtime', 'New overtime order'],
  ['STORE-34', '/hr/recruitment', 'Request a new employee'],
  ['STORE-35', '/hr/lifecycle', 'Onboarding & exit'],
  ['STORE-36', '/hr/attendance', 'New attendance fix'],
  ['STORE-37', '/hr/payroll', 'Close attendance'],
  ['STORE-38', '/hr/expenses', 'New claim'],
  ['STORE-39', '/hr/benefits', 'Uniforms'],
  ['STORE-40', '/hr/changes', 'Propose a change'],
  ['STORE-41', '/ga', 'Assets here'],
  ['STORE-42', '/ga/assets', 'Assets'],
  ['STORE-43', '/ga/contracts', 'Contracts'],
  ['STORE-44', '/ga/servicing', 'Servicing'],
  ['STORE-45', '/ga/repairs', 'New repair request'],
  ['STORE-46', '/ga/supplies', 'New supply request'],
];

for (const [id, path, word] of routes) {
  test(`${id} ${path} opens and shows "${word}"`, { session: 'maya-store', tags: ['pos'] }, async ({ app, screen, browser }) => {
    await app.open(path);
    await expect(browser).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
    await expect(screen.getByRole('button', 'Sign in')).toBeHidden();
    await expect(screen.getByText(word, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });
}

test('STORE-47 an unknown address falls back to a screen of the app, never a blank page', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/stock/does-not-exist');
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden();
  await expect(screen.getByText(/Stock|Catalogue|Not found|Page/i).first()).toBeVisible();
});
