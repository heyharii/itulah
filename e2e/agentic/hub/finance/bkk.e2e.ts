// BKK (Bukti Kas Keluar) — paying a supplier: the Klasik form's Settle / Other lines / Offset tabs, discount (POTONGAN), over-settling, giro, and the books after posting.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as R from '../../support/rig.ts';

const TAGS = ['finance', 'bkk'];

/** The first half of every BKK: unit, bank, supplier, note. */
async function header(screen: any, supplierName: string, note: string) {
  await F.pick(screen, /^Unit/, /Head Office/);
  await F.pick(screen, /^Cash \/ bank/, /DANAMON/);
  await F.pickSupplier(screen, supplierName);
  await screen.getByRole('textbox', { name: /^Note(?! on row)/ }).fill(note);
}

describe('BKK form', { tags: TAGS }, () => {
  test('the register lists BKK; the form shows Settle bills / Other lines / Offset receivables and the supplier\'s open total', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('K');
    const sup = await F.makeSupplier('bkk');
    const bill = await F.recordBill(sup, 400_000, { post: true });
    await app.open('/finance/cash-bank/bkk');
    await F.onScreen(screen, 'BKK');
    await expect(screen.getByRole('button', 'New BKK')).toBeVisible();
    await F.expectHeads(screen, ['Number', 'Date', 'Supplier', 'Cash / bank', 'Amount', 'Status']);

    await screen.getByRole('button', 'New BKK').tap();
    await F.onScreen(screen, 'New BKK');
    for (const tab of ['Settle bills', 'Other lines', 'Offset receivables']) await expect(screen.getByRole('tab', { name: new RegExp('^' + tab) })).toBeVisible();
    await expect(screen.getByText('Choose a supplier to see their open bills.')).toBeVisible();
    await header(screen, sup.name, `Uji ${t}`);
    await expect(screen.getByText(/^Rp\s[\d.]+\sopen$/)).toBeVisible({ timeout: 30_000 }); // the supplier's open payable (its exact value is checked in the Settle-list-at-scale test)
    await expect(screen.getByRole('checkbox', `Settle ${bill.invoice_number}`)).toBeVisible();
  });

  test('over-settling is refused as it is typed and again when Save draft is pressed', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('O');
    const sup = await F.makeSupplier('bkk');
    const bill = await F.recordBill(sup, 300_000, { post: true });
    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, `Uji ${t}`);
    await screen.getByRole('checkbox', `Settle ${bill.invoice_number}`).check();
    await screen.getByRole('textbox', `Paid on ${bill.invoice_number}`).fill('300001');
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(`${bill.invoice_number}: more than the ${F.money(300_000)} still open`, { exact: false })).toBeVisible();
    const saved = ((await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')) as any[]).filter((d) => d.supplier_id === sup.code && d.memo === `Uji ${t}`);
    expect(saved).toHaveLength(0); // nothing was saved
  });

  test('"In full" fills the whole outstanding amount', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('I');
    const sup = await F.makeSupplier('bkk');
    const bill = await F.recordBill(sup, 250_000, { post: true });
    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, `Uji ${t}`);
    await screen.getByRole('checkbox', `${bill.invoice_number} in full`).check();
    await expect(screen.getByRole('textbox', `Paid on ${bill.invoice_number}`)).toHaveValue(/250\.000$/);
    await expect(screen.getByText(F.money(250_000)).first()).toBeVisible();
    await screen.getByRole('checkbox', `${bill.invoice_number} in full`).uncheck();
    await expect(screen.getByRole('textbox', `Paid on ${bill.invoice_number}`)).toHaveValue('');
  });
});

describe('BKK Settle list at scale', { tags: [...TAGS, 'bug'] }, () => {
  test('the Settle tab lists every open bill of the supplier however many bills the book holds (the form reads only the newest 200 bills of all suppliers)', { session: 'rina', tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    await F.ensureBank();
    const all = await F.cloud().get('/api/v1/finance/bills?limit=1');
    test.skip(all.total <= 200, 'the book holds 200 bills or fewer: the form\'s single page is the whole book');
    const t = F.tag('L');
    const sup = await F.makeSupplier('bkk');
    // the register is newest first and, within a day, by invoice number descending: this number sorts after the first 200 rows
    const bill = await F.recordBill(sup, 71_000, { post: true, invoice: `INV-000-${t}` });
    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, `Uji ${t}`);
    await expect(screen.getByRole('checkbox', `Settle ${bill.invoice_number}`), `${bill.invoice_number} is an open posted bill of ${sup.name}; the book holds ${all.total} bills`).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(`${F.money(await F.owed(sup.code))} open`), 'the "open" figure under the supplier is the supplier\'s whole payable').toBeVisible();
  });
});

describe('BKK posts', { tags: TAGS }, () => {
  test('settle a bill in full from the form: approved, posted, bill paid, supplier owed nothing, bank down by exactly the amount', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('P');
    const sup = await F.makeSupplier('bkk');
    const amount = F.amountOf();
    const bill = await F.recordBill(sup, amount, { post: true });
    const owed0 = await F.owed(sup.code);
    const before = await F.balance(F.BANK.account);

    await app.open('/finance/cash-bank/bkk/new');
    await F.onScreen(screen, 'New BKK');
    await header(screen, sup.name, `Bayar ${t}`);
    await screen.getByRole('checkbox', `${bill.invoice_number} in full`).check();
    await expect(screen.getByText(F.money(amount)).first()).toBeVisible();
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Settle bill')).toBeVisible();
    await screen.getByRole('button', 'Approve').tap();
    await expect(screen.getByRole('heading', { name: /^KK-\d\d-\d\d-\d{5}$/, level: 1 })).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 30_000 });

    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')).find((d: any) => d.memo === `Bayar ${t}`);
    expect(doc.status).toBe('POSTED');
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === '2002')).toMatchObject({ debit_minor: amount, party_id: sup.code });
    expect(e.lines.find((l) => l.account_code === F.BANK.account)).toMatchObject({ credit_minor: amount });
    const paid = await F.bill(bill.invoice_id);
    expect(paid.outstanding_minor).toBe(0);
    expect(owed0 - (await F.owed(sup.code))).toBe(amount);
    expect((await F.balance(F.BANK.account)) - before).toBe(-amount);
  });

  test('a part payment with a discount (POTONGAN): cash out is paid minus discount, the bill keeps the rest', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('D');
    const sup = await F.makeSupplier('bkk');
    const bill = await F.recordBill(sup, 1_000_000, { post: true });
    const before = await F.balance(F.BANK.account);

    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, `Cicil ${t}`);
    await screen.getByRole('checkbox', `Settle ${bill.invoice_number}`).check();
    await screen.getByRole('textbox', `Paid on ${bill.invoice_number}`).fill('300000');
    await screen.getByRole('textbox', `Discount on ${bill.invoice_number}`).fill('50000');
    await expect(screen.getByText(F.money(250_000)).first()).toBeVisible(); // the total box: 300.000 − 50.000
    await expect(screen.getByText(F.money(-50_000)).first()).toBeVisible();
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Approve').tap();
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 30_000 });

    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')).find((d: any) => d.memo === `Cicil ${t}`);
    expect(doc.amount_minor).toBe(250_000);
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(F.sum(e.lines.filter((l) => l.account_code === '2002'), 'debit_minor')).toBe(300_000);
    expect(e.lines.find((l) => l.account_code === F.BANK.account)).toMatchObject({ credit_minor: 250_000 });
    expect((await F.bill(bill.invoice_id)).outstanding_minor).toBe(700_000);
    expect((await F.balance(F.BANK.account)) - before).toBe(-250_000);
  });

  test('an Other line on a BKK books a cost against the bank (no bill to settle)', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('X');
    const sup = await F.makeSupplier('bkk-empty'); // never billed, so its Settle tab is empty
    const amount = F.amountOf(20, 200);
    const before = await F.balance(F.BANK.account);
    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, `Biaya ${t}`);
    await expect(screen.getByText(`${sup.name} has nothing open to settle.`, { exact: false })).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('tab', { name: /^Other lines/ }).tap();
    await screen.getByRole('row').nth(1).getByRole('textbox').first().fill('6004');
    await screen.getByRole('button', { name: /^6004/ }).tap();
    await screen.getByRole('textbox', 'Amount on row 1').fill(String(amount));
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Approve').tap();
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 30_000 });
    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')).find((d: any) => d.memo === `Biaya ${t}`);
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === '6004')).toMatchObject({ debit_minor: amount });
    expect((await F.balance(F.BANK.account)) - before).toBe(-amount);
  });

  test('reversing a posted BKK reopens the bill and returns the money to the bank', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('V');
    const sup = await F.makeSupplier('bkk');
    const amount = F.amountOf();
    const bill = await F.recordBill(sup, amount, { post: true });
    const before = await F.balance(F.BANK.account);
    const owedAll = await F.owed(sup.code);
    const d = await F.voucher({ direction: 'OUT', supplierCode: sup.code, party: sup.name, lines: [F.settleLine(bill.invoice_id, amount)] });
    await F.approveDoc(d.document_id);
    await F.postDoc(d.document_id);
    expect((await F.bill(bill.invoice_id)).outstanding_minor).toBe(0);

    await app.open(`/finance/cash-bank/bkk/${d.document_id}`);
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('textbox').last().fill(`Salah bayar ${t}`);
    await screen.getByRole('button', 'Reverse').tap();
    await expect(screen.getByText(/Reversed\. It stays in the books/)).toBeVisible({ timeout: 30_000 });
    expect((await F.bill(bill.invoice_id)).outstanding_minor).toBe(amount);
    expect(await F.owed(sup.code)).toBe(owedAll);
    expect(await F.balance(F.BANK.account)).toBe(before);
  });

  test('a giro BKK does not touch the bank yet: it sits on the Giro Board and the "outstanding giro" account carries it', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('G');
    const sup = await F.makeSupplier('bkk');
    const amount = F.amountOf();
    const bill = await F.recordBill(sup, amount, { post: true });
    const bankBefore = await F.balance(F.BANK.account);
    const giroBefore = await F.balance('2009');
    const giroNo = `BG${t}`;
    const due = F.dayOf(20);
    const d = await F.voucher({ direction: 'OUT', supplierCode: sup.code, party: sup.name, method: 'GIRO', giro: { number: giroNo, due }, lines: [F.settleLine(bill.invoice_id, amount)] });
    await F.approveDoc(d.document_id);
    const posted = await F.postDoc(d.document_id);
    const e = await F.entry(posted.journal_entry_id);
    F.expectBalanced(e.lines);
    expect((await F.balance(F.BANK.account)) - bankBefore).toBe(0);
    expect((await F.balance('2009')) - giroBefore).toBe(-amount);

    await app.open('/finance/cash-bank/giro');
    await F.onScreen(screen, 'Giro Board');
    await expect(screen.getByText(giroNo, { exact: false }).first()).toBeVisible({ timeout: 45_000 });
  });
});

describe('BKK Offset tab', { tags: [...TAGS, 'offset'], }, () => {
  test('an advance paid on a PO is netted off the bill it belongs to: the bank pays only the difference, the advance is used up and the bill is closed', { session: 'rina', timeout: 420_000 }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('V');
    const ctx = await F.deliveryItem(t);
    const po = await R.placePo(ctx as any, 40);
    const detail = await R.poDetail(po);
    const adv = await F.cloud().post('/api/v1/finance/supplier-advances', { purchase_order_id: detail.purchase_order_id, unit_id: 'ho', advance_date: F.today(), amount_minor: 200_000, account_key: 'bank_giro', account_qualifier: 'DANAMON', reference: `UM-${t}`, note: `uang muka ${t}` });
    await F.cloud().post(`/api/v1/finance/supplier-advances/${adv.advance_id}/post`, {});
    const garmen = { code: '0001', name: 'Garmen Nusantara' };
    const bill = await F.recordBill(garmen, 500_000, { post: true, invoice: `INV-${t}` });
    const before = await F.balance(F.BANK.account);

    await app.open('/finance/cash-bank/bkk/new');
    await F.onScreen(screen, 'New BKK');
    await header(screen, garmen.name, `Offset ${t}`);
    await screen.getByRole('checkbox', `${bill.invoice_number} in full`).check();
    await screen.getByRole('tab', { name: /^Offset receivables/ }).tap();
    await expect(screen.getByText('Advances already paid to', { exact: false })).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('checkbox', `Net off ${adv.advance_number}`).check();
    await expect(screen.getByRole('textbox', `Net off ${adv.advance_number}`)).toHaveValue(/200\.000$/);
    await expect(screen.getByText(F.money(300_000)).first()).toBeVisible(); // Total paid: 500.000 − 200.000
    await screen.getByRole('button', 'Save draft').tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Offset').first()).toBeVisible();
    await screen.getByRole('button', 'Approve').tap();
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KK-/)).toBeVisible({ timeout: 30_000 });

    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=300')).find((d: any) => d.memo === `Offset ${t}`);
    expect(doc.amount_minor).toBe(300_000);
    F.expectBalanced((await F.entry(doc.journal_entry_id)).lines);
    expect((await F.balance(F.BANK.account)) - before).toBe(-300_000);
    expect((await F.bill(bill.invoice_id)).outstanding_minor).toBe(0);
    const after = (await F.cloud().get('/api/v1/finance/supplier-advances?supplier=0001')).find((a: any) => a.advance_id === adv.advance_id);
    expect(after === undefined || after.outstanding_minor === 0, 'the advance has been used up').toBe(true);
  });

  test('a supplier with no advance says so on the Offset tab', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const sup = await F.makeSupplier('bkk-empty');
    await app.open('/finance/cash-bank/bkk/new');
    await header(screen, sup.name, 'tanpa uang muka');
    await screen.getByRole('tab', { name: /^Offset receivables/ }).tap();
    await expect(screen.getByText(`${sup.name} has no advance left to net off.`)).toBeVisible({ timeout: 30_000 });
  });
});
