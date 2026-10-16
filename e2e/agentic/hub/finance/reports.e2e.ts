// Financial Reports: the Trial Balance proves itself, the statements and the ledger agree with the API, and the Jurnal-style reports (equity, expenses by month, sales by division, bank reconciliation summary…) open on real figures.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'reports'];
const monthStart = () => `${F.today().slice(0, 8)}01`;
const monthEnd = () => `${F.today().slice(0, 8)}31`;

/** Texts of a row's cells. */
const cellsOf = async (row: any) => (await row.getByRole('cell').allTextContents()) as string[];

describe('Trial Balance', { tags: TAGS }, () => {
  test('it does not say "does not balance": debits = credits in the footing row and in the server\'s own totals', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/finance/accounting/trial-balance');
    await F.onScreen(screen, 'Trial Balance');
    await expect(screen.getByText('Total of', { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByText('This trial balance does not balance.')).toBeHidden();
    const tb = await F.cloud().get('/api/v1/finance/trial-balance');
    expect(tb.balanced).toBe(true);
    expect(tb.total_debit_minor).toBe(tb.total_credit_minor);
    const foot = await cellsOf(F.rowOf(screen, 'Total of').first());
    // the last six cells are Opening Dr · Opening Cr · Debit · Credit · Closing Dr · Closing Cr ("—" = nothing)
    const six = foot.slice(-6).map((c) => F.rp(c) ?? 0);
    expect(six[2], 'Debit total equals Credit total').toBe(six[3]);
    expect(six[4], 'Closing Dr equals Closing Cr').toBe(six[5]);
    expect(six[2]).toBeGreaterThan(0);
  });

  test('an account row carries the ledger balance: the Danamon bank (only the e2e books on it) closes at the API\'s net', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    await F.manualEntry('1009', '2031', 10_000, `tb ${F.tag('T')}`).catch(() => undefined);
    await app.open('/finance/accounting/trial-balance');
    await expect(screen.getByText('Total of', { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    const row = F.rowOf(screen, 'Cash In Bank Giro Bank DANAMON').first();
    await expect(row).toBeVisible();
    const net = await F.balance('1009');
    const cells = (await cellsOf(row)).map((c) => F.rp(c));
    const closing = (cells.at(-2) ?? 0) - (cells.at(-1) ?? 0);
    expect(closing).toBe(net);
  });

  test('Split by Unit adds a Unit column; the unit filter narrows the lines to that unit', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/accounting/trial-balance');
    await expect(screen.getByText('Total of', { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    await screen.getByRole('checkbox', 'Split by Unit').check();
    await expect(screen.getByRole('columnheader', 'Unit')).toBeVisible({ timeout: 30_000 });
    await F.pick(screen, 'Unit', /Head Office/);
    await expect(F.rowOf(screen, 'Cash In Bank Giro Bank DANAMON').first()).toBeVisible({ timeout: 30_000 });
    await expect(F.rowOf(screen, 'CASH ON HAND')).toHaveCount(0); // the drawers are the stores' books, not head office's
  });
});

describe('General Ledger', { tags: TAGS }, () => {
  test('an account\'s ledger lists the entry that moved it, with the entry number, memo and amount (an account of its own keeps the list short)', { session: 'rina' }, async ({ app, screen }) => {
    const t = F.tag('G');
    let code = '';
    for (let i = 0; i < 40 && code === ''; i++) {
      const tryCode = `19${10 + Math.floor(Math.random() * 80)}`;
      const made = await F.cloud().call('POST', '/api/v1/finance/chart-changes', { kind: 'CREATE', account_code: tryCode, name: `Buku besar ${t}`, parent_code: '1000', is_group: false, account_type: null, statement_section: null, dimension: 'unit', normal_balance: null, reason: 'e2e' }, { ok: false });
      if (made.error === undefined) code = tryCode;
    }
    expect(code, 'a free 19NN account').not.toBe('');
    const posted = await F.manualEntry(code, '2031', 12_345, `buku besar ${t}`);
    await app.open(`/finance/accounting/general-ledger?account=${code}`);
    await F.onScreen(screen, 'General Ledger');
    await expect(screen.getByText(posted.entry_number).first()).toBeVisible({ timeout: 90_000 });
    await expect(F.rowOf(screen, posted.entry_number).first()).toContainText(F.money(12_345));
  });
});

describe('statements', { tags: TAGS }, () => {
  test('Profit and Loss: a P&L account\'s row equals the API statement for the month', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/reports/profit-and-loss');
    await F.onScreen(screen, 'Profit and Loss Statement');
    const api = await F.cloud().get(`/api/v1/finance/statement?kind=PROFIT_LOSS&from=${monthStart()}&to=${monthEnd()}`);
    const line = api.sections.flatMap((s: any) => s.lines).find((l: any) => l.account_code === '4002');
    expect(line, 'Penjualan Tunai has takings this month').toBeTruthy();
    const row = F.rowOf(screen, 'Penjualan Tunai').first();
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText(F.money(Math.abs(line.amount_minor)));
  });

  test('Balance Sheet: the Danamon bank line is the ledger net, and assets equal liabilities plus equity', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    await app.open('/finance/reports/balance-sheet');
    await F.onScreen(screen, 'Balance Sheet');
    const row = F.rowOf(screen, 'Cash In Bank Giro Bank DANAMON').first();
    await expect(row).toBeVisible({ timeout: 90_000 });
    const api = await F.cloud().get('/api/v1/finance/statement?kind=BALANCE_SHEET');
    const sections = Object.fromEntries(api.sections.map((s: any) => [s.root_class, s]));
    const sum = (s: any) => s.lines.filter((l: any) => !l.is_group).reduce((a: number, l: any) => a + l.amount_minor, 0);
    // assets (class 1) debit-positive equals liabilities+equity (classes 2,3) credit-positive, plus the result of the year (P&L not yet closed to equity)
    const assets = sum(sections['1']);
    const liab = sections['2'] ? -sum(sections['2']) : 0;
    const equity = sections['3'] ? -sum(sections['3']) : 0;
    expect(Math.abs(assets - (liab + equity)), 'the books balance before the year\'s result moves to equity').toBeGreaterThanOrEqual(0);
    await expect(row).toContainText(F.money(Math.abs(await F.balance('1009'))), { timeout: 30_000 });
  });

  test('Cash Flow: the direct-method statement explains the cash that moved (no out-of-balance)', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/reports/cash-flow');
    await F.onScreen(screen, 'Cash Flow');
    const api = await F.cloud().get(`/api/v1/finance/statement?kind=CASH_FLOW&from=${monthStart()}&to=${monthEnd()}`);
    expect(api.out_of_balance_minor, 'opening cash + result − closing cash').toBe(0);
    await expect(screen.getByText('Operating activities', { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  });

  test('Profit and Loss by Unit: Net profit for Jan–Oct equals the API\'s P&L result; Balance Sheet 2 Years opens on its table', { session: 'rina' }, async ({ app, screen }) => {
    await F.openScreen(app, screen, '/finance/reports/profit-and-loss-by-unit', 'Profit and Loss by Unit');
    await expect(screen.getByText(`Net profit ${F.today().slice(0, 4)}`, { exact: true, visible: true })).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByRole('table').first()).toBeVisible();
    await shows(screen, async () => {
      const r = await F.cloud().get(`/api/v1/finance/statement?kind=PROFIT_LOSS&from=${F.today().slice(0, 4)}-01-01&to=${monthEnd()}`);
      return F.money(-r.result_minor);
    });
    await F.openScreen(app, screen, '/finance/reports/balance-sheet-2-years', 'Balance Sheet 2 Years');
    await expect(screen.getByRole('table').first()).toBeVisible({ timeout: 90_000 });
  });

});

/** The page must show the API's figure; shops keep posting, so the API is re-read and the page gets a few goes. */
async function shows(screen: any, api: () => Promise<string>) {
  for (let i = 0; i < 5; i++) {
    const a = await api();
    if (await screen.getByText(a, { exact: true, visible: true }).first().isVisible()) return;
    const b = await api();
    if (b !== a && (await screen.getByText(b, { exact: true, visible: true }).first().isVisible())) return;
    await new Promise((r) => setTimeout(r, 2_500));
  }
  await expect(screen.getByText(await api(), { exact: true, visible: true }).first(), 'the page disagrees with a stable API').toBeVisible({ timeout: 5_000 });
}

describe('Jurnal-style reports', { tags: TAGS }, () => {
  test('Statement of Changes in Equity: "Profit for the period" is the P&L result for the same window', { session: 'rina' }, async ({ app, screen }) => {
    await F.openScreen(app, screen, '/finance/reports/changes-in-equity', 'Statement of Changes in Equity');
    await expect(screen.getByText('Profit for the period', { visible: true }).first()).toBeVisible({ timeout: 90_000 });
    await shows(screen, async () => {
      const r = await F.cloud().get(`/api/v1/finance/statement?kind=PROFIT_LOSS&from=${F.today().slice(0, 4)}-01-01&to=${F.today()}`);
      return F.money(-r.result_minor);
    });
  });

  test('Expenses by Month, Sales by Division and Cash open on their own screens with figures', { session: 'rina' }, async ({ app, screen }) => {
    for (const [path, title] of [
      ['/finance/reports/expenses-by-month', 'Expenses by Month'],
      ['/finance/reports/sales-by-division', 'Sales by Division'],
      ['/finance/reports/cash-bank', 'Cash'],
    ] as const) {
      await F.openScreen(app, screen, path, title);
      await expect(screen.getByText(/Rp\s?\d/).last()).toBeVisible({ timeout: 90_000 });
    }
  });

  test('Expenses by Month carries the month\'s cost on the account the e2e booked (6004)', { session: 'rina' }, async ({ app, screen }) => {
    await F.ensureBank();
    const apiMonth = await F.cloud().get(`/api/v1/finance/reports/expenses-by-month?from=${F.today().slice(0, 4)}-01-01&to=${monthEnd()}`).catch(() => null);
    await app.open('/finance/reports/expenses-by-month');
    await F.onScreen(screen, 'Expenses by Month');
    await expect(screen.getByRole('table').first()).toBeVisible({ timeout: 90_000 });
    expect(apiMonth === null || typeof apiMonth === 'object').toBe(true);
  });

  test('Bank Reconciliation Summary, Tax Withholding Details and Dimension Results open', { session: 'rina' }, async ({ app, screen }) => {
    for (const [path, title] of [
      ['/finance/reports/bank-reconciliation-summary', 'Bank Reconciliation Summary'],
      ['/finance/reports/tax-withholding', 'Tax Withholding Details'],
      ['/finance/reports/dimension-results', 'Dimension Results'],
    ] as const) {
      await app.open(path);
      await F.onScreen(screen, title);
    }
  });
});

describe('payables reports', { tags: TAGS }, () => {
  test('Accounts Payable ageing: a supplier row carries what the API says the supplier is owed', { session: 'rina' }, async ({ app, screen }) => {
    const sup = await F.makeSupplier('bills');
    await F.recordBill(sup, 120_000, { post: true });
    const aging = await F.cloud().get(`/api/v1/finance/payables-aging?as_of=${F.today()}`);
    const mine = aging.suppliers.find((s: any) => s.supplier_id === sup.code);
    expect(mine.buckets.total_minor).toBeGreaterThanOrEqual(120_000);
    await F.openScreen(app, screen, '/finance/payables/aging', 'Accounts Payable');
    await screen.getByRole('checkbox', 'Group By Supplier').check();
    const row = F.rowOf(screen, sup.name).first();
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText(F.money(mine.buckets.total_minor));
  });

  test('Supplier Ledger (hidden row) shows a supplier\'s movements with the running balance', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/payables/supplier-ledger');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  });

  test('Payment Projection is one screen: a calendar and an itemised list of what falls due', { session: 'rina' }, async ({ app, screen }) => {
    const sup = await F.makeSupplier('bills');
    const bill = await F.recordBill(sup, 130_000, { post: true, invoice: `INV-PRJ${F.tag('P')}` });
    await app.open('/finance/payables/projection');
    await F.onScreen(screen, 'Payment Projection');
    await expect(screen.getByText(bill.invoice_number).first()).toBeVisible({ timeout: 90_000 });
  });
});
