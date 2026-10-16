// Receive: a delivery from the DC is counted blind at the shop (the shop sees no "expected" figure while it
// counts) by SKU code. Each test makes its own delivery end to end (pos.sendDelivery: allot → pick → pack →
// ship → depart) from the units on the DC racks — a few pieces each, documented in use-cases/pos.md.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';
import { as, waitFor } from '../support/rig.ts';

const inbound = async (id: string) => ((await as('store', 'maya').get('/api/v1/store/inbound?status=ALL')).deliveries as any[]).find((d) => d.delivery_id === id) ?? {};

test('STORE-70 a delivery in transit is counted blind and matches: Received, nothing missing, the pieces land in the stockroom', { session: 'maya-store', tags: ['pos', 'smoke'] }, async ({ app, screen }) => {
  const [a, b] = await pos.dcSkus(2);
  const sent = await pos.sendDelivery({ [a]: 1, [b]: 1 });
  await app.open('/receive');
  const card = screen.getByText(sent.shipment, { exact: false }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('button', /^In transit · /)).toBeVisible();
  await card.tap();
  const sheet = screen.getByRole('dialog', sent.shipment);
  await expect(sheet.getByText('Nothing counted yet.', { exact: true })).toBeVisible();
  // Blind: the sheet never says how many pieces were sent.
  await expect(sheet.getByText(/expected|sent 2|2 pcs sent/i)).toBeHidden();
  await expect(sheet.getByRole('button', 'Submit count')).toBeDisabled();
  const scan = sheet.getByPlaceholder('Scan a barcode or type a SKU');
  await scan.fill(a);
  await scan.press('Enter');
  await scan.fill(b);
  await scan.press('Enter');
  await expect(sheet.getByText('2 pcs', { exact: true }).first()).toBeVisible();
  await sheet.getByRole('button', 'Submit count').tap();
  await expect(sheet.getByText('Complete', { exact: true, visible: true }).first()).toBeVisible({ timeout: 30_000 });
  const done = await waitFor('delivery received', async () => {
    const d = await inbound(sent.deliveryId);
    return d.status === 'RECEIVED' ? d : null;
  }, 30_000, 1_000);
  expect(done.result.received_units).toBe(2);
  expect(done.result.missing_units).toBe(0);
});

test('STORE-71 a short and an extra piece: the count guards (empty, edit, remove), then Submit — the shortfall is named', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const cat = await pos.catalogue();
  const [named, never, extra] = await pos.dcSkus(3);
  const sent = await pos.sendDelivery({ [named]: 1, [never]: 1 });
  const nameOf = (sku: string) => (cat[sku]?.name ?? sku) as string;
  await app.open('/receive');
  await screen.getByText(sent.shipment, { exact: false }).first().tap();
  const sheet = screen.getByRole('dialog', sent.shipment);
  const scan = sheet.getByPlaceholder('Scan a barcode or type a SKU');
  // Scan one article twice, fix the quantity by hand, remove another one again.
  await scan.fill(extra);
  await scan.press('Enter');
  await scan.fill(`${named} x2`);
  await scan.press('Enter');
  await expect(sheet.getByText('3 pcs', { exact: true }).first()).toBeVisible();
  await sheet.getByRole('textbox', /^Quantity for /).nth(1).fill('1');
  await expect(sheet.getByText('2 pcs', { exact: true }).first()).toBeVisible();
  await sheet.getByRole('button', /^Remove /).first().tap();
  await expect(sheet.getByText('1 pc', { exact: true }).first()).toBeVisible();
  // An extra the delivery never named, and `never` not found.
  await scan.fill(extra);
  await scan.press('Enter');
  await sheet.getByRole('button', 'Submit count').tap();
  await expect(sheet.getByText('1 missing', { exact: true, visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText('Tags missing', { exact: false })).toBeVisible();
  const d = await waitFor('delivery received', async () => {
    const x = await inbound(sent.deliveryId);
    return x.status === 'RECEIVED' ? x : null;
  }, 30_000, 1_000);
  expect(d.result.missing_units).toBe(1);
  // The list now tells the same story: Received tab, with the shortfall in red.
  await app.open('/receive');
  await screen.getByRole('button', /^Received · /).tap();
  await expect(screen.getByText('1 missing', { exact: false }).first()).toBeVisible();
});
