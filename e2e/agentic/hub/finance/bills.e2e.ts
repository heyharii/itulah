// Purchase Invoice (supplier bills): the four tabs, recording a bill, the bill sheet (post / hold / release / checks), a bill matched to a delivery, and what posting does to the supplier's payable.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as R from '../../support/rig.ts';

const TAGS = ['finance', 'bills'];

describe('Purchase Invoice list', { tags: TAGS }, () => {
  test('it opens on Merchandise with the four tabs, the search box, Record bill and a Unit filter', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/finance/payables/bills');
    await F.onScreen(screen, 'Purchase Invoice');
    for (const tab of ['Merchandise', 'Expenses', 'From GA', 'Unbilled deliveries']) await expect(screen.getByRole('tab', { name: new RegExp('^' + tab) })).toBeVisible();
    await expect(screen.getByRole('textbox', 'Search bills').first()).toBeVisible();
    await expect(screen.getByRole('button', 'Record bill').first()).toBeVisible();
    await expect(screen.getByRole('combobox', 'Unit')).toBeVisible();
  });

  test('a posted merchandise bill shows its invoice number, supplier, Total and Outstanding; search finds it by number and by supplier', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('L');
    const sup = await F.makeSupplier('bills');
    const b = await F.recordBill(sup, 350_000, { post: true, invoice: `INV-${t}` });
    await app.open('/finance/payables/bills');
    await F.onScreen(screen, 'Purchase Invoice');
    await screen.getByRole('textbox', 'Search bills').first().fill(`INV-${t}`);
    const row = F.rowOf(screen, `INV-${t}`);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toContainText(sup.name);
    await expect(row).toContainText(F.money(350_000));
    await expect(row).toContainText('Posted');
    await screen.getByRole('textbox', 'Search bills').first().fill(sup.name);
    await expect(F.rowOf(screen, `INV-${t}`)).toBeVisible({ timeout: 30_000 });
    expect(b.status).toBe('POSTED');
  });

  test('Unbilled deliveries lists the deliveries nobody has billed, oldest first, under the banner that explains the exposure', { session: 'rina' }, async ({ app, screen }) => {
    const unbilled = await F.cloud().get('/api/v1/finance/unbilled');
    expect(unbilled.length).toBeGreaterThan(0);
    await app.open('/finance/payables/bills');
    await screen.getByRole('tab', { name: /^Unbilled deliveries/ }).tap();
    await expect(screen.getByText('at the order price, accepted quantity', { exact: false })).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(unbilled[0].receipt_number).first()).toBeVisible({ timeout: 30_000 });
  });

  test('Unbilled deliveries counts every unbilled delivery and the banner carries the whole exposure — not just the oldest 200', { session: 'rina', tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    const all = await F.cloud().get('/api/v1/finance/unbilled?paged=true&limit=1');
    test.skip(all.total <= 200, 'fewer than 201 unbilled deliveries on the rig: the plain list is not cut');
    await app.open('/finance/payables/bills');
    await screen.getByRole('tab', { name: /^Unbilled deliveries/ }).tap();
    await expect(screen.getByText('at the order price, accepted quantity', { exact: false })).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('tab', { name: /^Unbilled deliveries\s*·\s*\d+/ })).toBeVisible({ timeout: 60_000 }); // the count arrives with the list
    const tab = await screen.getByRole('tab', { name: /^Unbilled deliveries/ }).textContent();
    const shown = Number(/·\s*(\d+)/.exec(tab ?? '')?.[1] ?? 0);
    const again = await F.cloud().get('/api/v1/finance/unbilled?paged=true&limit=1');
    expect([all.total, again.total], `the tab says ${shown} unbilled deliveries; the register holds ${all.total}`).toContain(shown);
    await expect(screen.getByText(F.money(again.total_minor), { exact: false }).first(), 'the banner states the exposure of the whole list').toBeVisible();
  });
});

describe('recording a bill', { tags: TAGS }, () => {
  test('the Record bill sheet takes a merchandise bill: submitted as a DRAFT with the typed figures', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('N');
    const sup = await F.makeSupplier('bills');
    await app.open('/finance/payables/bills');
    await screen.getByRole('button', 'Record bill').first().tap();
    await expect(screen.getByText('Record a supplier bill')).toBeVisible();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled(); // nothing filled in yet
    await screen.getByRole('textbox', { name: /^Invoice number/ }).fill(`INV-${t}`);
    await F.pick(screen, /^Site/, /Gudang|DC|Head Office|HO/);
    await F.pickSupplier(screen, sup.name);
    await screen.getByRole('textbox', { name: /^Subtotal/ }).fill('500000');
    await screen.getByRole('textbox', { name: /^Tax/ }).fill('55000');
    await expect(screen.getByText(F.money(555_000)).first()).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.tap();
    await expect.poll(async () => (await F.cloud().get(`/api/v1/finance/bills?q=INV-${t}&limit=5`)).rows.length, { timeout: 30_000 }).toBe(1);
    await expect(screen.getByRole('textbox', { name: /^Invoice number/ })).toHaveValue(''); // the form is cleared for the next bill
    const page = await F.cloud().get(`/api/v1/finance/bills?q=INV-${t}&limit=5`);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ status: 'DRAFT', subtotal_minor: 500_000, tax_minor: 55_000, total_minor: 555_000 });
  });

  test('a bill keyed in the sheet is filed under the supplier\'s code, like every other bill (BKK Settle, Credit Note and the ageing find bills by that code)', { session: 'rina', tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    const t = F.tag('C');
    const sup = await F.makeSupplier('bills');
    await app.open('/finance/payables/bills');
    await screen.getByRole('button', 'Record bill').first().tap();
    await screen.getByRole('textbox', { name: /^Invoice number/ }).fill(`INV-${t}`);
    await F.pick(screen, /^Site/, /Gudang|DC|Head Office|HO/);
    await F.pickSupplier(screen, sup.name);
    await screen.getByRole('textbox', { name: /^Subtotal/ }).fill('90000');
    await screen.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await F.cloud().get(`/api/v1/finance/bills?q=INV-${t}&limit=5`)).rows.length, { timeout: 30_000 }).toBe(1);
    const bill = (await F.cloud().get(`/api/v1/finance/bills?q=INV-${t}&limit=5`)).rows[0];
    expect(bill.supplier_id, 'the sheet sends the supplier register id (a uuid) where bills carry the supplier code').toBe(sup.code);
    const underCode = (await F.cloud().get(`/api/v1/finance/bills?supplier=${sup.code}&limit=300`)).rows.some((r: any) => r.invoice_id === bill.invoice_id);
    expect(underCode, 'the bill is found when the supplier\'s bills are asked for by code').toBe(true);
  });

  test('an expense bill must say what it was for: the lines have to add up to the subtotal', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/payables/bills');
    await screen.getByRole('button', 'Record bill').first().tap();
    await screen.getByRole('button', 'Expense').tap();
    await expect(screen.getByText('A cost: rent, electricity, a repair, a capital purchase.', { exact: false })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: /^Discount/ })).toBeHidden(); // an expense bill has no discount
    await screen.getByRole('textbox', { name: /^Subtotal/ }).fill('120000');
    await expect(screen.getByText('The lines have to add up to the subtotal')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('an invoice number is required and the subtotal must be a number', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/payables/bills');
    await screen.getByRole('button', 'Record bill').first().tap();
    await expect(screen.getByText('Fill in the invoice and the amount')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Subtotal/ }).fill('abc');
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });
});

describe('the bill sheet', { tags: TAGS }, () => {
  test('Post to the books: Dr payable / Cr inventory... the entry balances and the bill becomes Posted', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const t = F.tag('B');
    const sup = await F.makeSupplier('bills');
    const bill = await F.recordBill(sup, 640_000);
    const owedBefore = await F.owed(sup.code);
    await app.open(`/finance/payables/bills?bill=${bill.invoice_id}`);
    await expect(screen.getByText('Draft').first()).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText('Posts on the invoice date unless the month is closed.')).toBeVisible();
    await screen.getByRole('button', 'Post to the books').tap();
    await expect.poll(async () => (await F.bill(bill.invoice_id)).status, { timeout: 45_000 }).toBe('POSTED');
    await expect(screen.getByText('Journal', { exact: true })).toBeVisible({ timeout: 30_000 });
    const posted = await F.bill(bill.invoice_id);
    const e = await F.entry(posted.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === '2002' && l.credit_minor > 0)).toMatchObject({ credit_minor: 640_000, party_id: sup.code });
    expect((await F.owed(sup.code)) - owedBefore).toBe(640_000);
  });

  test('a held bill cannot be posted until it is released', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('H');
    const sup = await F.makeSupplier('bills');
    const bill = await F.recordBill(sup, 210_000);
    await app.open(`/finance/payables/bills?bill=${bill.invoice_id}`);
    await expect(screen.getByText('Holding stops any payment against this bill until it is released.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('switch', 'Hold this bill').tap();
    const hold = screen.getByRole('button', 'Hold this bill');
    await expect(hold).toBeDisabled(); // a reason is required
    await screen.getByRole('textbox', { name: /^Reason for the hold/ }).fill(`Harga belum cocok ${t}`);
    await hold.tap();
    await expect(screen.getByText('On hold; no payment can take it until it is released.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('A held bill cannot be posted until it is released.')).toBeVisible();
    await expect(screen.getByRole('button', 'Post to the books')).toBeDisabled();
    const held = await F.bill(bill.invoice_id);
    expect(held.on_hold).toBe(true);
    expect(held.hold_reason).toBe(`Harga belum cocok ${t}`);
    // release
    await screen.getByRole('switch', 'Hold this bill').tap();
    await expect(screen.getByText('Holding stops any payment against this bill until it is released.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Post to the books')).toBeEnabled();
    expect((await F.bill(bill.invoice_id)).on_hold).toBe(false);
  });

  test('"Check before posting" runs the six checks and says so when there is nothing to warn about', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('W');
    const sup = await F.makeSupplier('bills');
    const bill = await F.recordBill(sup, 180_000);
    await app.open(`/finance/payables/bills?bill=${bill.invoice_id}`);
    await expect(screen.getByText('A warning is not a block: posting can still go ahead.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Check before posting').tap();
    await expect(screen.getByText('A warning is not a block: posting can still go ahead.')).toBeHidden({ timeout: 30_000 });
    const warnings = await F.cloud().get(`/api/v1/finance/bills/${bill.invoice_id}/warnings`);
    if (warnings.length === 0) await expect(screen.getByText('No warnings.')).toBeVisible();
    else await expect(screen.getByText(warnings[0].message, { exact: false })).toBeVisible();
  });

  test('the sheet reads like the bill: totals ladder, Paid and Outstanding after a part payment', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('T');
    const sup = await F.makeSupplier('bills');
    const bill = await F.recordBill(sup, 800_000, { post: true });
    const d = await F.voucher({ direction: 'OUT', supplierCode: sup.code, party: sup.name, lines: [F.settleLine(bill.invoice_id, 300_000)] });
    await F.approveDoc(d.document_id);
    await F.postDoc(d.document_id);
    await app.open(`/finance/payables/bills?bill=${bill.invoice_id}`);
    await expect(screen.getByText('Outstanding').first()).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(F.money(500_000)).first()).toBeVisible();
    await expect(screen.getByText(F.money(-300_000)).first()).toBeVisible();
  });
});

describe('a bill matched to a delivery', { tags: TAGS }, () => {
  test('naming the delivery on the bill takes it off the unbilled list, and posting the bill replaces the delivery\'s payable instead of doubling it', { session: 'rina', timeout: 600_000 }, async ({ app, screen }) => {
    const t = R.tag('B');
    const ctx = await F.deliveryItem(t);
    const po = await R.placePo(ctx as any, 40);
    const d = await R.deliver(ctx as any, po, 40);
    const rid: string = d.receipt.receipt_id;
    const unb = await R.waitFor('the delivery to be unbilled', async () => (await F.unbilledAll()).rows.find((u: any) => u.receipt_id === rid), 300_000, 5_000);
    const ledger = async () => (await F.cloud().get('/api/v1/finance/payment-ledger/SUPPLIER/0001/movements?from=2026-01-01&to=2099-12-31')).closing_minor as number;

    const before = await ledger();
    const bill = await F.recordBill({ code: '0001', name: 'Garmen Nusantara' }, unb.value_at_order_price_minor, { receiptIds: [rid], invoice: `INV-${t}` });
    expect(bill.matched_by).toBe('rina');
    expect((await F.unbilledAll()).rows.some((u: any) => u.receipt_id === rid)).toBe(false);

    await app.open('/finance/payables/bills');
    await screen.getByRole('textbox', 'Search bills').first().fill(`INV-${t}`);
    await expect(F.rowOf(screen, `INV-${t}`)).toBeVisible({ timeout: 45_000 });

    const posted = await F.cloud().post(`/api/v1/finance/bills/${bill.invoice_id}/post`, {});
    F.expectBalanced((await F.entry(posted.journal_entry_id)).lines);
    expect(await ledger()).toBe(before); // the delivery was already owed; the bill replaces it
  });
});
