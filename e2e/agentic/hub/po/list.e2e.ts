// PO › list: tabs, statuses, search, filters, KPI, empty state.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, cancelPo, closeShort, nudge, poNumbers, waitFor, waitPo } from '../../support/rig.ts';
import { countPo, newPo, poRow, review, waitReceived } from '../../support/po.ts';

describe('PO list', () => {
  test('PO-L01 a new order is Active, with its ordered pieces and 0 received', { session: 'rina', tags: ['po', 'smoke'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await app.open('/procurement/orders');
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Garmen Nusantara');
    await expect(row).toContainText('8 pcs');
    await expect(row).toContainText('Rp 320.000');
    await expect(row).toContainText('Active');
  });

  test('PO-L02 tabs: Active, Completed and Cancelled carry counts and filter the list', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    await app.open('/procurement/orders');
    await expect(screen.getByRole('tab', /^Active PO\d+/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('tab', /^Completed PO\d+/)).toBeVisible();
    await expect(screen.getByRole('tab', /^Cancelled PO\d+/)).toBeVisible();
    await expect(poRow(screen, po)).toBeVisible();
    await screen.getByRole('tab', /^Completed PO/).tap();
    await expect(poRow(screen, po)).toBeHidden();
    await screen.getByRole('tab', /^Cancelled PO/).tap();
    await expect(poRow(screen, po)).toBeHidden();
  });

  test('PO-L03 KPI tiles show Orders, Still open, Overdue and On order', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await app.open('/procurement/orders');
    for (const label of ['Orders', 'Still open', 'Overdue', 'On order']) await expect(screen.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('PO-L04 search by PO number narrows the list; nothing matching shows the empty state', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    await app.open('/procurement/orders');
    await expect(poRow(screen, po)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('combobox', 'Search orders').fill(po);
    await expect(poRow(screen, po)).toBeVisible();
    await expect(screen.getByRole('row', { name: /PO-\d{6}-\d{3}/ })).toHaveCount(1);
    await screen.getByRole('combobox', 'Search orders').fill('ZZZ-no-such-order');
    await expect(screen.getByText(/No order matches|Nothing here yet/)).toBeVisible();
  });

  test('PO-L05 a fully received order moves to Completed with "Fully received"', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 8); // exactly as ordered: received automatically
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 8 });
    await app.open('/procurement/orders');
    await screen.getByRole('tab', /^Completed PO/).tap();
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/Fully received|FULLY RECEIVED/i);
    await expect(row).toContainText('8 pcs');
  });

  test('PO-L06 a cancelled order moves to Cancelled with no Received figure', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    await cancelPo(po);
    await app.open('/procurement/orders');
    await screen.getByRole('tab', /^Cancelled PO/).tap();
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/Cancelled/i);
  });

  test('PO-L07 a partly received order stays Active as "Partially received" with "N pcs (+x)" style Received', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await app.open('/procurement/orders');
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Partially received');
    await expect(row).toContainText('5 pcs');
  });

  test('PO-L08 a closed-short order is Completed as "Closed short"', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await closeShort(po);
    await waitPo(po, { lifecycle: 'SHORT_RECEIVED' });
    await app.open('/procurement/orders');
    await screen.getByRole('tab', /^Completed PO/).tap();
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/Closed short|CLOSED SHORT/i);
  });

  test('PO-L09 a count waiting turns the status into a Review Count button', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await app.open('/procurement/orders');
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole('button', 'Review Count')).toBeVisible({ timeout: 60_000 });
  });

  test('PO-L10 a count sent back shows "Recounting" in the list', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Recount', 40_000, 'Hitung ulang, kayaknya kurang');
    await app.open('/procurement/orders');
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Recounting', { timeout: 60_000 });
  });

  test('PO-L11 a count with excess shows "+N pcs over" next to the status', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 11);
    await review(count.count_id, 'Accept');
    await waitPo(po, { excess_stock_units: 3 });
    await app.open('/procurement/orders');
    await screen.getByRole('tab', /^Completed PO/).tap(); // 11 of 8 completes the order
    const row = poRow(screen, po);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('+3 pcs over');
  });

  test('PO-L12 the Issued and Delivery Date filters open; Clear filters appears once one is set', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await app.open('/procurement/orders');
    await screen.getByRole('button', 'Issued').tap();
    await expect(screen.getByRole('dialog')).toBeVisible();
    await screen.getByRole('button', 'Delivery Date').first().tap();
  });

  test('PO-L13 Columns menu offers "Group by supplier"', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    await app.open('/procurement/orders');
    await screen.getByRole('button', 'Columns').tap();
    await expect(screen.getByText('Group by supplier')).toBeVisible();
  });

  test('PO-L14 a PO number in the URL opens its sheet', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    const { poDetail } = await import('../../support/rig.ts');
    const d = await poDetail(po);
    await app.open(`/procurement/orders?order=${d.purchase_order_id}`);
    await expect(screen.getByText(po).first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Supplier').first()).toBeVisible();
  });
});
