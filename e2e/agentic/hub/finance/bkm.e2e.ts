// BKM (Bukti Kas Masuk) — money in: the register, the Klasik form, draft → approve → post → reverse, and what each step does to the books.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'bkm'];
const COUNTER = '2031'; // Hutang Lain - Lain: a postable liability nobody else books

describe('BKM register and form', { tags: TAGS }, () => {
  test('the register lists BKM with its status filter and the New BKM button', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.ensureBank();
    const d = await F.voucher({ direction: 'IN', party: 'Reg Uji', memo: 'registrasi', lines: [F.otherLine(COUNTER, 11_000)] });
    await app.open('/finance/cash-bank/bkm');
    await F.onScreen(screen, 'BKM');
    await expect(screen.getByRole('button', 'New BKM')).toBeVisible();
    await expect(screen.getByRole('combobox', 'Status')).toBeVisible();
    await F.expectHeads(screen, ['Number', 'Date', 'Customer', 'Cash / bank', 'Amount', 'Status']);
    await expect(F.rowOf(screen, 'Reg Uji').first()).toContainText('Draft');
    await expect(F.rowOf(screen, 'Reg Uji').first()).toContainText('DANAMON');
    expect(d.status).toBe('DRAFT');
  });

  test('New BKM opens the Klasik form: header, three tabs, total box', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bkm/new');
    await F.onScreen(screen, 'New BKM');
    for (const l of ['Voucher no', 'Date', 'Cash / bank', 'Reference', 'Unit', 'Customer', 'Paid by', 'Note', 'Total received']) await expect(screen.getByText(new RegExp('^' + l)).first()).toBeVisible();
    for (const tab of ['Settle invoices', 'Other lines', 'Offset payables']) await expect(screen.getByRole('tab', { name: new RegExp('^' + tab) })).toBeVisible();
    await expect(screen.getByRole('button', 'Save draft')).toBeVisible();
    await expect(screen.getByRole('button', 'Replace a bounced giro')).toBeDisabled();
  });

  test('Save draft on an empty form lists every missing answer in one banner', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bkm/new');
    await F.onScreen(screen, 'New BKM');
    await screen.getByRole('button', 'Save draft').tap();
    const banner = screen.getByText(/choose a unit/);
    await expect(banner).toBeVisible();
    for (const part of ['choose the cash or bank account', 'name who the money is from', 'add a note — it is printed on the slip', 'nothing to receive yet — add a line']) await expect(screen.getByText(part, { exact: false }).first()).toBeVisible();
  });

  test('Paid by Giro asks for the giro number, the due date and the bank it is drawn on', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bkm/new');
    await F.onScreen(screen, 'New BKM');
    await expect(screen.getByRole('textbox', { name: /^Giro no/ })).toBeHidden();
    await screen.getByRole('button', 'Giro').tap();
    await expect(screen.getByRole('textbox', { name: /^Giro no/ })).toBeVisible();
    await expect(screen.getByText(/^Due/).first()).toBeVisible();
    await expect(screen.getByRole('textbox', { name: /^Drawn on/ })).toBeVisible();
    await screen.getByRole('button', 'Save draft').tap();
    for (const part of ['a giro needs its number', 'a giro needs its due date', 'which bank the giro is drawn on']) await expect(screen.getByText(part, { exact: false }).first()).toBeVisible();
    await screen.getByRole('button', { name: /^Paid by/ }).tap(); // the first segment (Cash) is named after the whole "Paid by" label: a <label> wrapping three buttons
    await expect(screen.getByRole('textbox', { name: /^Giro no/ })).toBeHidden();
  });

  test('the Settle invoices tab explains that a BKM has nothing to settle', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bkm/new');
    await screen.getByRole('tab', { name: /^Settle invoices/ }).tap();
    await expect(screen.getByText("No open invoices to settle. Money that isn't for an invoice goes on Other lines.")).toBeVisible();
    await expect(screen.getByRole('button', 'Browse open invoices')).toBeDisabled();
  });
});

describe('BKM on a phone', { tags: [...TAGS, 'phone'] }, () => {
  test('the register is a list of cards (party, amount, date, status) with the round New BKM button; a card opens the document', { session: 'rina' }, async ({ app, screen, browser }) => {
    await F.ensureBank();
    const t = F.tag('H');
    const d = await F.voucher({ direction: 'IN', party: `Hp ${t}`, memo: `hp ${t}`, lines: [F.otherLine(COUNTER, 16_000)] });
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/finance/cash-bank/bkm');
    await expect(screen.getByText(`Hp ${t}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('button', 'Add New BKM')).toBeVisible();
    await screen.getByText(`Hp ${t}`).tap();
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('button', 'Approve')).toBeVisible();
    expect(d.status).toBe('DRAFT');
  });
});

describe('BKM life', { tags: TAGS }, () => {
  test('key it in the form, approve it, post it: numbered KM-, one balanced entry, the bank rises by exactly the amount', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('M');
    const amount = F.amountOf();
    const before = await F.balance(F.BANK.account);

    await app.open('/finance/cash-bank/bkm/new');
    await F.onScreen(screen, 'New BKM');
    await F.pick(screen, /^Unit/, /Head Office/);
    await F.pick(screen, /^Cash \/ bank/, /DANAMON/);
    await screen.getByRole('textbox', { name: /^Customer/ }).fill(`Pelanggan ${t}`);
    await screen.getByRole('textbox', { name: /^Note(?! on row)/ }).fill(`Uji ${t}`);
    await screen.getByRole('tab', { name: /^Other lines/ }).tap();
    const accountBox = screen.getByRole('row').nth(1).getByRole('textbox').first();
    await accountBox.fill(COUNTER);
    await screen.getByRole('button', { name: new RegExp('^' + COUNTER) }).tap();
    await screen.getByRole('textbox', 'Note on row 1').fill('uji');
    await screen.getByRole('textbox', 'Amount on row 1').fill(String(amount));
    await expect(screen.getByText(F.money(amount)).first()).toBeVisible();
    await screen.getByRole('button', 'Save draft').tap();

    // the document page: a DRAFT, unnumbered, waiting for its approval
    await expect(screen.getByText(/Approving takes the next number/)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Approve').tap();
    await expect(screen.getByRole('button', 'Post to the books')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', { name: /^KM-\d\d-\d\d-\d{5}$/, level: 1 })).toBeVisible();
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText(/Posted as KM-/)).toBeVisible({ timeout: 30_000 });

    // the books: find our document through the API and prove the entry
    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=RECEIVE&limit=100')).find((d: any) => d.party_name === `Pelanggan ${t}`);
    expect(doc.status).toBe('POSTED');
    expect(doc.number).toMatch(/^KM-26-10-\d{5}$/);
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === F.BANK.account)).toMatchObject({ debit_minor: amount, credit_minor: 0 });
    expect(e.lines.find((l) => l.account_code === COUNTER)).toMatchObject({ credit_minor: amount, debit_minor: 0 });
    expect((await F.balance(F.BANK.account)) - before).toBe(amount);
  });

  test('reverse a posted BKM: a mirror entry, the document is Reversed, the bank is back where it was', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('R');
    const amount = F.amountOf();
    const before = await F.balance(F.BANK.account);
    const d = await F.voucher({ direction: 'IN', party: `Pel ${t}`, lines: [F.otherLine(COUNTER, amount)] });
    await F.approveDoc(d.document_id);
    const posted = await F.postDoc(d.document_id);
    expect((await F.balance(F.BANK.account)) - before).toBe(amount);

    await app.open(`/finance/cash-bank/bkm/${d.document_id}`);
    await expect(screen.getByText(/Posted as KM-/)).toBeVisible({ timeout: 45_000 });
    const reverse = screen.getByRole('button', 'Reverse');
    await expect(reverse).toBeDisabled(); // no reason yet
    await screen.getByRole('textbox').filter({ hasText: '' }).last().fill(`Salah catat ${t}`);
    await expect(reverse).toBeEnabled();
    await reverse.tap();
    await expect(screen.getByText(/Reversed\. It stays in the books/)).toBeVisible({ timeout: 30_000 });

    const after = await F.cashDoc(d.document_id);
    expect(after.status).toBe('REVERSED');
    expect(after.reversal_entry_id).toBeTruthy();
    const mirror = await F.entry(after.reversal_entry_id);
    F.expectBalanced(mirror.lines);
    expect(mirror.lines.find((l) => l.account_code === F.BANK.account)).toMatchObject({ credit_minor: amount });
    expect(await F.balance(F.BANK.account)).toBe(before);
    expect(posted.status).toBe('POSTED');
  });

  test('a BKM dated in a month with no accounting period cannot be posted: the refusal is read on the page', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const d = await F.voucher({ direction: 'IN', party: `Sep ${F.tag('P')}`, date: '2026-09-15', lines: [F.otherLine(COUNTER, 12_000)] });
    await F.approveDoc(d.document_id);
    await app.open(`/finance/cash-bank/bkm/${d.document_id}`);
    await screen.getByRole('button', 'Post to the books').tap();
    await expect(screen.getByText('no accounting period exists for 2026-09; open it before posting', { exact: false })).toBeVisible({ timeout: 30_000 });
    expect((await F.cashDoc(d.document_id)).status).toBe('APPROVED');
  });

  test('the register filters by status', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('S');
    const draft = await F.voucher({ direction: 'IN', party: `Draf ${t}`, lines: [F.otherLine(COUNTER, 13_000)] });
    const done = await F.voucher({ direction: 'IN', party: `Beres ${t}`, lines: [F.otherLine(COUNTER, 14_000)] });
    await F.approveDoc(done.document_id);
    await F.postDoc(done.document_id);
    await app.open('/finance/cash-bank/bkm');
    await expect(F.rowOf(screen, `Draf ${t}`)).toBeVisible({ timeout: 45_000 });
    await F.pick(screen, 'Status', 'Posted');
    await expect(F.rowOf(screen, `Beres ${t}`)).toBeVisible();
    await expect(F.rowOf(screen, `Draf ${t}`)).toBeHidden();
    await F.pick(screen, 'Status', 'Draft');
    await expect(F.rowOf(screen, `Draf ${t}`)).toBeVisible();
    await expect(F.rowOf(screen, `Beres ${t}`)).toBeHidden();
    expect(draft.status).toBe('DRAFT');
  });
});
