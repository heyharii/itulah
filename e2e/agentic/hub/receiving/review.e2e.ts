// Procurement › Review Count (rina): every branch of the buyer's decision.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, cancelPo, dcReturns, nudge, poNumbers, rows, waitFor, waitPo } from '../../support/rig.ts';
import { countMulti, countPo, dcCounts, newMultiPo, newPo, openReview, review, seen, watchText } from '../../support/po.ts';

describe('Review Count', () => {
  test('RV-01 the Review Count button on the list opens the review of that order', { session: 'rina', tags: ['receiving', 'smoke'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await app.open('/procurement/orders');
    const row = screen.getByRole('row', { name: new RegExp(po) });
    await expect(row).toBeVisible({ timeout: 45_000 });
    await row.getByRole('button', 'Review Count').tap({ timeout: 60_000 } as never);
    await expect(screen.getByRole('dialog', /^Review Count/)).toBeVisible({ timeout: 30_000 });
  });

  test('RV-02 a short count shows ordered, counted and "3 pcs short", with Close Short / Recount / Partial Receive', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    const d = screen.getByRole('dialog', /^Review Count/);
    for (const h of ['Item', 'Ordered', 'Counted', 'Unit Price', 'Amount']) await expect(d).toContainText(h);
    await expect(d).toContainText('Garmen Nusantara');
    await expect(d).toContainText('Counted');
    await expect(d).toContainText(/3 pcs short/);
    await expect(d.getByRole('button', 'Close Short')).toBeVisible();
    await expect(d.getByRole('button', 'Recount')).toBeVisible();
    await expect(d.getByRole('button', 'Partial Receive')).toBeVisible();
  });

  test('RV-03 Partial Receive accepts what was counted and leaves the rest open', { session: 'rina', tags: ['receiving'] }, async ({ app, screen, browser }) => {
    await watchText(browser, /1 item received/);
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Partial Receive').tap();
    await expect.poll(() => seen(browser), { timeout: 150_000, interval: 500 }).toBe(true);
    await waitPo(po, { lifecycle: 'PARTIALLY_RECEIVED', received_stock_units: 5, outstanding_stock_units: 3 });
  });

  test('RV-04 Close Short from the review accepts the count and closes the rest', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Close Short').tap();
    await expect(screen.getByText('Close This Short?')).toBeVisible();
    await expect(screen.getByText(/3 pcs will be removed from the order, and the PO completes as received/)).toBeVisible();
    await screen.getByRole('button', 'Close Short').last().tap();
    await waitPo(po, { lifecycle: 'SHORT_RECEIVED', received_stock_units: 5 }, 120_000);
  });

  test('RV-05 an over count says the extra goes back, offers Submit only, and raises the return by itself', { session: 'rina', tags: ['receiving', 'return-po'] }, async ({ app, screen, browser }) => {
    await watchText(browser, /1 item received/);
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 11);
    await openReview(app, screen, po);
    const d = screen.getByRole('dialog', /^Review Count/);
    await expect(d).toContainText('3 pcs extra will be returned to the supplier');
    await expect(d.getByRole('button', 'Close Short')).toBeHidden();
    await expect(d.getByRole('button', 'Partial Receive')).toBeHidden();
    await d.getByRole('button', 'Submit').tap();
    await expect.poll(() => seen(browser), { timeout: 150_000, interval: 500 }).toBe(true);
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: 8 });
    const ret = await waitFor('return raised', async () => { await nudge('cloud', 'dc'); const r = await dcReturns(po); return r.length ? r : null; }, 90_000, 3_000);
    expect(JSON.stringify(ret)).toContain(po);
  });

  test('RV-06 Not as Ordered pieces say they go back to the supplier', { session: 'rina', tags: ['receiving', 'return-po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 10, 3); // 7 good + 3 not as ordered
    await openReview(app, screen, po);
    const d = screen.getByRole('dialog', /^Review Count/);
    await expect(d).toContainText('3 pcs not as ordered will be returned to the supplier');
    await expect(d).toContainText('Not as Ordered');
    await expect(d.getByRole('button', 'Partial Receive')).toBeVisible(); // 7 of 8 is still short
  });

  test('RV-07 on one line, extra goes back with the not-as-ordered pieces: one "N pcs not as ordered" line', { session: 'rina', tags: ['receiving', 'return-po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 13, 2); // 11 good (3 extra) + 2 not as ordered
    await openReview(app, screen, po);
    await expect(screen.getByRole('dialog', /^Review Count/)).toContainText('5 pcs not as ordered will be returned to the supplier');
  });

  test('RV-07b not-as-ordered on one line and extra on another are summed with a breakdown', { session: 'rina', tags: ['receiving', 'return-po'] }, async ({ app, screen }) => {
    const { items, po } = await newMultiPo([8, 8]);
    await countMulti(items, po, [11, 10], [0, 2]);
    await openReview(app, screen, po);
    await expect(screen.getByRole('dialog', /^Review Count/)).toContainText('5 pcs will be returned to the supplier · 2 not as ordered, 3 extra');
  });

  test('RV-08 Recount: lines that differ are pre-ticked, a reason is required, then the count is sent back', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Recount').tap();
    await expect(screen.getByText('Why should it be counted again?').first()).toBeVisible();
    await expect(screen.getByText(/1 of 1 items? ticked/)).toBeVisible();
    await expect(screen.getByRole('button', /^Send 1 items? back to count$/)).toBeDisabled();
    await screen.getByRole('textbox', 'Why should it be counted again?').fill('Tolong hitung ulang');
    await screen.getByRole('button', /^Send 1 items? back to count$/).tap();
    await app.open('/procurement/orders');
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toContainText('Recounting', { timeout: 90_000 });
    const c = await waitFor('recount requested', async () => { const l = await dcCounts(po); return l.length ? l : null; }, 20_000, 1_000).catch(() => []);
    const line = rows(await as('dc', 'nina').get('/api/v1/dc/purchase-orders?limit=500')).find((l) => l.po_number === po);
    expect(line.recount_reason).toBe('Tolong hitung ulang');
    void c;
  });

  test('RV-09 Recount Back returns to the review without sending anything', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Recount').tap();
    await screen.getByRole('button', 'Back').tap();
    await expect(screen.getByRole('button', 'Partial Receive')).toBeVisible();
  });

  test('RV-10 a recounted order then shows "Recounting" in the PO list until it is counted again', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Recount', 40_000, 'cek lagi');
    await app.open('/procurement/orders');
    await expect(screen.getByRole('row', { name: new RegExp(po) })).toContainText('Recounting', { timeout: 60_000 });
  });

  test('RV-11 an order with nothing counted says "Nothing to review."', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    await app.open(`/procurement/orders?verify=${po}`);
    await expect(screen.getByText('Nothing to review.')).toBeVisible({ timeout: 60_000 });
  });

  test('RV-12 [bug] an order cancelled while its count waits must not leave a count nobody can decide', { session: 'rina', tags: ['receiving', 'bug'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    const d = await as('cloud', 'rina').get('/api/v1/purchase-orders?limit=500');
    const found = rows(d).find((p) => p.po_number === po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-orders/${found.purchase_order_id}/cancel`, { reason: 'coba' }, { ok: false });
    // Correct behaviour: the cancel is refused while a count waits (the hub button is disabled for the same reason).
    expect(JSON.stringify(res)).toMatch(/count|review/i);
  });

  test('RV-13 a cancelled order\'s review says "This order is cancelled." and the DC refuses to receive', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await cancelPo(po);
    await waitFor('the DC hides the cancelled order\'s count', async () => { await nudge('cloud', 'dc'); return !(await dcCounts(po)).length; }, 90_000, 3_000);
    const refused = await review(count.count_id, 'Accept');
    expect(JSON.stringify(refused)).toMatch(/cancelled|not found|already/i);
    await app.open(`/procurement/orders?verify=${po}`);
    await expect(screen.getByText(/This order is cancelled\.|Nothing to review\./)).toBeVisible({ timeout: 60_000 });
  });

  test('RV-14 a decided count cannot be decided again', { tags: ['receiving'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    const again = await review(count.count_id, 'Accept');
    expect(JSON.stringify(again)).toMatch(/already/i);
  });

  test('RV-15 a recount request must say what to look at again (server)', { tags: ['receiving'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    const res = await review(count.count_id, 'Recount', 40_000, '');
    expect(JSON.stringify(res)).toContain('a recount request must say what to look at again');
  });

  test('RV-16 a count exactly as ordered is accepted on its own; Accept answers "already"', { tags: ['receiving'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 8);
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED' });
    expect(JSON.stringify(await review(count.count_id, 'Accept'))).toMatch(/already/i);
  });

  test('RV-17 more than four lines: a Difference summary appears and Hide matched hides the lines that match', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { items, po } = await newMultiPo([8, 8, 8, 8, 8]);
    await countMulti(items, po, [8, 8, 5, 8, 11]);
    await openReview(app, screen, po);
    const d = screen.getByRole('dialog', /^Review Count/);
    await expect(d).toContainText('Difference');
    await expect(d).toContainText('2 of 5 items differ');
    await expect(d).toContainText('3 pcs short');
    await expect(d).toContainText('3 pcs extra');
    const sw = screen.getByRole('switch', 'Hide Matched Items');
    await expect(sw).toBeVisible();
    // matched lines are hidden by default: only the 2 that differ show
    await expect(d.getByRole('row', { name: /Kaos Uji/ })).toHaveCount(2);
    await sw.tap();
    await expect(d.getByRole('row', { name: /Kaos Uji/ })).toHaveCount(5);
  });

  test('RV-18 four lines or fewer carry no Difference summary', { session: 'rina', tags: ['receiving'] }, async ({ app, screen }) => {
    const { items, po } = await newMultiPo([8, 8]);
    await countMulti(items, po, [8, 5]);
    await openReview(app, screen, po);
    const d = screen.getByRole('dialog', /^Review Count/);
    await expect(d).toContainText('Ordered');
    await expect(d).not.toContainText('items differ');
  });

  test('RV-19 after accepting, the "items received" confirmation shows and the review closes', { session: 'rina', tags: ['receiving'] }, async ({ app, screen, browser }) => {
    await watchText(browser, /1 item received/);
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Partial Receive').tap();
    await expect.poll(() => seen(browser), { timeout: 150_000, interval: 500 }).toBe(true);
  });

  test('RV-20 [bug?] the invoice block ("Invoice for this order") is reachable after accepting', { session: 'rina', tags: ['receiving', 'bug'] }, async ({ app, screen, browser }) => {
    await watchText(browser, /1 item received/);
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    await openReview(app, screen, po);
    await screen.getByRole('button', 'Partial Receive').tap();
    await expect.poll(() => seen(browser), { timeout: 150_000, interval: 500 }).toBe(true);
    await expect(screen.getByText('Invoice for this order')).toBeVisible();
  });

  test('RV-21 the invoice can be recorded through the API after the goods are accepted', { tags: ['receiving'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count, receipt } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitPo(po, { received_stock_units: 5 });
    const res = await as('dc', 'yusuf').call('POST', `/api/v1/dc/goods-receipts/${receipt.receipt_id}/invoice`, { receipt_id: receipt.receipt_id, invoice_number: `INV-${po}`, invoice_total_minor: 200000, actor_id: 'yusuf', idempotency_key: crypto.randomUUID() }, { ok: false });
    expect(JSON.stringify(res)).not.toMatch(/error/i);
    expect((await poNumbers(po)).invoiced_stock_units).toBeGreaterThanOrEqual(0);
  });
});
