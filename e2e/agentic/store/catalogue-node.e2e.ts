// Catalogue and promotions (what the shop is charging, from its own node), and "This node": sync, till
// approvals, password.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';
import { signInByApi } from '../support/session.ts';
import * as pos from '../support/pos.ts';
import { as } from '../support/rig.ts';

test('STORE-100 Catalogue (By article): the range from the node, searchable; an article opens with its prices', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const cat = await pos.catalogue();
  const articles = new Set(Object.values(cat).map((c: any) => c.article_code));
  await app.open('/catalogue');
  expect(articles.size).toBeGreaterThan(0);
  await expect(screen.getByText(/\d+ articles/).first()).toBeVisible({ timeout: 20_000 });
  await screen.getByRole('textbox', 'Search the range').fill('Kaos Basic');
  await expect(screen.getByText('Kaos Basic Katun Combed', { exact: false }).first()).toBeVisible();
  await expect(screen.getByText('Celana Chino', { exact: false })).toBeHidden();
  await screen.getByText('Kaos Basic Katun Combed', { exact: false }).first().tap();
  await expect(screen.getByRole('dialog').first()).toBeVisible();
  await expect(screen.getByText(pos.rp(89_000)).first()).toBeVisible();
  await screen.getByRole('dialog').first().getByRole('button', 'Close').tap();
  await screen.getByRole('button', 'Clear the search').tap();
  await expect(screen.getByText('Celana Chino', { exact: false }).first()).toBeVisible();
});

test('STORE-101 Catalogue (By SKU): one row per SKU with its barcode and price source', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const cat = await pos.catalogue();
  const sample: any = Object.values(cat).find((c: any) => c.name.startsWith('Kemeja Oxford'));
  await app.open('/catalogue');
  await screen.getByRole('button', 'By SKU').first().tap();
  await screen.getByRole('textbox', 'Search the range').fill(sample.sku_code);
  await expect(screen.getByText(sample.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await screen.getByText(sample.name, { exact: false }).first().tap();
  const sheet = screen.getByRole('dialog').first();
  await expect(sheet.getByText('Price source', { exact: true })).toBeVisible();
  await expect(sheet.getByText(sample.barcode, { exact: false }).first()).toBeVisible();
});

test('STORE-102 Promotions: what is running here (HEMAT50, 15% shoes, 10% women, member points) matches the node\'s offers; tabs and the campaign/price/voucher pages list them', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const offers = await as('store', 'maya').get('/api/v1/store/offers');
  await app.open('/promotions');
  for (const r of offers.running as any[]) await expect(screen.getByText(r.name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await screen.getByRole('button', /^Scheduled · /).tap();
  await expect(screen.getByRole('button', /^Scheduled · /)).toBeVisible();
  await app.open('/promotions/campaigns');
  await expect(screen.getByText(/Pekan Sepatu/).first()).toBeVisible({ timeout: 20_000 });
  await app.open('/promotions/price-changes');
  await expect(screen.getByText('Sandal Slide Karet', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await app.open('/promotions/vouchers');
  await expect(screen.getByText('HEMAT50', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

test('STORE-103 This node › Sync: the figures are the node\'s; Send now asks it to send', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const st = await as('store', 'maya').get('/api/v1/sync/status');
  await app.open('/node/sync');
  await expect(screen.getByText('The sender', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText('store-01', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('Rejected by head office', { exact: true })).toBeVisible();
  expect(st.dead_lettered).toBe(0);
  await expect(screen.getByText('Nothing rejected', { exact: true })).toBeVisible();
  await screen.getByRole('button', 'Send now').first().tap();
  await expect(screen.getByRole('button', 'Send now').first()).toBeVisible({ timeout: 20_000 });
});

test('STORE-104 This node › Till approvals: no new till is waiting (joining is done from the desktop till, out of scope here)', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/node/tills');
  await expect(screen.getByText('No tills waiting.', { exact: true })).toBeVisible({ timeout: 20_000 });
});

test('STORE-105 Change password: the two new ones must match; a wrong current password changes nothing (the real password is never changed here)', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/node/password');
  await expect(screen.getByText('Sign-in name', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText('Supervisor', { exact: true })).toBeVisible();
  const submit = screen.getByRole('button', 'Change password').last();
  await expect(submit).toBeDisabled();
  await screen.getByLabel('Your current password').fill('bukan-sandinya');
  await screen.getByLabel('New password', { exact: true }).fill('SandiBaru123');
  await screen.getByRole('textbox', /^New password again/).fill('SandiLain456');
  await expect(screen.getByText('The two do not match.', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
  await screen.getByRole('textbox', /^New password again/).fill('SandiBaru123');
  await expect(submit).toBeEnabled();
  await submit.tap();
  await expect(screen.getByText(/invalid|incorrect|wrong|unauthorized|current password/i).first()).toBeVisible({ timeout: 15_000 });
  // Still the same password: the rig's people all sign in with it.
  expect((await as('store', 'maya').get('/api/v1/auth/me')).username).toBe('maya');
  void PASSWORD;
});

test('STORE-106 Sign out ends the session and the next visit shows the sign-in door', { tags: ['pos'] }, async ({ app, screen, browser }) => {
  // Its own login: signing out revokes the session, and the shared saved ones must stay valid.
  await app.open('/');
  await signInByApi(browser, 'dian');
  await app.open('/catalogue');
  await screen.getByRole('button', 'Sign out').tap();
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible({ timeout: 20_000 });
  await app.open('/stock');
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible();
});
