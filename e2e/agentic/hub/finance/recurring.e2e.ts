// Recurring things: Recurring Journal (templates + schedules + run due), Recurring Bills (the monthly promise), and repeating BKK/BKM.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'recurring'];

describe('Recurring Journal', { tags: TAGS }, () => {
  test('a template with a schedule shows its schedule and last run; "Run due now" raises it, posts it balanced, and moves the date on a month', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const t = F.tag('Q');
    const amount = F.amountOf(10, 80);
    const tpl = await F.makeTemplate(`Rutin ${t}`, `bulanan ${t}`, [F.templateLine('1054', amount, 0), F.templateLine('2031', 0, amount)]);
    const rep = await F.scheduleTemplate(tpl.template_id, F.dayOf(-1), true); // yesterday: due on the server's clock whatever the hour
    const d0 = await F.balance('1054');

    await app.open('/finance/setup/journal-templates');
    await F.onScreen(screen, 'Recurring Journal');
    await F.expectHeads(screen, ['Journal', 'Schedule', 'Last run']);
    const row = F.rowOf(screen, `Rutin ${t}`);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toContainText('Never');
    await screen.getByRole('button', { name: /^Run \d+ due now$/ }).tap();
    await expect(row).not.toContainText('Never', { timeout: 30_000 });

    const after = (await F.cloud().get('/api/v1/finance/journal-repeats')).find((r: any) => r.repeat_id === rep.repeat_id);
    const due = F.dayOf(-1);
    const nextMonth = `${due.slice(0, 5)}${String(Number(due.slice(5, 7)) + 1).padStart(2, '0')}${due.slice(7)}`;
    expect(after.last_run_on).toBeTruthy();
    expect(after.next_date, 'the date moves on one month from the date it was due').toBe(nextMonth);
    const e = (await F.cloud().get(`/api/v1/finance/journal?q=${encodeURIComponent('bulanan ' + t)}`)).rows;
    expect(e).toHaveLength(1);
    F.expectBalanced((await F.entry(e[0].entry_id)).lines);
    expect((await F.balance('1054')) - d0).toBe(amount);
  });

  test('"Add a schedule" on a template: pick the template, a next date, Post it automatically — the repeat is saved', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('S');
    const tpl = await F.makeTemplate(`Jadwal ${t}`, `jadwal ${t}`, [F.templateLine('1054', 7_000, 0), F.templateLine('2031', 0, 7_000)]);
    await app.open('/finance/setup/journal-templates');
    const row = F.rowOf(screen, `Jadwal ${t}`);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await row.getByText('Add a schedule').tap();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
    await F.pickDay(screen, /Next date/, 'besok');
    await screen.getByRole('checkbox', 'Post it automatically').check();
    await screen.getByRole('button', 'Submit').tap();
    await expect(row.getByText('Add a schedule')).toBeHidden({ timeout: 30_000 });
    await expect.poll(async () => ((await F.cloud().get('/api/v1/finance/journal-repeats')) as any[]).some((r) => r.template_id === tpl.template_id), { timeout: 30_000 }).toBe(true);
    const rep = (await F.cloud().get('/api/v1/finance/journal-repeats')).find((r: any) => r.template_id === tpl.template_id);
    expect(rep).toMatchObject({ frequency: 'MONTHLY', auto_post: true, is_active: true });
    expect(rep.next_date > F.today()).toBe(true);
  });

  test('a repeat that is not due is left alone by "Run due now"', { session: 'rina' }, async () => {
    const t = F.tag('N');
    const tpl = await F.makeTemplate(`Nanti ${t}`, `nanti ${t}`, [F.templateLine('1054', 5_000, 0), F.templateLine('2031', 0, 5_000)]);
    const next = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const rep = await F.scheduleTemplate(tpl.template_id, next, true);
    await F.cloud().post('/api/v1/finance/journal-repeats/run', {});
    const after = (await F.cloud().get('/api/v1/finance/journal-repeats')).find((r: any) => r.repeat_id === rep.repeat_id);
    expect(after.last_run_on).toBeNull();
    expect(after.next_date).toBe(next);
  });
});

describe('Recurring Bills', { tags: TAGS }, () => {
  test('New recurring bill: label, supplier, unit, expense account, day of the month and the expected amount — it is listed and then retired', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('B');
    const sup = await F.makeSupplier('recurring');
    await app.open('/finance/payables/recurring-bills');
    await F.onScreen(screen, 'Recurring Bills');
    await screen.getByRole('button', 'New recurring bill').first().tap();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await screen.getByRole('textbox', { name: /^Label/ }).fill(`Sewa ${t}`);
    await F.pickSupplier(screen, sup.name);
    await F.pick(screen, /^Unit/, /Head Office|HO|Gudang/);
    await screen.getByRole('textbox', { name: /^Expense account/ }).fill('6004');
    await screen.getByRole('button', { name: /^6004/ }).tap();
    await screen.getByRole('textbox', { name: /^Every month on day/ }).fill('40');
    await expect(screen.getByText('A day of the month, 1 to 31.')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Every month on day/ }).fill('15');
    await screen.getByRole('textbox', { name: /^Expected amount before tax/ }).fill('750000');
    await expect(submit).toBeEnabled();
    await submit.tap();
    const row = F.rowOf(screen, `Sewa ${t}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(F.money(750_000));
    await expect(row).toContainText('15');
    const tpl = (await F.cloud().get('/api/v1/finance/bill-templates')).find((b: any) => b.label === `Sewa ${t}`);
    expect(tpl).toMatchObject({ due_day: 15, expected_subtotal_minor: 750_000, supplier_id: sup.code, active: true });

    await row.tap();
    await screen.getByRole('button', 'Retire').tap();
    await screen.getByRole('dialog', 'Retire this recurring bill?').getByRole('button', 'Retire').tap();
    await expect(F.rowOf(screen, `Sewa ${t}`)).toBeHidden({ timeout: 30_000 });
    await expect.poll(async () => ((await F.cloud().get('/api/v1/finance/bill-templates')) as any[]).find((b) => b.label === `Sewa ${t}`).active, { timeout: 30_000 }).toBe(false);
  });
});

describe('repeating BKK / BKM', { tags: TAGS }, () => {
  test('a posted BKM made of Other lines can be repeated: Repeat… saves it with its frequency and next date', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('E');
    const d = await F.voucher({ direction: 'IN', party: `Ulang ${t}`, memo: `ulang ${t}`, lines: [F.otherLine('2031', 21_000)] });
    await F.approveDoc(d.document_id);
    await F.postDoc(d.document_id);
    await app.open(`/finance/cash-bank/bkm/${d.document_id}`);
    await screen.getByRole('button', 'Repeat…').tap();
    await expect(screen.getByText('Repeat this BKM')).toBeVisible();
    await F.pickDay(screen, /Next date|^\d\d \w{3} \d{4}$/, 'besok');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Repeat started')).toBeVisible({ timeout: 30_000 });
    const repeat = (await F.cloud().get('/api/v1/finance/cash-document-repeats?direction=IN')).find((r: any) => r.party_name === `Ulang ${t}`);
    expect(repeat).toMatchObject({ amount_minor: 21_000, frequency: 'MONTHLY', is_active: true });
    expect(repeat.next_date > F.today()).toBe(true);
    await app.open('/finance/cash-bank/bkm');
    await expect(F.rowOf(screen, `Ulang ${t}`).last()).toBeVisible({ timeout: 45_000 });
  });

  test('"Raise due now" drafts the BKM of a repeat that is due, and says it still needs approving and posting', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('R');
    const body = F.voucherBody({ direction: 'IN', party: `Rutin ${t}`, memo: `rutin ${t}`, lines: [F.otherLine('2031', 22_000)] });
    delete body.doc_date;
    await F.cloud().post('/api/v1/finance/cash-document-repeats', { repeat_id: null, name: `Rutin ${t}`, voucher: body, frequency: 'MONTHLY', next_date: F.dayOf(-1), end_date: null, is_active: true });
    await app.open('/finance/cash-bank/bkm');
    await expect(screen.getByRole('button', 'Raise due now')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Raise due now').tap();
    await expect(screen.getByText(/drafts? raised — each still needs approving and posting\./)).toBeVisible({ timeout: 30_000 });
    const drafts = (await F.cloud().get('/api/v1/finance/cash-documents?kind=RECEIVE&status=DRAFT&limit=200')).filter((x: any) => x.party_name === `Rutin ${t}`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].amount_minor).toBe(22_000);
  });
});
