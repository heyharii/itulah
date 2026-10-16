// PO › order sheet: facts, print menu, edit, cancel, close short.
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, cancelPo, closeShort, firstLine, poDetail, poNumbers, waitPo } from '../../support/rig.ts';
import { countPo, newPo, openSheet, review, waitReceived } from '../../support/po.ts';

describe('PO sheet', () => {
  test('PO-S01 the sheet shows supplier, number, delivery date, payment, items and total', { session: 'rina', tags: ['po', 'smoke'] }, async ({ app, screen }) => {
    const { po } = await newPo(8);
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('Garmen Nusantara, PT');
    await expect(sheet).toContainText('Delivery');
    await expect(sheet).toContainText('Payment');
    await expect(sheet).toContainText('Total Ordered');
    await expect(sheet).toContainText('Items (1)');
    await expect(sheet).toContainText('Rp 320.000');
    await expect(sheet.getByRole('button', 'Print')).toBeVisible();
    await expect(sheet.getByRole('button', 'Cancel')).toBeEnabled();
    await expect(sheet.getByRole('button', 'Edit')).toBeVisible();
  });

  test('PO-S02 the print menu offers Print, Download PDF and four paper sizes', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Print').tap();
    await expect(screen.getByText('Download PDF')).toBeVisible();
    for (const paper of ['A5 landscape', 'A4 landscape', 'A5 portrait', 'A4 portrait']) await expect(screen.getByText(paper)).toBeVisible();
  });

  test('PO-S03 a partly received order shows what arrived and offers Close Short', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('Total Received');
    await expect(sheet).toContainText('5 pcs');
    await expect(sheet.getByRole('button', 'Close Short')).toBeVisible();
    await expect(sheet.getByRole('button', 'Cancel')).toBeHidden();
  });

  test('PO-S04 a count waiting shows its banner and Review Count; Cancel is hidden', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    const sheet = await openSheet(app, screen, po);
    // The sheet says nothing of the count itself (owner, 2026-10-10): only the Review Count button in the foot.
    await expect(sheet.getByRole('button', 'Review Count')).toBeVisible({ timeout: 60_000 });
    await expect(sheet).not.toContainText('Counted at the warehouse');
    await expect(sheet.getByRole('button', 'Cancel')).toBeHidden();
  });

  test('PO-S05 a recount request shows "Sent back to count" with the reason; Cancel stays hidden', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Recount', 40_000, 'cek lagi barangnya');
    const sheet = await openSheet(app, screen, po);
    // No "Sent back to count" banner either (owner, 2026-10-10); what is left to say is that nothing can end the order.
    await expect(sheet).toContainText('Total Ordered', { timeout: 60_000 });
    await expect(sheet.getByRole('button', 'Cancel')).toBeHidden();
  });

  test('PO-S06 Cancel cancels at once with an Undo; Undo takes it back, and left alone the order is cancelled', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Cancel').tap();
    // No question first: Undo is the way back (owner, 2026-10-11).
    await expect(screen.getByText(`${po} cancelled`)).toBeVisible();
    await screen.getByRole('button', 'Undo').tap();
    expect((await poNumbers(po)).lifecycle).toBe('ACTIVE');
    await sheet.getByRole('button', 'Cancel').tap();
    await expect(screen.getByText(`${po} cancelled`)).toBeVisible();
    await waitPo(po, { lifecycle: 'CANCELLED' }, 60_000);
  });

  test('PO-S07 a cancelled order shows its stamp and reason, with no Cancel or Edit', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { po } = await newPo(4);
    await cancelPo(po, 'Salah supplier');
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('CANCELLED');
    await expect(sheet).toContainText('Cancel Reason');
    await expect(sheet).toContainText('Salah supplier');
    await expect(sheet.getByRole('button', 'Cancel')).toBeHidden();
    await expect(sheet.getByRole('button', 'Edit')).toBeHidden();
  });

  test('PO-S08 Close Short from the sheet removes what is still owed and completes the PO', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    const sheet = await openSheet(app, screen, po);
    await sheet.getByRole('button', 'Close Short').tap();
    await expect(screen.getByText('Close This Short?')).toBeVisible();
    await expect(screen.getByText(/3 pcs will be removed from the order/)).toBeVisible();
    await screen.getByRole('textbox', 'Reason for Closing').fill('Supplier tidak bisa kirim sisa');
    await screen.getByRole('button', 'Close Short').last().tap();
    await waitPo(po, { lifecycle: 'SHORT_RECEIVED' });
    const line = await firstLine(po);
    expect(JSON.stringify(line)).toContain('Supplier tidak bisa kirim sisa');
  });

  test('PO-S09 a fully received order shows the FULLY RECEIVED stamp and no Edit/Cancel', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 8);
    await waitPo(po, { lifecycle: 'FULLY_RECEIVED' });
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('FULLY RECEIVED');
    await expect(sheet.getByRole('button', 'Edit')).toBeHidden();
    await expect(sheet.getByRole('button', 'Cancel')).toBeHidden();
  });

  test('PO-S10 a closed-short order shows the CLOSED SHORT stamp', { session: 'rina', tags: ['po'] }, async ({ app, screen }) => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await closeShort(po);
    await waitPo(po, { lifecycle: 'SHORT_RECEIVED' });
    const sheet = await openSheet(app, screen, po);
    await expect(sheet).toContainText('CLOSED SHORT');
  });

  test('PO-S11 the server refuses a second close short on the same line', { tags: ['po'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    await closeShort(po);
    const line = await firstLine(po);
    const again = await as('cloud', 'rina').call('POST', `/api/v1/purchase-order-lines/${line.po_line_id}/close-short`, { closed_by: 'rina', reason: 'lagi' }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/already closed short|nothing is outstanding/);
  });

  test('PO-S12 the server refuses to close short without saying why', { tags: ['po'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    const line = await firstLine(po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-order-lines/${line.po_line_id}/close-short`, { closed_by: 'rina', reason: '' }, { ok: false });
    expect(JSON.stringify(res)).toContain('must say why');
  });

  test('PO-S13 the server refuses to cancel an order that already received goods', { tags: ['po'] }, async () => {
    const { ctx, po } = await newPo(8);
    const { count } = await countPo(ctx, po, 5);
    await review(count.count_id, 'Accept');
    await waitReceived(po, 5);
    const d = await poDetail(po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-orders/${d.purchase_order_id}/cancel`, { reason: 'coba' }, { ok: false });
    expect(JSON.stringify(res)).toContain('close it short instead');
    expect((await poNumbers(po)).lifecycle).toBe('PARTIALLY_RECEIVED');
  });

  test('PO-S14 [bug] the server must refuse to cancel while a count waits for review', { tags: ['po', 'bug'] }, async () => {
    const { ctx, po } = await newPo(8);
    await countPo(ctx, po, 5);
    const d = await poDetail(po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-orders/${d.purchase_order_id}/cancel`, { reason: 'coba' }, { ok: false });
    // The hub disables the button; the API must say no too, or a waiting count is stranded.
    expect(JSON.stringify(res)).toMatch(/count|review|waiting/i);
    expect((await poNumbers(po)).lifecycle).toBe('ACTIVE');
  });

  test('PO-S15 the server refuses to cancel an order twice', { tags: ['po'] }, async () => {
    const { po } = await newPo(4);
    await cancelPo(po);
    const d = await poDetail(po);
    const res = await as('cloud', 'rina').call('POST', `/api/v1/purchase-orders/${d.purchase_order_id}/cancel`, { reason: 'lagi' }, { ok: false });
    expect(JSON.stringify(res)).toContain('already cancelled');
  });
});
