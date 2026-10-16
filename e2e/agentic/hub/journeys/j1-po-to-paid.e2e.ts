// J1 — PO to paid. rina raises a PO in the New PO screen → nina counts it short in Ops › Receiving →
// rina reviews it (Close Short) → the delivery lands in Finance (Unbilled deliveries, the supplier's
// payable) at the matched value → a supplier bill names the delivery and is posted → a BKK pays it →
// the supplier owes nothing for it. Every hand-off is proven through the API; the people act on screens.
//
// Own supplier ("Journey e2e PO to paid"): its payable is read as a before/after pair, so nobody else's
// postings are in it. Known bugs this journey runs into are referenced, not re-reported: B2 (Unbilled
// deliveries tab cut at the oldest 200, use-cases/finance.md).
import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as J from '../../support/journeys.ts';
import { signedIn } from '../../support/inventory.ts';
import { dcLine, poDetail, waitPo } from '../../support/rig.ts';
import { dcCounts, fillHeader, fillItem, openComposer, openCount, openReview, typeCount } from '../../support/po.ts';

const QTY = 8;
const COUNTED = 5;
const PRICE = 40_000;
const MATCHED = COUNTED * PRICE; // 200.000: what the supplier is owed for the five pieces that were accepted

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = { late: [] as string[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Screen checks that do not gate the chain: the miss is kept and asserted by the last test, so the journey still runs to the end. */
async function late(what: string, check: () => Promise<void>) {
  try {
    await check();
  } catch (e) {
    S.late.push(`${what}: ${String((e as Error).message).split('\n')[0]}`);
  }
}

async function bkkHeader(screen: any, supplierName: string, note: string) {
  await F.pick(screen, /^Unit/, /Head Office/);
  await F.pick(screen, /^Cash \/ bank/, /DANAMON/);
  await F.pickSupplier(screen, supplierName);
  await screen.getByRole('textbox', { name: /^Note(?! on row)/ }).fill(note);
}

describe('J1 PO to paid', { serial: true, tags: ['journey', 'j1', 'po', 'receiving', 'finance'] }, () => {

  test('J1-01 rina raises the PO in New PO: the server numbers it, 8 pcs at Rp 40.000 for our supplier', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    S.sup = await J.ownSupplier('PO to paid');
    S.t = J.tag('J1');
    await F.ensureBank();
    S.ageing0 = await J.ageingTotal(S.sup.code);
    S.ledger0 = (await J.supplierLedger(S.sup.code)).closing;
    S.bank0 = await F.balance(F.BANK.account);
    S.item = `Kaos Jurnal ${S.t}`;

    await signedIn(app, browser, 'rina');
    await openComposer(app, screen);
    await fillHeader(screen, { supplier: `${S.sup.name}, PT` }); // the picker writes the legal form after the name
    await screen.getByRole('button', 'New item').tap();
    await fillItem(screen, { name: S.item, qty: String(QTY), price: String(PRICE) });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('button', `Edit ${S.item}`)).toBeVisible();
    await screen.getByRole('textbox', 'Notes').fill(`Jurnal ${S.t}`);
    await screen.getByRole('button', 'Review order').tap();
    await expect(screen.getByText('Review this order')).toBeVisible();
    await screen.getByRole('button', 'Submit').tap();
    const popup = screen.getByText(/PO-\d{6}-\d{3} created/);
    await expect(popup).toBeVisible({ timeout: 30_000 });
    S.po = /PO-\d{6}-\d{3}/.exec((await popup.textContent()) ?? '')![0];

    const d = await poDetail(S.po);
    expect(d.supplier_id).toBe(S.sup.code);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ ordered_quantity: QTY, unit_price_minor: PRICE });
    expect(d.gross_minor).toBe(QTY * PRICE);
    expect(d.notes).toContain(S.t);
    S.itemCode = d.lines[0].article_code as string; // the supplier item code the count sheet labels its field with
    expect(S.itemCode).toBeTruthy();
  });

  test('J1-02 the PO reaches the DC and nina finds it in Ops › Receiving under our supplier', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    S.line = await dcLine(S.po);
    expect(S.line).toMatchObject({ po_number: S.po, supplier_id: S.sup.code });
    await signedIn(app, browser, 'nina');
    await app.open('/operations/intake');
    const row = screen.getByRole('row', { name: new RegExp(S.po) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText(S.sup.name);
    await expect(row).toContainText('Count receive');
  });

  test('J1-03 nina counts 5 of the 8 blind; the count waits for the buyer (nothing received yet)', { timeout: 300_000 }, async ({ app, screen }) => {
    await openCount(app, screen, S.po);
    await expect(screen.getByRole('dialog')).not.toContainText(`${QTY} pcs`); // blind: the ordered quantity is not on the sheet
    await typeCount(screen, S.itemCode, String(COUNTED));
    await screen.getByRole('button', 'Submit count').tap();
    await expect(screen.getByText(/Count sent/)).toBeVisible({ timeout: 30_000 });
    const [c] = await J.waitFor('the count at the DC', async () => { const l = await dcCounts(S.po); return l.length ? l : null; }, 60_000, 1_000);
    expect(c).toMatchObject({ counted_quantity: COUNTED, variance: COUNTED - QTY, wrong_quantity: 0, supplier_id: S.sup.code });
    S.countId = c.count_id;
    S.receiptId = c.receipt_id;
    expect((await J.supplierLedger(S.sup.code)).closing, 'a count nobody has accepted yet owes the supplier nothing').toBe(S.ledger0);
  });

  test('J1-04 rina reviews the count: it reads 3 pcs short, Close Short accepts the 5 and closes the other 3', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    await signedIn(app, browser, 'rina');
    await openReview(app, screen, S.po);
    const dlg = screen.getByRole('dialog', /^Review Count/);
    await expect(dlg).toContainText(S.sup.name);
    await expect(dlg).toContainText(/3 pcs short/);
    await screen.getByRole('button', 'Close Short').tap();
    await expect(screen.getByText('Close This Short?')).toBeVisible();
    await expect(screen.getByText(/3 pcs will be removed from the order, and the PO completes as received/)).toBeVisible();
    await screen.getByRole('button', 'Close Short').last().tap();
    const n = await waitPo(S.po, { lifecycle: 'SHORT_RECEIVED', received_stock_units: COUNTED }, 150_000);
    expect(n.expected_stock_units).toBe(QTY);
    expect(n.excess_stock_units).toBe(0);
  });

  test('J1-05 the delivery is in Finance: Unbilled deliveries lists it at 5 × Rp 40.000, the supplier payable rose by the same, the entry balances', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    const u = await J.waitUnbilled(S.receiptId);
    expect(u).toMatchObject({ supplier_id: S.sup.code, line_count: 1, value_at_order_price_minor: MATCHED, invoice_number: null });
    S.grn = u.receipt_number as string;
    await J.waitOwed(S.sup.code, S.ageing0, MATCHED);
    expect(await J.ageingTotal(S.sup.code), 'Accounts Payable ageing carries the delivery').toBe(S.ageing0 + MATCHED);
    const moves = await J.movementsOf(S.sup.code, S.receiptId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ source_kind: 'GOODS_RECEIPT', account_code: '2002', credit_minor: MATCHED, debit_minor: 0 });
    const e = await F.entry(moves[0].entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l: Json) => l.account_code === '2002')).toMatchObject({ credit_minor: MATCHED, party_id: S.sup.code });
    expect(e.lines.find((l: Json) => l.account_code === '1029'), 'the stock side of the receipt').toMatchObject({ debit_minor: MATCHED });
    S.ledger1 = (await J.supplierLedger(S.sup.code)).closing;
    expect(S.ledger1 - S.ledger0).toBe(MATCHED);

    // the buyer's screen: the new delivery is in the tab (B2 in use-cases/finance.md: the tab is cut at the oldest 200, the newest delivery is the one it drops)
    await late('Unbilled deliveries lists the new delivery (B2)', async () => {
      await app.open('/finance/payables/bills');
      await F.onScreen(screen, 'Purchase Invoice');
      await screen.getByRole('tab', { name: /^Unbilled deliveries/ }).tap();
      await expect(screen.getByText('at the order price, accepted quantity', { exact: false })).toBeVisible({ timeout: 45_000 });
      const tab = ((await screen.getByRole('tab', { name: /^Unbilled deliveries/ }).textContent()) ?? '').trim();
      const books = (await F.cloud().get('/api/v1/finance/unbilled?paged=true&limit=1')).total;
      try {
        await expect(screen.getByText(S.grn).first()).toBeVisible({ timeout: 20_000 });
      } catch {
        throw new Error(`${S.grn} is not on the tab ("${tab}" while the books hold ${books} unbilled deliveries)`);
      }
    });
  });

  test('J1-06 the supplier bill names the delivery: it leaves Unbilled deliveries, the bill is Draft at the same value', { timeout: 300_000 }, async ({ app, screen }) => {
    S.invoice = `INV-${S.t}`;
    const bill = await F.recordBill({ code: S.sup.code, name: S.sup.name }, MATCHED, { receiptIds: [S.receiptId], invoice: S.invoice, note: `Jurnal ${S.t}` });
    S.billId = bill.invoice_id;
    expect(bill).toMatchObject({ status: 'DRAFT', matched_by: 'rina', price_variance_minor: 0, total_minor: MATCHED, supplier_id: S.sup.code });
    expect((await F.unbilledAll()).rows.some((u: Json) => u.receipt_id === S.receiptId), 'a billed delivery is off the unbilled list').toBe(false);
    await app.open('/finance/payables/bills');
    await F.onScreen(screen, 'Purchase Invoice');
    await screen.getByRole('textbox', 'Search bills').first().fill(S.invoice);
    const row = F.rowOf(screen, S.invoice);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toContainText(S.sup.name);
    await expect(row).toContainText(F.money(MATCHED));
    await expect(row).toContainText('Draft');
  });

  test('J1-07 rina posts the bill from its sheet: one balanced entry, and the supplier owes the same Rp 200.000 once (the bill replaces the delivery\'s payable)', { timeout: 300_000 }, async ({ app, screen }) => {
    await app.open(`/finance/payables/bills?bill=${S.billId}`);
    await expect(screen.getByText('Posts on the invoice date unless the month is closed.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Post to the books').tap();
    await expect.poll(async () => (await F.bill(S.billId)).status, { timeout: 45_000 }).toBe('POSTED');
    const posted = await F.bill(S.billId);
    const e = await F.entry(posted.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l: Json) => l.account_code === '2002' && l.credit_minor > 0)).toMatchObject({ credit_minor: MATCHED, party_id: S.sup.code });
    expect(posted).toMatchObject({ outstanding_minor: MATCHED, payment_state: 'UNPAID' });
    expect((await J.supplierLedger(S.sup.code)).closing, 'the bill replaced the delivery\'s payable, it did not double it').toBe(S.ledger1);
    expect(await F.owed(S.sup.code)).toBe(MATCHED);
    expect(await J.ageingTotal(S.sup.code)).toBe(S.ageing0 + MATCHED);
  });

  test('J1-08 rina pays it with a BKK from the Danamon account: posted, balanced, the bill is Paid, the bank is down by Rp 200.000', { timeout: 420_000 }, async ({ app, screen }) => {
    const note = `Bayar ${S.t}`;
    await app.open('/finance/cash-bank/bkk/new');
    await F.onScreen(screen, 'New BKK');
    await bkkHeader(screen, S.sup.name, note);
    await screen.getByRole('checkbox', `${S.invoice} in full`).check();
    await expect(screen.getByText(F.money(MATCHED)).first()).toBeVisible();
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Approve').tap();
    await expect(screen.getByRole('heading', { name: /^KK-\d\d-\d\d-\d{5}$/, level: 1 })).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 30_000 });

    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')).find((d: Json) => d.memo === note);
    expect(doc, 'the posted BKK').toBeTruthy();
    S.docId = doc.document_id;
    expect(doc).toMatchObject({ status: 'POSTED', amount_minor: MATCHED, supplier_id: S.sup.code });
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l: Json) => l.account_code === '2002')).toMatchObject({ debit_minor: MATCHED, party_id: S.sup.code });
    expect(e.lines.find((l: Json) => l.account_code === F.BANK.account)).toMatchObject({ credit_minor: MATCHED });
    expect((await F.bill(S.billId))).toMatchObject({ outstanding_minor: 0, paid_minor: MATCHED, payment_state: 'PAID' });
    expect((await F.balance(F.BANK.account)) - S.bank0).toBe(-MATCHED);
  });

  test('J1-09 the books close on this PO: supplier owes nothing for it (bills, ledger and ageing back to where they were), the PO stays short-received', async () => {
    expect(await F.owed(S.sup.code)).toBe(0);
    expect((await J.supplierLedger(S.sup.code)).closing, 'supplier ledger').toBe(S.ledger0);
    expect(await J.ageingTotal(S.sup.code), 'payables ageing').toBe(S.ageing0);
    const paid = await J.movementsOf(S.sup.code, S.docId);
    expect(paid, 'the BKK is the last movement on the payable').toHaveLength(1);
    expect(paid[0]).toMatchObject({ source_kind: 'CASH_DOC', debit_minor: MATCHED, credit_minor: 0 });
    const d = await poDetail(S.po);
    expect(d.lifecycle).toBe('SHORT_RECEIVED');
  });

  test('J1-99 [bug] the screens the buyer works from agree with the books (misses collected along the journey)', { tags: ['bug'] }, async () => {
    expect(S.late, 'screen checks that missed').toEqual([]);
  });
});
