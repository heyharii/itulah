// Journal Entry: the register, writing an entry by hand (balanced or not), reversing it, and the refusals the books keep.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'journal'];
const DEBIT = '1054'; // Advanced - Others
const CREDIT = '2031'; // Hutang Lain - Lain

describe('Journal Entry register', { tags: TAGS }, () => {
  test('it lists entries with Entry · Posted · Source · Memo · Answered · Lines · Total, filters by type and finds a memo by search', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const t = F.tag('J');
    const amount = F.amountOf();
    const posted = await F.manualEntry(DEBIT, CREDIT, amount, `Daftar ${t}`);
    await app.open('/finance/accounting/journal-entries');
    await F.onScreen(screen, 'Journal Entry');
    await expect(screen.getByRole('button', 'New entry').first()).toBeVisible();
    await F.expectHeads(screen, ['Date', 'Entry', 'Memo', 'Type', 'Posted by', 'Total debit', 'Status']);
    await screen.getByRole('textbox', 'Search entries').first().fill(`Daftar ${t}`);
    const row = F.rowOf(screen, posted.entry_number);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toContainText('Manual · by hand');
    await expect(row).toContainText(F.money(amount));
    await expect(row).toContainText('Posted');
    // the kinds on offer follow what the search leaves, so clear it to see more than Manual
    await F.pick(screen, 'Entry type', /^Manual/);
    await expect(F.rowOf(screen, posted.entry_number)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('textbox', 'Search entries').first().fill('');
    await screen.getByRole('combobox', 'Entry type').tap();
    await screen.getByRole('option').filter({ hasText: /Goods|Supplier|Credit|Payment|Depreciation|Reversal/i }).first().tap();
    await screen.getByRole('textbox', 'Search entries').first().fill(`Daftar ${t}`);
    await expect(F.rowOf(screen, posted.entry_number)).toBeHidden({ timeout: 30_000 });
  });

  test('opening an entry shows its lines and the balanced totals', { session: 'rina' }, async ({ app, screen }) => {
    const amount = F.amountOf();
    const posted = await F.manualEntry(DEBIT, CREDIT, amount, `Lihat ${F.tag('V')}`);
    await app.open(`/finance/accounting/journal-entries?entry=${posted.entry_id}`);
    await expect(screen.getByText(posted.entry_number).first()).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(DEBIT).first()).toBeVisible();
    await expect(screen.getByText(CREDIT).first()).toBeVisible();
    await expect(screen.getByText(F.money(amount)).first()).toBeVisible();
    await expect(screen.getByRole('button', 'Reverse')).toBeDisabled(); // needs a reason
  });
});

describe('writing an entry by hand', { tags: TAGS }, () => {
  test('two balanced rows post as JV-…: the footer says "Balanced at Rp N", the books move by exactly the amount', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const t = F.tag('W');
    const amount = F.amountOf();
    const d0 = await F.balance(DEBIT);
    const c0 = await F.balance(CREDIT);

    await app.open('/finance/accounting/journal-entries');
    await screen.getByRole('button', 'New entry').first().tap();
    await expect(screen.getByText('New journal entry')).toBeVisible();
    await expect(screen.getByRole('button', 'Post entry')).toBeDisabled();
    await expect(screen.getByText('No usable row yet', { exact: false })).toBeVisible();
    await screen.getByRole('textbox', { name: /^Memo/ }).fill(`Tangan ${t}`);
    const rows = screen.getByRole('row');
    await rows.nth(1).getByRole('textbox').first().fill(DEBIT);
    await screen.getByRole('button', { name: new RegExp('^' + DEBIT) }).tap();
    await rows.nth(2).getByRole('textbox').first().fill(CREDIT);
    await screen.getByRole('button', { name: new RegExp('^' + CREDIT) }).tap();
    await screen.getByRole('textbox', 'Debit on row 1').fill(String(amount));
    await screen.getByRole('textbox', 'Credit on row 2').fill(String(amount));
    for (const unit of await screen.getByRole('combobox', 'Unit').all()) {
      await unit.tap();
      await screen.getByRole('option', { name: /Head Office/ }).first().tap();
      await expect(screen.getByRole('option', { name: /Head Office/ })).toBeHidden({ timeout: 10_000 }); // the list has closed before the next row's opens
    }
    await expect(screen.getByText('Balanced at ' + F.money(amount))).toBeVisible();
    await screen.getByRole('button', 'Post entry').tap();
    await expect(screen.getByText(/Posted as JV-\d+/)).toBeVisible({ timeout: 30_000 });

    const e = (await F.cloud().get(`/api/v1/finance/journal?q=${encodeURIComponent('Tangan ' + t)}`)).rows[0];
    expect(e).toMatchObject({ source_kind: 'MANUAL', total_minor: amount });
    const lines = (await F.entry(e.entry_id)).lines;
    F.expectBalanced(lines);
    expect(lines.find((l) => l.account_code === DEBIT)).toMatchObject({ debit_minor: amount });
    expect(lines.find((l) => l.account_code === CREDIT)).toMatchObject({ credit_minor: amount });
    expect((await F.balance(DEBIT)) - d0).toBe(amount);
    expect((await F.balance(CREDIT)) - c0).toBe(-amount);
  });

  test('an unbalanced entry cannot be posted: the footer shows both sides and Post entry stays disabled', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/accounting/journal-entries');
    await screen.getByRole('button', 'New entry').first().tap();
    const rows = screen.getByRole('row');
    await rows.nth(1).getByRole('textbox').first().fill(DEBIT);
    await screen.getByRole('button', { name: new RegExp('^' + DEBIT) }).tap();
    await rows.nth(2).getByRole('textbox').first().fill(CREDIT);
    await screen.getByRole('button', { name: new RegExp('^' + CREDIT) }).tap();
    for (const unit of await screen.getByRole('combobox', 'Unit').all()) {
      await unit.tap();
      await screen.getByRole('option', { name: /Head Office/ }).first().tap();
      await expect(screen.getByRole('option', { name: /Head Office/ })).toBeHidden({ timeout: 10_000 }); // the list has closed before the next row's opens
    }
    await screen.getByRole('textbox', 'Debit on row 1').fill('100000');
    await screen.getByRole('textbox', 'Credit on row 2').fill('90000');
    await expect(screen.getByText(`Debits ${F.money(100_000)} · credits ${F.money(90_000)}`)).toBeVisible();
    await expect(screen.getByRole('button', 'Post entry')).toBeDisabled();
    await screen.getByRole('button', 'Add row').tap();
    await expect(screen.getByRole('button', 'Remove row 3')).toBeVisible();
    await screen.getByRole('button', 'Remove row 3').tap();
    await expect(screen.getByRole('button', 'Remove row 3')).toBeHidden();
  });

  test('the books refuse what the form cannot see: a heading account, a month with no period, a one-sided entry', { session: 'rina' }, async () => {
    const heading = await F.manualEntry('2000', CREDIT, 5_000, 'heading');
    expect(heading.error).toMatch(/heading/);
    const sept = await F.manualEntry(DEBIT, CREDIT, 5_000, 'sept', '2026-09-10');
    expect(sept.error).toMatch(/period/i);
    const oneSided = await F.cloud().call('POST', '/api/v1/finance/journal', { posting_date: F.today(), currency: 'IDR', memo: 'one', lines: [{ account: { kind: 'account', account_code: DEBIT }, unit_id: 'ho', debit_minor: 5_000, credit_minor: 0 }] }, { ok: false });
    expect(oneSided.error).toBeTruthy();
  });
});

describe('reversing an entry', { tags: TAGS }, () => {
  test('Reverse posts a mirror, marks the original Reversed and returns both balances', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('X');
    const amount = F.amountOf();
    const d0 = await F.balance(DEBIT);
    const c0 = await F.balance(CREDIT);
    const posted = await F.manualEntry(DEBIT, CREDIT, amount, `Balik ${t}`);
    expect((await F.balance(DEBIT)) - d0).toBe(amount);

    await app.open(`/finance/accounting/journal-entries?entry=${posted.entry_id}`);
    await expect(screen.getByText('This posts a new entry with the debits and credits exchanged', { exact: false })).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('textbox').last().fill(`Salah akun ${t}`);
    await screen.getByRole('button', 'Reverse').tap();
    await expect(screen.getByText(/Reversed by JV-\d+/)).toBeVisible({ timeout: 30_000 });

    const original = (await F.entry(posted.entry_id)).entry;
    expect(original.reversed_by).toBeTruthy();
    const mirror = await F.entry(original.reversed_by);
    F.expectBalanced(mirror.lines);
    expect(mirror.lines.find((l) => l.account_code === DEBIT)).toMatchObject({ credit_minor: amount });
    expect(mirror.entry.reversal_of).toBe(posted.entry_id);
    expect(await F.balance(DEBIT)).toBe(d0);
    expect(await F.balance(CREDIT)).toBe(c0);

    // the sheet of a reversed entry no longer offers Reverse
    await app.open(`/finance/accounting/journal-entries?entry=${posted.entry_id}`);
    await expect(screen.getByText('Already reversed. It stays in the books up to the date its reversal was posted.')).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('button', 'Reverse')).toBeHidden();
  });

  test('an entry that was already reversed cannot be reversed twice', { session: 'rina' }, async () => {
    const posted = await F.manualEntry(DEBIT, CREDIT, 9_000, `Dua ${F.tag('D')}`);
    await F.cloud().post(`/api/v1/finance/journal/${posted.entry_id}/reverse`, { reason: 'pertama' });
    const again = await F.cloud().call('POST', `/api/v1/finance/journal/${posted.entry_id}/reverse`, { reason: 'kedua' }, { ok: false });
    expect(again.error).toBeTruthy();
  });
});
