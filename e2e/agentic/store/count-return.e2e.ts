// What head office asks of the shop: a stock count (the handheld sweeps, the shop submits) and a return to
// the DC (a shop never starts a return: HO raises it, the shop taps Pack and send).
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';
import { as, waitFor } from '../support/rig.ts';

test('STORE-80 Count: a count head office opened shows under To count, empty until the handheld sweeps; Submit asks first, then it moves to Done', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen, browser }) => {
  const asked = await pos.askCount('store-01.warehouse');
  await app.open('/stock/count');
  await expect(screen.getByText(asked.reason, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('button', /^To count · /)).toBeVisible();
  await screen.getByText(asked.reason, { exact: false }).first().tap();
  const sheet = screen.getByRole('dialog', 'Stockroom');
  await expect(sheet.getByText('Nothing counted yet. Sweep this pool with the handheld.', { exact: true })).toBeVisible();
  // Submitting asks first; dismissing keeps it open.
  const dismiss = await browser.onDialog('dismiss');
  await sheet.getByRole('button', 'Submit count').tap();
  await dismiss();
  expect(((await as('store', 'maya').get('/api/v1/store/counts')).items as any[]).find((c) => c.count_id === asked.id).status).toBe('ACTIVE');
  const accept = await browser.onDialog('accept');
  await sheet.getByRole('button', 'Submit count').tap();
  await accept();
  await waitFor('count submitted', async () => {
    const c = ((await as('store', 'maya').get('/api/v1/store/counts')).items as any[]).find((x) => x.count_id === asked.id);
    return c.status !== 'ACTIVE' ? c : null;
  }, 30_000, 1_000);
  await expect(sheet.getByRole('button', 'Submit count')).toBeHidden();
  await sheet.getByRole('button', 'Close').tap();
  await screen.getByRole('button', /^Done · /).tap();
  await expect(screen.getByText(asked.reason, { exact: false }).first()).toBeVisible();
});

test('STORE-81 Return to HO: the request head office raised is listed; Pack and send asks first, then the piece leaves the floor on a trip to the DC', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen, browser }) => {
  const unit = await pos.pickUnit('shoe');
  const onFloor = async () => (await pos.floorUnits()).filter((u) => u.sku === unit.sku).length;
  const before = await onFloor();
  const ask = await pos.askReturn(unit.sku);
  await app.open('/stock/returns');
  await expect(screen.getByText(ask.number, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await screen.getByText(ask.number, { exact: false }).first().tap();
  const sheet = screen.getByRole('dialog', ask.number);
  await expect(sheet.getByText('To send', { exact: true })).toBeVisible();
  await expect(sheet.getByText(unit.name, { exact: false }).first()).toBeVisible();
  const accept = await browser.onDialog('accept');
  await sheet.getByRole('button', 'Pack and send').tap();
  await accept();
  await expect(screen.getByText(/pcs on the way to HO$/)).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText(ask.number, { exact: false })).toHaveCount(0);
  // One piece of that SKU is no longer on the floor.
  expect(await onFloor()).toBe(before - 1);
  pos.release(unit.epc);
});

test('STORE-82 nothing to send, nothing to count: the empty states say so', { session: 'dian-store', tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/stock/returns');
  await expect(screen.getByText(/^Nothing to send\.$|pcs to send/)).toBeVisible({ timeout: 20_000 });
  await app.open('/stock/count');
  await expect(screen.getByText(/Nothing to count\.|No count has been sent yet\./).first()).toBeVisible({ timeout: 20_000 });
});
