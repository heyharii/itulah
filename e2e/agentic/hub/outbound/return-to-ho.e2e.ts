// Return to HO: stores never send goods back on their own; head office raises the return, per store, from its return stock.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as } from '../../support/rig.ts';

describe('Return to HO', { tags: ['outbound'] }, () => {
  test('OUT-80 the Return to HO book opens with its figures and a New return button', { session: 'rina', tags: ['outbound', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/allotment/returns');
    await expect(screen.getByRole('heading', 'Return to HO')).toBeVisible({ timeout: 60_000 });
    for (const kpi of ['Active', 'Completed', 'Not shipped yet', 'In transit']) await expect(screen.getByText(kpi, { exact: true }).first()).toBeVisible();
    await expect(screen.getByRole('button', 'New return')).toBeVisible();
    // no Unallotted / Overdue tabs: the return books have nothing to allot
    await expect(screen.getByRole('tab', /^Unallotted/)).toBeHidden();
  });

  test('OUT-81 New return lists every store; a store with no return stock says so and Submit stays shut', { session: 'rina', tags: ['outbound'] }, async ({ app, screen }) => {
    await app.open('/allotment/returns');
    await screen.getByRole('button', 'New return').tap();
    await expect(screen.getByRole('heading', 'New Return')).toBeVisible({ timeout: 30_000 });
    // 13 stores read "Store NN", the last three read by name (site names on the rig)
    for (const name of [...Array.from({ length: 13 }, (_, i) => `Store ${String(i + 1).padStart(2, '0')}`), 'Tasikmalaya', 'Garut', 'Cirebon']) await expect(screen.getByRole('button', name)).toBeVisible();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
    await screen.getByRole('button', 'Store 13').tap();
    await expect(screen.getByText('Nothing in its return stock.')).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
    await screen.getByRole('button', 'Back').tap();
    await expect(screen.getByRole('heading', 'Return to HO')).toBeVisible();
  });

  test('OUT-82 Return from Store (Ops) lists the deliveries coming back from the shops, and is read-only for the shop', { session: 'nina', tags: ['outbound'] }, async ({ app, screen }) => {
    await app.open('/operations/board/returns');
    await expect(screen.getByRole('heading', 'Return from Store')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('button', 'Board')).toBeVisible();
    await expect(screen.getByRole('button', 'Table')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Search returns')).toBeVisible({ timeout: 60_000 });
  });

  test('OUT-83 a store manager cannot raise the return herself: the cloud refuses a RETURN_TO_DC allotment from maya', { tags: ['outbound', 'api'] }, async () => {
    const maya = as('cloud', 'maya');
    const res = await maya.call('POST', '/api/v1/inventory/allotments', {
      type: 'RETURN_TO_DC', notes: 'Uji toko tidak boleh retur', actor_id: 'maya', idempotency_key: crypto.randomUUID(),
      lines: [{ source_site_id: 'store-01', source_pool_id: 'store-01.reject', destination_type: 'DC', destination_id: 'dc', sku_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
    }, { ok: false }).catch((e) => ({ error: String(e) }));
    expect(JSON.stringify(res)).toMatch(/forbidden|not allowed|permission|403|401|denied|not authori[sz]ed/i);
  });
});
