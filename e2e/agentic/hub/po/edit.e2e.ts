// PO › edit: normal edit, edit after a receipt, edit refused.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, poDetail, waitPo } from '../../support/rig.ts';
import { countPo, newPo, openSheet, review, waitReceived } from '../../support/po.ts';

describe('PO edit', () => {
  test('PO-E01 Edit reopens the order as "Edit <PO>" with the supplier read-only', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Edit').tap();
    await expect(screen.getByText(`Edit ${po}`)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('textbox', 'Supplier')).toHaveValue(/Garmen Nusantara/);
    await expect(screen.getByRole('textbox', 'Supplier')).toBeDisabled().catch(async () => expect(screen.getByRole('textbox', 'Supplier')).toHaveAttribute('readonly'));
  });

  test('PO-E02 editing the notes and submitting saves them and says "<PO> updated"', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { t, po } = await newPo(8);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Edit').tap();
    await expect(screen.getByText(`Edit ${po}`)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox', 'Notes').fill(`diubah ${t}`);
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Review the changes')).toBeVisible();
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(`${po} updated`)).toBeVisible({ timeout: 30_000 });
    expect((await poDetail(po)).notes).toContain(`diubah ${t}`);
  });

  test('PO-E03 after goods are received only the delivery date and notes can change', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Edit').tap();
    await expect(screen.getByText('Goods have been received on this order. Only the delivery date and the notes can change.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('combobox', 'Payment method')).toBeDisabled();
    await expect(screen.getByRole('textbox', 'Notes')).toBeEnabled();
  });

  test('PO-E04 a fully received order cannot be edited (no Edit; edit URL refused with a toast)', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 8);
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED' });
    const d = await poDetail(po);
    await app.open(`/procurement/orders?edit-order=${d.purchase_order_id}`);
    await expect(screen.getByText(/can no longer be edited|fully received/i)).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(`Edit ${po}`)).toBeHidden();
  });

  test('PO-E05 the server refuses to edit a cancelled order', { tags: ['po'] }, async () => {
    const { po } = await newPo(4);
    const d = await poDetail(po);
    await as('cloud', 'rina').post(`/api/v1/purchase-orders/${d.purchase_order_id}/cancel`, { reason: 'x' });
    const res = await as('cloud', 'rina').call('PUT', `/api/v1/purchase-orders/${d.purchase_order_id}`, { notes: 'x' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/cancelled|cannot be edited|invalid|missing/i);
  });
});
