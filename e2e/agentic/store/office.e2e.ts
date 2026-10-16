// The office side of the shop app that talks to head office through the node: Discuss (chat), GA requests.
// Their rules belong to the GA / Discuss suites; here the shop manager's own round trip is proven.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, tag, waitFor } from '../support/rig.ts';

test('STORE-110 Discuss: maya writes in the Store 01 group and head office sees the message', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const text = `Cek stok sepatu ${tag('M')}`;
  await app.open('/news');
  await screen.getByText('Store 01', { exact: true }).first().tap();
  await screen.getByRole('textbox', 'Message').fill(text);
  await screen.getByRole('button', 'Send').tap();
  await expect(screen.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const rina = as('cloud', 'rina');
  await waitFor('the message at head office', async () => {
    const convs = await rina.get('/api/v1/chat/conversations');
    return (convs as any[]).find((c) => c.preview === text || (c.preview ?? '').includes(text));
  }, 30_000, 1_000);
});

test('STORE-111 GA › Supplies: a supply request is created and listed', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const item = `Kertas struk ${tag('S')}`;
  await app.open('/ga/supplies');
  await screen.getByRole('button', 'New supply request').first().tap();
  const sheet = screen.getByRole('dialog', 'New supply request');
  await sheet.getByRole('radio', 'Stationery & printing').tap();
  await sheet.getByPlaceholder('A4 paper for the office printer').fill(item);
  await sheet.getByPlaceholder('2 rim').fill('10 roll');
  await sheet.getByRole('button', 'Create supply request').tap();
  await expect(screen.getByText(item, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

test('STORE-112 GA › Repairs: with no supplier on record and no asset registered, a repair cannot be sent — the sheet says so and keeps the form', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const line = `AC dekat kasir tidak dingin ${tag('R')}`;
  await app.open('/ga/repairs');
  await screen.getByRole('button', 'New repair request').first().tap();
  const sheet = screen.getByRole('dialog', 'New repair request');
  await sheet.getByRole('radio', 'AC & refrigeration').tap();
  await sheet.getByPlaceholder('AC by the till is not cooling').fill(line);
  await expect(sheet.getByText('No supplier on record for this shop. Pick an asset to leave a note, or call GA.', { exact: true })).toBeVisible();
  await sheet.getByRole('button', 'Create repair request').tap();
  // Nothing was created: the sheet is still open with the line in it, and the list shows no such request.
  await expect(sheet.getByRole('textbox', /^In one line/)).toHaveValue(line);
  await sheet.getByRole('button', 'Cancel').tap();
  await expect(screen.getByText(line, { exact: true })).toBeHidden();
});
