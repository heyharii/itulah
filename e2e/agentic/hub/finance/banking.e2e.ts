// Banking: Bank Account, Bank Transactions (upload a statement), Bank Reconciliation (confirm a pair, accept a rule's proposal), Bank Rules, and the Bank Reconciliation Summary.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'banking'];
const COUNTER = '2031';

/** A posted BKM of `amount` into the Danamon bank, and a statement of it plus a bank-charge line. */
async function banked(t: string, amount: number) {
  await F.ensureBank();
  const d = await F.voucher({ direction: 'IN', party: `Bank ${t}`, memo: `bank ${t}`, lines: [F.otherLine(COUNTER, amount)] });
  await F.approveDoc(d.document_id);
  const posted = await F.postDoc(d.document_id);
  // the matcher compares the bank's reference with the entry number (JV-…): exact amount (50) + same day (25) + reference (30) clears the 90 needed to pair on its own
  const st = await F.importStatement([
    { date: F.today(), description: `SETORAN ${t}`, reference: posted.entry_number, credit: amount },
    { date: F.today(), description: `BIAYA ADM ${t}`, debit: 6_500 },
  ]);
  return { d, posted, st };
}

describe('Bank Account', { tags: TAGS }, () => {
  test('our bank accounts are listed per unit with the bank and the number; the Danamon account of the e2e is described', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await F.ensureBank();
    await app.open('/finance/cash-bank/bank-accounts');
    await F.onScreen(screen, 'Bank Account');
    await expect(screen.getByText('Cash & bank balance')).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText('Going out · next 30 days')).toBeVisible();
    await expect(screen.getByText('Giros not cleared')).toBeVisible();
    await expect(screen.getByRole('columnheader', 'Account')).toBeVisible();
    const row = F.rowOf(screen, '9900112233');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Danamon');
    const api = (await F.cloud().get('/api/v1/finance/bank-accounts')).find((a: any) => a.ledger_account_code === '1009');
    expect(api).toMatchObject({ account_no: '9900112233', unit_id: 'ho', status: 'ACTIVE', is_primary: false });
  });
});

describe('Bank Transactions', { tags: TAGS }, () => {
  test('Upload statement: account, unit, period, balances and pasted lines — the lines land Unreconciled', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('U');
    await app.open('/finance/cash-bank/bank-transactions');
    await F.onScreen(screen, 'Bank Transactions');
    await screen.getByRole('button', 'Upload statement').first().tap();
    await expect(screen.getByText('Upload a bank statement')).toBeVisible();
    const upload = screen.getByRole('button', 'Upload');
    await expect(upload).toBeDisabled();
    await screen.getByRole('textbox').first().fill('1009');
    await screen.getByRole('button', { name: /^1009/ }).tap();
    await F.pick(screen, /^Unit/, /Head Office/);
    await screen.getByRole('textbox', { name: /^Source/ }).fill(`e2e ${t}`);
    await F.pickDay(screen, /^Period start/, 'hari ini');
    await screen.getByRole('textbox', { name: /^Opening balance/ }).fill('0');
    await screen.getByRole('textbox', { name: /^Closing balance/ }).fill('9000');
    await screen.getByRole('textbox', { name: /^Lines/ }).fill(`${F.today()},TRF MASUK ${t},R1,,12000\n${F.today()},ADM ${t},R2,3000,`);
    await expect(screen.getByText('2 lines read')).toBeVisible();
    await expect(upload).toBeEnabled();
    await upload.tap();
    await expect(F.rowOf(screen, `TRF MASUK ${t}`)).toBeVisible({ timeout: 30_000 });
    await expect(F.rowOf(screen, `TRF MASUK ${t}`)).toContainText('Not matched yet');
    const lines = (await F.cloud().get('/api/v1/finance/bank-statements')).rows[0];
    expect(lines.line_count).toBe(2);
    expect(lines.account_code).toBe('1009');
  });

  test('a row that cannot be read is reported and not counted; the Status filter separates reconciled from unreconciled lines', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('B');
    await banked(t, 18_000);
    await app.open('/finance/cash-bank/bank-transactions');
    await screen.getByRole('textbox', 'Search bank transactions').fill(t);
    await expect(F.rowOf(screen, `SETORAN ${t}`)).toBeVisible({ timeout: 45_000 });
    await F.pick(screen, 'Status', 'Reconciled');
    await expect(F.rowOf(screen, `SETORAN ${t}`)).toBeHidden({ timeout: 30_000 });
    await F.pick(screen, 'Status', 'Unreconciled');
    await expect(F.rowOf(screen, `SETORAN ${t}`)).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Upload statement').first().tap();
    await screen.getByRole('textbox', { name: /^Lines/ }).fill('tanggal-salah,abc,,100,');
    await expect(screen.getByText('Line 1: "tanggal-salah" is not a YYYY-MM-DD date.')).toBeVisible();
    await expect(screen.getByText('Nothing to load yet')).toBeVisible();
  });
});

describe('Bank Reconciliation', { tags: TAGS }, () => {
  test('an exact pair is offered with its reasons; Confirm agrees it and the statement line reads Agreed', { session: 'rina', tags: [...TAGS, 'smoke'], timeout: 360_000 }, async ({ app, screen }) => {
    const t = F.tag('R');
    const amount = F.amountOf(20, 400);
    const { st } = await banked(t, amount);
    await app.open('/finance/cash-bank/bank-reconciliation');
    await F.onScreen(screen, 'Bank Reconciliation');
    const row = F.rowOf(screen, 'Danamon');
    await expect(row.first()).toBeVisible({ timeout: 60_000 });
    await row.first().getByRole('button').last().tap();
    await expect(screen.getByRole('button', 'All accounts')).toBeVisible({ timeout: 45_000 });
    const pair = F.rowOf(screen, `SETORAN ${t}`);
    await expect(pair).toBeVisible({ timeout: 45_000 });
    await expect(pair).toContainText('Exact');
    await expect(pair).toContainText('amount matches exactly');
    await pair.getByRole('button', 'Confirm').tap();
    await expect(F.rowOf(screen, `SETORAN ${t}`)).toContainText('Agreed', { timeout: 30_000 });
    const lines = await F.cloud().get(`/api/v1/finance/bank-statements/${st.statement_id}/lines`);
    const line = lines.find((l: any) => l.description === `SETORAN ${t}`);
    expect(line.matched_journal_line_id).toBeTruthy();
    expect(line.unallocated_minor).toBe(0);
    // Undo takes it back
    await F.rowOf(screen, `SETORAN ${t}`).getByRole('button', 'Undo').tap();
    await expect(F.rowOf(screen, `SETORAN ${t}`)).toContainText('Exact', { timeout: 30_000 });
  });

  test('a rule\'s proposal turns a bank-only charge into a posted BKK: Dr bank charges / Cr bank, matched to the line', { session: 'rina', timeout: 360_000 }, async ({ app, screen }) => {
    const t = F.tag('P');
    const { st } = await banked(t, 25_000);
    await F.cloud().post('/api/v1/finance/bank-rules/evaluate', {});
    const before = await F.balance(F.BANK.account);
    await app.open('/finance/cash-bank/bank-reconciliation');
    await F.rowOf(screen, 'Danamon').first().getByRole('button').last().tap();
    await expect(screen.getByText(`BIAYA ADM ${t}`)).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', { name: /^Create BKK — Bank charges/ }).tap();
    await expect(screen.getByRole('button', { name: /^Create BKK — Bank charges/ })).toBeHidden({ timeout: 30_000 });
    const line = (await F.cloud().get(`/api/v1/finance/bank-statements/${st.statement_id}/lines`)).find((l: any) => l.description === `BIAYA ADM ${t}`);
    expect(line.matched_journal_line_id).toBeTruthy();
    const doc = (await F.cloud().get('/api/v1/finance/cash-documents?kind=PAY&limit=100')).find((x: any) => x.statement_line_id === line.line_id);
    expect(doc.status).toBe('POSTED');
    expect(doc.amount_minor).toBe(6_500);
    const e = await F.entry(doc.journal_entry_id);
    F.expectBalanced(e.lines);
    expect(e.lines.find((l) => l.account_code === '6043')).toMatchObject({ debit_minor: 6_500 });
    expect((await F.balance(F.BANK.account)) - before).toBe(-6_500);
  });

  test('a bank-only line with no rule can be booked by hand: pick the account, say why, Create BKK', { session: 'rina', timeout: 360_000 }, async ({ app, screen }) => {
    const t = F.tag('H');
    await F.ensureBank();
    const st = await F.importStatement([{ date: F.today(), description: `DENDA ${t}`, debit: 4_000 }]);
    await app.open('/finance/cash-bank/bank-reconciliation');
    await F.rowOf(screen, 'Danamon').first().getByRole('button').last().tap();
    await expect(screen.getByText(`DENDA ${t}`)).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Create BKK').tap();
    await screen.getByRole('textbox').first().fill('6004');
    await screen.getByRole('button', { name: /^6004/ }).tap();
    await screen.getByRole('textbox', { name: /^Why this account/ }).fill(`Denda uji ${t}`);
    await screen.getByRole('button', 'Create BKK').last().tap();
    await expect(screen.getByRole('button', 'Create BKK')).toBeHidden({ timeout: 30_000 });
    const line = (await F.cloud().get(`/api/v1/finance/bank-statements/${st.statement_id}/lines`))[0];
    expect(line.matched_journal_line_id).toBeTruthy();
  });

  test('the list says what the bank and the books hold and the difference per account', { session: 'rina' }, async ({ app, screen }) => {
    await banked(F.tag('D'), 30_000);
    await app.open('/finance/cash-bank/bank-reconciliation');
    await F.expectHeads(screen, ['Account', 'Transactions', 'Reconciled', 'Pending', 'Bank', 'Books', 'Difference'], 60_000);
    await expect(F.rowOf(screen, 'Danamon').first()).toContainText('2'); // the two statement lines
  });
});

describe('Bank Rules', { tags: TAGS }, () => {
  test('the seeded rules are listed lowest priority first with what they record as; Show retired is a switch', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bank-rules');
    await F.onScreen(screen, 'Bank Rules');
    await F.expectHeads(screen, ['Direction', 'Records as', 'Unit', 'Active'], 45_000);
    await expect(F.rowOf(screen, 'PAJAK BUNGA')).toContainText('Out');
    await expect(F.rowOf(screen, 'BIAYA ADM')).toContainText('Bank charges');
    await expect(F.rowOf(screen, 'BIAYA ADM')).toContainText('6043');
  });

  test('New rule: Contains + text + category; the rule is saved, then Apply rules now proposes it on a matching bank line, then it is retired', { session: 'rina', timeout: 360_000 }, async ({ app, screen }) => {
    await F.ensureBank();
    const t = F.tag('X');
    await app.open('/finance/cash-bank/bank-rules');
    await screen.getByRole('button', 'New rule').first().tap();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await screen.getByRole('textbox', { name: /^Text/ }).fill(`LANGGANAN${t}`);
    await F.pick(screen, 'Direction', /^Out/);
    await F.pick(screen, 'Category', /Bank charges/);
    await screen.getByRole('textbox', { name: /^Priority/ }).fill('5');
    await screen.getByRole('textbox', { name: /^Note/ }).fill(`uji ${t}`);
    await expect(submit).toBeEnabled();
    await submit.tap();
    const row = F.rowOf(screen, `LANGGANAN${t}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Bank charges');
    const rule = (await F.cloud().get('/api/v1/finance/bank-rules')).find((r: any) => r.pattern === `LANGGANAN${t}`);
    expect(rule).toMatchObject({ priority: 5, match_kind: 'CONTAINS', direction: 'OUT', active: true });

    const st = await F.importStatement([{ date: F.today(), description: `PEMBAYARAN LANGGANAN${t} BULAN INI`, debit: 5_500 }]);
    await screen.getByRole('button', 'Apply rules now').tap();
    await expect(screen.getByText(/proposals? made from/)).toBeVisible({ timeout: 30_000 });
    const prop = (await F.cloud().get(`/api/v1/finance/bank-proposals?statement_id=${st.statement_id}`))[0];
    expect(prop).toMatchObject({ rule_id: rule.rule_id, category_code: 'ops_bank_charges', status: 'PROPOSED' });

    await row.getByRole('button', 'Retire').tap();
    await screen.getByRole('button', 'Retire rule').tap();
    await expect(F.rowOf(screen, `LANGGANAN${t}`)).toBeHidden({ timeout: 30_000 });
    expect((await F.cloud().get('/api/v1/finance/bank-rules?include_retired=true')).find((r: any) => r.rule_id === rule.rule_id).active).toBe(false);
  });

  test('a rule needs text and a category before Submit is enabled; the priority takes a whole number only', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/cash-bank/bank-rules');
    await screen.getByRole('button', 'New rule').first().tap();
    await screen.getByRole('textbox', { name: /^Priority/ }).fill('abc');
    await expect(screen.getByRole('textbox', { name: /^Priority/ })).toHaveValue('');
    await screen.getByRole('textbox', { name: /^Priority/ }).fill('0');
    await expect(screen.getByText('A whole number, 1 or more.')).toBeVisible();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });
});

describe('Bank Reconciliation Summary', { tags: TAGS }, () => {
  test('the report is the bank statement against the books: it lists the book-only postings and reaches a difference', { session: 'rina' }, async ({ app, screen }) => {
    await banked(F.tag('M'), 40_000);
    await app.open('/finance/reports/bank-reconciliation-summary');
    await F.onScreen(screen, 'Bank Reconciliation Summary');
    await F.pick(screen, 'Month', /October 2026/);
    await expect(screen.getByText('October 2026 · All units')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/Danamon/i).first()).toBeVisible({ timeout: 60_000 });
  });
});
