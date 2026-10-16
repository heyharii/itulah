// J2 — Excess to supplier credit. A delivery comes in over the order and with pieces that are not what
// was ordered: nina counts it in Ops › Receiving (13 pieces, 2 of them Not as Ordered) → rina's Review
// Count Submit accepts the 8 that were ordered and raises the return of the other 5 by itself → the DC
// hands the return over → Finance books the delivery at the ORDERED 8 pieces, never at the 13 that came,
// and the over-delivery is never "owed" by the supplier → merchandising sets the 8 up, the supplier's bill
// charges for the 13 and posts, and a credit note for the 5 returned pieces brings the payable back to 8.
// The last test is the finding this chain led to: that bill cannot be posted before the pieces are set up.
//
// Known on this rig and used as such, not re-reported: Generate Delivery Note on Ops › Return PO answers
// 405 (RET-21/22, use-cases/po.md), so the hand-over goes through the DC's API (`hand-over`), the call the
// Confirm button makes after the note.
import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as J from '../../support/journeys.ts';
import { signedIn } from '../../support/inventory.ts';
import * as O from '../../support/outbound.ts';
import { as, dcLine, dcReturns, deliver, handOver, nudge, poDetail, rows, waitPo } from '../../support/rig.ts';
import { dcCounts, openCount, openReview, seen, typeCount, watchText } from '../../support/po.ts';

const QTY = 8;
const GOOD = 11; // pieces the sheet's Counted field takes (good ones)
const NOT_AS_ORDERED = 2;
const PRICE = 40_000;
const ARRIVED = GOOD + NOT_AS_ORDERED; // 13 on the truck
const BACK = ARRIVED - QTY; // 5 go back: 3 extra + 2 Not as Ordered
const ORDERED_VALUE = QTY * PRICE; // 320.000 — what the delivery is worth to the books
const SHIPPED_VALUE = ARRIVED * PRICE; // 520.000 — what a supplier bill for the whole truck says

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const L = J.lateChecks();

describe('J2 Excess to supplier credit', { serial: true, tags: ['journey', 'j2', 'receiving', 'return-po', 'finance'] }, () => {

  test('J2-01 rina raises a PO of 8 pcs at Rp 40.000 on our supplier (New PO itself is J1); the DC has it', { timeout: 300_000 }, async () => {
    S.sup = await J.ownSupplier('excess to credit');
    const p = await J.ownPo(S.sup, QTY, { price: PRICE });
    Object.assign(S, { t: p.t, po: p.po, ctx: p.ctx, itemCode: `${p.t}-KAO` });
    S.ageing0 = await J.ageingTotal(S.sup.code);
    S.ledger0 = (await J.supplierLedger(S.sup.code)).closing;
    S.line = await dcLine(S.po);
    expect(S.line).toMatchObject({ po_number: S.po, supplier_id: S.sup.code });
  });

  test('J2-02 nina counts 11 and records 2 Not as Ordered in Ops › Receiving: the count that reaches the DC is 13, 2 of them wrong, +3 on the order (the good pieces against the 8 ordered)', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    await signedIn(app, browser, 'nina');
    await openCount(app, screen, S.po);
    await typeCount(screen, S.itemCode, String(GOOD));
    await screen.getByPlaceholder('0').fill(String(NOT_AS_ORDERED));
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await J.waitFor('the count at the DC', async () => { const l = await dcCounts(S.po); return l.length ? l : null; }, 60_000, 1_000);
    expect(c).toMatchObject({ counted_quantity: ARRIVED, wrong_quantity: NOT_AS_ORDERED, variance: GOOD - QTY, supplier_id: S.sup.code });
    S.countId = c.count_id;
    S.receiptId = c.receipt_id;
  });

  test('J2-03 rina opens Review Count: "5 pcs not as ordered will be returned", only Submit is offered; Submit receives the 8 and raises the return', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    await signedIn(app, browser, 'rina');
    await watchText(browser, /1 item received/);
    await openReview(app, screen, S.po);
    const d = screen.getByRole('dialog', /^Review Count/);
    await expect(d).toContainText(`${BACK} pcs not as ordered will be returned to the supplier`);
    await expect(d.getByRole('button', 'Close Short')).toBeHidden();
    await expect(d.getByRole('button', 'Partial Receive')).toBeHidden();
    await d.getByRole('button', 'Submit').tap();
    await expect.poll(() => seen(browser), { timeout: 150_000, interval: 500 }).toBe(true);
    const n = await waitPo(S.po, { lifecycle: 'FULLY_RECEIVED', received_stock_units: QTY }, 150_000);
    expect(n.expected_stock_units).toBe(QTY);
  });

  test('J2-04 the return was raised without anyone asking: RS number, 5 pcs, 2 of them Not as Ordered, open at the DC', { timeout: 300_000 }, async ({ app, screen }) => {
    const dc = await J.waitFor('the return at the DC', async () => { await nudge('cloud', 'dc'); const r = await dcReturns(S.po); return r.length ? r : null; }, 120_000, 3_000);
    expect(dc).toHaveLength(1);
    expect(dc[0]).toMatchObject({ status: 'OPEN', quantity: BACK, supplier_id: S.sup.code, handed_over_at: null });
    S.returnId = dc[0].return_id;
    S.returnNumber = dc[0].return_number;
    const cloud = rows(await J.cloud().get('/api/v1/purchase-returns?limit=200')).find((r) => r.return_id === S.returnId);
    expect(cloud).toMatchObject({ po_number: S.po, quantity: BACK, status: 'OPEN' });
    expect(cloud.lines[0].wrong_quantity).toBe(NOT_AS_ORDERED);
    await L.late('Return PO lists the raised return as Not Generated', async () => {
      await app.open('/procurement/returns');
      const row = screen.getByRole('row', { name: new RegExp(S.po) });
      await expect(row).toBeVisible({ timeout: 45_000 });
      await expect(row).toContainText(S.returnNumber);
      await expect(row).toContainText('Not Generated');
      await expect(row).toContainText(`${BACK} pcs`);
    });
  });

  test('J2-05 the DC hands the goods over to the supplier (through the API: Generate Delivery Note answers 405 here, RET-21): the buyer\'s list says Completed', { timeout: 300_000 }, async ({ app, screen }) => {
    const done = await handOver(S.returnId, 'Pak Joko');
    expect(done).toMatchObject({ status: 'HANDED_OVER', handed_over_to: 'Pak Joko', quantity: BACK });
    const seenAtHo = await J.waitFor('the hand-over at head office', async () => {
      await nudge('dc', 'cloud');
      const r = rows(await J.cloud().get('/api/v1/purchase-returns?limit=200')).find((x) => x.return_id === S.returnId);
      return r?.handed_over_at ? r : null;
    }, 120_000, 3_000);
    expect(seenAtHo.status).toBe('HANDED_OVER');
    await L.late('Return PO › Completed lists the handed-over return', async () => {
      await app.open('/procurement/returns');
      await J.tapSoft(screen.getByRole('tab', /^Completed/));
      const row = screen.getByRole('row', { name: new RegExp(S.po) });
      await expect(row).toBeVisible({ timeout: 45_000 });
      await expect(row).toContainText('Completed');
    });
  });

  test('J2-06 Finance books the delivery at the 8 ordered pieces (Rp 320.000), not at the 13 that came: Unbilled deliveries, payable, ageing and the entry agree', { timeout: 420_000 }, async () => {
    const u = await J.waitUnbilled(S.receiptId);
    expect(u).toMatchObject({ supplier_id: S.sup.code, line_count: 1, value_at_order_price_minor: ORDERED_VALUE });
    expect(u.value_at_order_price_minor).not.toBe(SHIPPED_VALUE);
    await J.waitOwed(S.sup.code, S.ageing0, ORDERED_VALUE);
    const moves = await J.movementsOf(S.sup.code, S.receiptId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ source_kind: 'GOODS_RECEIPT', account_code: '2002', credit_minor: ORDERED_VALUE, debit_minor: 0 });
    const e = await F.entry(moves[0].entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l: Json) => l.account_code === '1029'), 'stock is valued at the ordered pieces').toMatchObject({ debit_minor: ORDERED_VALUE });
    expect(await J.ageingTotal(S.sup.code)).toBe(S.ageing0 + ORDERED_VALUE);
    expect((await J.supplierLedger(S.sup.code)).closing - S.ledger0).toBe(ORDERED_VALUE);
  });

  test('J2-07 an over-delivery is never owed back in money: the supplier-returns register holds nothing for this supplier, so a credit note has no "Settles return" to point at (by design, supplier_returns.rs)', async () => {
    const register = (await J.cloud().get('/api/v1/supplier-returns')).items as Json[];
    expect(register.filter((r) => r.supplier_id === S.sup.code)).toEqual([]);
    expect(register.filter((r) => r.owed_minor > 0 && r.supplier_id === S.sup.code)).toEqual([]);
    // the buyer's side of the same fact: the PO has nothing left to bill for the 5 that went back
    const d = await poDetail(S.po);
    expect(d.returns ?? []).toHaveLength(1);
  });

  test('J2-08 merchandising sets the 8 accepted pieces up as an article and the DC tags them (so a bill that differs from the delivery has a stock layer to fold into)', { timeout: 420_000 }, async () => {
    const set = await J.setUpAndTag(S.ctx, S.po, QTY, S.t);
    expect(set.skus).toHaveLength(4);
    expect(await O.freeOf(set.skus[0])).toBe(QTY / 4);
  });

  test('J2-09 the supplier bills the whole truck (13 × Rp 40.000, Rp 200.000 more than the delivery): recorded with its variance, posted from its sheet, one balanced entry', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    S.invoice = `INV-${S.t}`;
    const bill = await F.recordBill({ code: S.sup.code, name: S.sup.name }, SHIPPED_VALUE, { receiptIds: [S.receiptId], invoice: S.invoice, note: `Jurnal ${S.t}` });
    S.billId = bill.invoice_id;
    expect(bill).toMatchObject({ status: 'DRAFT', price_variance_minor: SHIPPED_VALUE - ORDERED_VALUE, matched_by: 'rina', total_minor: SHIPPED_VALUE });
    await signedIn(app, browser, 'rina');
    await app.open(`/finance/payables/bills?bill=${S.billId}`);
    await expect(screen.getByText('Posts on the invoice date unless the month is closed.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Post to the books').tap();
    await expect.poll(async () => (await F.bill(S.billId)).status, { timeout: 45_000 }).toBe('POSTED');
    const posted = await F.bill(S.billId);
    F.expectBalanced((await F.entry(posted.journal_entry_id)).lines);
    expect(posted.outstanding_minor).toBe(SHIPPED_VALUE);
    expect((await J.supplierLedger(S.sup.code)).closing - S.ledger0, 'the bill replaced the delivery\'s 320.000 with its own 520.000').toBe(SHIPPED_VALUE);
  });

  test('J2-10 the supplier\'s credit note for the 5 returned pieces (Rp 200.000), keyed in Credit Note and posted: the supplier ledger falls by it and the supplier is owed the 8 ordered', { timeout: 300_000 }, async ({ app, screen }) => {
    const CREDIT = BACK * PRICE;
    const before = (await J.supplierLedger(S.sup.code)).closing;
    await app.open('/finance/payables/credit-notes');
    await F.onScreen(screen, 'Credit Note');
    await screen.getByRole('button', 'New credit note').first().tap();
    await F.pickSupplier(screen, S.sup.name);
    await F.pick(screen, /^Against invoice/, new RegExp(S.invoice));
    await screen.getByRole('textbox', { name: /^Amount/ }).fill(String(CREDIT));
    await F.pick(screen, /^Reason/, 'Goods returned');
    await screen.getByRole('textbox', { name: /^Supplier's credit note no/ }).fill(`CN-${S.t}`);
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Not in the books until it is posted.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Post').tap();
    await screen.getByRole('dialog', 'Post this credit note?').getByRole('button', 'Post').tap();
    await expect(screen.getByText('In the books. The next bill from this supplier can absorb it', { exact: false })).toBeVisible({ timeout: 30_000 });

    const cn = ((await J.cloud().get('/api/v1/finance/credit-notes')) as Json[]).find((c) => c.supplier_id === S.sup.code && c.their_number === `CN-${S.t}`);
    expect(cn).toMatchObject({ status: 'POSTED', total_minor: CREDIT, invoice_id: S.billId, reason: 'RETURN' });
    const e = await F.entry(cn.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l: Json) => l.account_code === '2002')).toMatchObject({ debit_minor: CREDIT, party_id: S.sup.code });
    expect(e.lines.find((l: Json) => l.account_code === '1029')).toMatchObject({ credit_minor: CREDIT });
    const after = (await J.supplierLedger(S.sup.code)).closing;
    expect(before - after).toBe(CREDIT);
    expect(after - S.ledger0, 'owed for the 8 that were ordered, nothing for the 5 that went back').toBe(ORDERED_VALUE);
  });

  test('J2-99 the screens along the way agree with the books (misses collected along the journey)', async () => {
    expect(L.misses, 'screen checks that missed').toEqual([]);
  });
});

// Self-contained (own PO), so a red chain above cannot hide it and it cannot block the chain.
describe('J2 finding', { tags: ['journey', 'j2', 'finance', 'bug'] }, () => {

  test('J2-11 [bug] a bill dearer than its delivery, posted while the delivery\'s pieces are still Unidentified (no article set up yet), posts or is refused in words a buyer can act on — never "entry does not balance"', { tags: ['bug'], timeout: 420_000 }, async () => {
    const sup = await J.ownSupplier('excess to credit');
    const p = await J.ownPo(sup, QTY, { price: PRICE });
    const d = await deliver(p.ctx, p.po, QTY, { review: 'Accept' });
    const u = await J.waitUnbilled(d.receipt.receipt_id);
    expect(u.value_at_order_price_minor).toBe(ORDERED_VALUE);
    const bill = await F.recordBill({ code: sup.code, name: sup.name }, ORDERED_VALUE + 200_000, { receiptIds: [d.receipt.receipt_id], invoice: `INV-${p.t}` });
    expect(bill.price_variance_minor).toBe(200_000);
    const res = await J.cloud().call('POST', `/api/v1/finance/bills/${bill.invoice_id}/post`, {}, { ok: false });
    const refusal = typeof res?.error === 'string' ? res.error : '';
    expect(refusal, 'what the buyer is told when the bill cannot be posted').not.toMatch(/does not balance/i);
    expect((await F.bill(bill.invoice_id)).status, `the bill after posting (answer: ${JSON.stringify(res).slice(0, 160)})`).toBe('POSTED');
  });
});
