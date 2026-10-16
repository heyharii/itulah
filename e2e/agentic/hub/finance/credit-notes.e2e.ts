// Credit Note: a supplier's credit against a posted bill (goods returned / price correction), posted into the books, optionally refunded in cash, optionally settling a supplier return.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'credit-notes'];

/** A supplier of our own with one posted bill to write the credit against. */
async function billed(prefix: string, amount = 1_000_000) {
  const t = F.tag(prefix);
  const sup = await F.makeSupplier('credit');
  const bill = await F.recordBill(sup, amount, { post: true });
  return { t, sup, bill };
}

describe('Credit Note list and form', { tags: TAGS }, () => {
  test('the register shows a credit note with its number, supplier, invoice, reason, total and status; Status filter narrows it', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const { sup, bill } = await billed('C');
    const cn = await F.creditNote(bill.invoice_id, 120_000, { their: 'CN-LIST', reason: 'PRICE_CORRECTION' });
    await app.open('/finance/payables/credit-notes');
    await F.onScreen(screen, 'Credit Note');
    await expect(screen.getByRole('button', 'New credit note').first()).toBeVisible();
    await F.expectHeads(screen, ['Credit No', 'Date', 'Supplier', 'Against invoice', 'Reason', 'Total', 'Status', 'Refunded']);
    const row = F.rowOf(screen, cn.credit_number);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toContainText(sup.name);
    await expect(row).toContainText(bill.invoice_number);
    await expect(row).toContainText(F.money(120_000));
    await expect(row).toContainText('Draft');
    await F.pick(screen, 'Status', 'Posted');
    await expect(F.rowOf(screen, cn.credit_number)).toBeHidden();
    await F.pick(screen, 'Status', 'Draft');
    await expect(F.rowOf(screen, cn.credit_number)).toBeVisible();
  });

  test('New credit note: the invoice list is that supplier\'s posted bills; Submit waits for an invoice and an amount', { session: 'rina' }, async ({ app, screen }) => {
    const { sup, bill } = await billed('F');
    await app.open('/finance/payables/credit-notes');
    await screen.getByRole('button', 'New credit note').first().tap();
    await expect(screen.getByText('New credit note').first()).toBeVisible();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await F.pickSupplier(screen, sup.name);
    await F.pick(screen, /^Against invoice/, new RegExp(bill.invoice_number));
    await expect(screen.getByText(`${F.money(1_000_000)} still owed on it.`)).toBeVisible();
    await expect(submit).toBeDisabled(); // still no amount
    await screen.getByRole('textbox', { name: /^Amount/ }).fill('0');
    await expect(submit).toBeDisabled();
    await screen.getByRole('textbox', { name: /^Amount/ }).fill('150000');
    await expect(submit).toBeEnabled();
    // the Reason select offers the two reasons
    await screen.getByRole('combobox', { name: /^Reason/ }).tap();
    await expect(screen.getByRole('option', 'Goods returned')).toBeVisible();
    await expect(screen.getByRole('option', 'Price correction')).toBeVisible();
  });
});

describe('Credit Note life', { tags: TAGS }, () => {
  test('record one in the form, post it: Dr supplier payable / Cr inventory, the supplier ledger falls by the credit, the bill itself is untouched', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const { t, sup, bill } = await billed('P');
    const amount = F.amountOf(50, 300);
    const ledger = async () => (await F.cloud().get(`/api/v1/finance/payment-ledger/SUPPLIER/${sup.code}/movements?from=2026-01-01&to=2099-12-31`)).closing_minor as number;
    const before = await ledger();

    await app.open('/finance/payables/credit-notes');
    await screen.getByRole('button', 'New credit note').first().tap();
    await F.pickSupplier(screen, sup.name);
    await F.pick(screen, /^Against invoice/, new RegExp(bill.invoice_number));
    await screen.getByRole('textbox', { name: /^Amount/ }).fill(String(amount));
    await screen.getByRole('textbox', { name: /^Supplier's credit note no/ }).fill(`CN-${t}`);
    await screen.getByRole('button', 'Submit').tap();

    // the panel of the new note opens: a DRAFT, "Not in the books until it is posted."
    await expect(screen.getByText('Not in the books until it is posted.')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Post').tap();
    await screen.getByRole('dialog', 'Post this credit note?').getByRole('button', 'Post').tap();
    await expect(screen.getByText('In the books. The next bill from this supplier can absorb it', { exact: false })).toBeVisible({ timeout: 30_000 });

    const list = await F.cloud().get('/api/v1/finance/credit-notes');
    const cn = list.find((c: any) => c.supplier_id === sup.code && c.their_number === `CN-${t}`);
    expect(cn).toMatchObject({ status: 'POSTED', total_minor: amount, their_number: `CN-${t}`, invoice_id: bill.invoice_id });
    const e = await F.entry(cn.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === '2002')).toMatchObject({ debit_minor: amount, party_id: sup.code });
    expect(e.lines.find((l) => l.account_code === '1029')).toMatchObject({ credit_minor: amount });
    expect((await ledger()) - before).toBe(-amount);
    expect((await F.bill(bill.invoice_id)).outstanding_minor).toBe(1_000_000); // the credit waits for the next bill or a refund
  });

  test('Record refund: the supplier sent the money — the bank rises by the credit and the note reads Refunded', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const { bill } = await billed('R');
    const amount = F.amountOf(50, 300);
    const cn = await F.creditNote(bill.invoice_id, amount);
    await F.postCreditNote(cn.credit_note_id);
    const before = await F.balance(F.BANK.account);

    await app.open('/finance/payables/credit-notes');
    await F.rowOf(screen, cn.credit_number).tap();
    await screen.getByRole('button', 'Record refund').tap();
    await F.pick(screen, /^Received into/, /DANAMON/);
    await screen.getByRole('button', 'Submit').tap();
    await expect.poll(async () => ((await F.cloud().get('/api/v1/finance/credit-notes')) as any[]).find((c) => c.credit_note_id === cn.credit_note_id).status, { timeout: 45_000 }).toBe('REFUNDED');
    const after = (await F.cloud().get('/api/v1/finance/credit-notes')).find((c: any) => c.credit_note_id === cn.credit_note_id);
    expect(after.refund_entry_id).toBeTruthy();
    F.expectBalanced((await F.entry(after.refund_entry_id)).lines);
    expect((await F.balance(F.BANK.account)) - before).toBe(amount);
  });

  test('a credit note cannot exceed what the bill is worth', { session: 'rina' }, async () => {
    const { bill } = await billed('X', 200_000);
    const refused = await F.cloud().call('POST', '/api/v1/finance/credit-notes', { invoice_id: bill.invoice_id, credit_date: F.today(), reason: 'RETURN', subtotal_minor: 999_999_999, tax_minor: 0 }, { ok: false });
    expect(refused.error ?? '').toMatch(/./);
    expect((await F.cloud().get('/api/v1/finance/credit-notes')).some((c: any) => c.invoice_id === bill.invoice_id)).toBe(false);
  });
});

describe('Settles return', { tags: [...TAGS, 'return-po'] }, () => {
  test('a credit note can settle a supplier return that is still owed: the return is credited by the note total', { session: 'rina' }, async ({ app, screen }) => {
    const owing = ((await F.cloud().get('/api/v1/supplier-returns')).items as any[]).find((r) => r.owed_minor > 0);
    test.skip(!owing, 'needs a supplier return in the register with an amount still owed (HO return stock); the rig has none');
    const code = owing.supplier_id as string;
    const sup = (await F.cloud().get('/api/v1/suppliers?limit=200')).rows.find((s: any) => s.supplier_id === code || s.supplier_code === code);
    const bill = await F.recordBill({ code: sup.supplier_code, name: sup.name }, 500_000, { post: true });
    await app.open('/finance/payables/credit-notes');
    await screen.getByRole('button', 'New credit note').first().tap();
    await F.pickSupplier(screen, sup.name);
    await F.pick(screen, /^Against invoice/, new RegExp(bill.invoice_number));
    await screen.getByRole('textbox', { name: /^Amount/ }).fill('50000');
    await F.pick(screen, /^Settles return/, new RegExp(owing.allotment_number));
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Not in the books until it is posted.')).toBeVisible({ timeout: 45_000 });
    const after = ((await F.cloud().get('/api/v1/supplier-returns')).items as any[]).find((r) => r.allotment_id === owing.allotment_id);
    expect(after.owed_minor).toBeLessThan(owing.owed_minor);
  });
});
