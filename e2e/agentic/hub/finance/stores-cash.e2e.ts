// Stores' money: Overview (three boxes per shop), Cash on Hand / Petty Cash / Cashier Float ledgers, Sales by Day, Cash Counts, and where the day's takings land (cash → drawer, card/QRIS → Cash in Bank).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'stores-cash'];
const BOX = { cash: '1002', petty: '1003', float: '1004' } as const;

/** One shop's box balance as of today (what the screens read). */
async function closing(code: string, unit: string): Promise<number> {
  const today = F.today();
  return (await F.cloud().get(`/api/v1/finance/accounts/${code}/ledger?unit=${unit}&from=${today}&to=${today}&limit=1`)).closing_minor;
}

/** The screen's figure must equal the API's, tolerating a sale or deposit landing between the two reads. */
async function agree(read: () => Promise<number | null>, api: () => Promise<number>, retries = 4) {
  for (let i = 0; i < retries; i++) {
    const a = await api();
    const shown = await read();
    const b = await api();
    if (shown === a || shown === b) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  expect(await read(), 'the screen disagrees with a stable API').toBe(await api());
}

describe('Stores overview', { tags: TAGS }, () => {
  test('every open shop shows its three boxes, equal to the ledger, with an "All shops · N" total row', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/finance/stores');
    await F.onScreen(screen, 'Stores');
    await F.expectHeads(screen, ['Shop', 'Cash on hand', 'Petty cash', 'Cashier float'], 60_000);
    await expect(screen.getByText('All shops ·', { exact: false })).toBeVisible();
    await expect(screen.getByText('Balances as of today.', { exact: false })).toBeVisible();
    const row = F.rowOf(screen, 'C001');
    await expect(row).toBeVisible();
    await expect(row.getByText('…')).toBeHidden({ timeout: 60_000 });
    for (const [i, code] of [BOX.cash, BOX.petty, BOX.float].entries()) {
      await agree(async () => F.rp(await row.getByRole('cell').nth(i + 1).textContent()), () => closing(code, 'store-01'));
    }
  });

  test('the total row is the sum of the shops: it counts every open shop and adds their drawers', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/stores');
    await F.onScreen(screen, 'Stores');
    await expect(F.rowOf(screen, 'All shops').first()).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByRole('table').first().getByText('…')).toHaveCount(0, { timeout: 240_000 }); // every shop's three boxes have been read
    const cells = await F.rowOf(screen, 'All shops').first().getByRole('cell').allTextContents();
    const shops = ((await F.cloud().get('/api/v1/organisation/units')) as any[]).filter((u) => u.kind === 'STORE' && u.status !== 'CLOSED');
    const total = (await Promise.all(shops.map((u) => closing(BOX.cash, u.id)))).reduce((a, b) => a + b, 0);
    expect(cells[0]).toContain(`All shops · ${shops.length}`);
    expect(Math.abs((F.rp(cells[1]) ?? NaN) - total), 'shops keep selling while the page and the API are read').toBeLessThanOrEqual(20_000_000);
  });
});

describe('Cash on hand / Petty cash / Cashier float', { tags: TAGS }, () => {
  test('Cash on hand of Cikupa: Balance now, In this month, Out this month and the ledger rows equal the API', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/stores/cash-on-hand?store=store-01');
    await expect(screen.getByRole('heading', { name: 'Cash on hand', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('navigation', 'Shops').getByRole('button', /Cikupa/)).toBeVisible();
    for (const label of ['Balance now', 'In this month', 'Out this month']) await expect(screen.getByText(label, { visible: true }).first()).toBeVisible({ timeout: 60_000 });
    const today = F.today();
    const first = `${today.slice(0, 8)}01`;
    const month = await F.cloud().get(`/api/v1/finance/accounts/1002/ledger?unit=store-01&from=${first}&to=${today.slice(0, 8)}31&limit=100`);
    await expect(screen.getByText(F.money(await closing('1002', 'store-01')), { visible: true }).first()).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(F.money(month.window_debit_minor), { visible: true }).first()).toBeVisible();
    const takings = month.rows.find((r: any) => r.source_kind === 'SALE_DAY');
    expect(takings, 'the day\'s takings were posted to the drawer').toBeTruthy();
    await expect(F.rowOf(screen, takings.entry_number)).toBeVisible();
    await expect(F.rowOf(screen, takings.entry_number)).toContainText('CASH takings');
    await expect(F.rowOf(screen, takings.entry_number)).toContainText(F.money(takings.debit_minor));
  });

  test('the ledger search narrows rows and says so when nothing matches; six month tabs', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/stores/cash-on-hand?store=store-01');
    await expect(screen.getByRole('textbox', 'Search the ledger')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('textbox', 'Search the ledger').fill('zzz-tidak-ada');
    await expect(screen.getByText('No line matches “zzz-tidak-ada”.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('tab')).toHaveCount(6);
  });

  test('choosing another shop in the rail changes the page to that shop and keeps the box', { session: 'rina' }, async ({ app, screen, browser }) => {
    await app.open('/finance/stores/cash-on-hand?store=store-01');
    await screen.getByRole('navigation', 'Shops').getByRole('button', /C002/).tap();
    await expect(browser).toHaveURL(/store=store-02/);
    await expect(screen.getByRole('heading', { name: 'Muaro Bungo', level: 2 })).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', { name: 'Cash on hand', level: 1 })).toBeVisible();
  });

  test('Petty cash has Ledger · Spending by week · Approval codes; Cashier float is its own ledger', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/stores/petty-cash?store=store-01');
    await expect(screen.getByRole('heading', { name: 'Petty cash', level: 1 })).toBeVisible({ timeout: 60_000 });
    for (const tab of ['Ledger', 'Spending by week', 'Approval codes']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    await screen.getByRole('tab', 'Spending by week').tap();
    await expect(screen.getByText(/^Week of /).first()).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('tab', 'Approval codes').tap();
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await app.open('/finance/stores/cashier-float?store=store-01');
    await expect(screen.getByRole('heading', { name: 'Cashier float', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('Balance now', { visible: true }).first()).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 4; i++) {
      const a = await closing(BOX.float, 'store-01');
      if (await screen.getByText(F.money(a), { exact: true, visible: true }).first().isVisible()) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    await expect(screen.getByText(F.money(await closing(BOX.float, 'store-01')), { exact: true, visible: true }).first()).toBeVisible();
  });
});

describe('Sales by day and cash counts', { tags: TAGS }, () => {
  test('Sales by day: pick a day on the rail — Sales / Returns / Cash expected in the drawer / Voided and the tender table equal the daily report', { session: 'rina' }, async ({ app, screen }) => {
    // the last day that has sales (today may have none yet)
    let day = '';
    let report: any = null;
    for (let back = 0; back < 14 && !day; back++) {
      const d = F.dayOf(-back);
      const r = await F.cloud().get(`/api/v1/reports/sales/daily?site_id=store-01&date=${d}`);
      if (r.sales.count > 0) {
        day = d;
        report = r;
      }
    }
    expect(day, 'store-01 has sold something in the last two weeks').not.toBe('');
    await app.open('/finance/stores/sales?store=store-01');
    await expect(screen.getByRole('heading', { name: 'Sales by day', level: 1 })).toBeVisible({ timeout: 60_000 });
    const [, mm, dd] = day.split('-');
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1];
    await screen.getByRole('button', { name: new RegExp(`\\b${Number(dd)} ${mon}\\b`) }).tap();
    for (const label of ['Sales', 'Returns', 'Cash expected in the drawer', 'Voided']) await expect(screen.getByText(label, { exact: true, visible: true }).first()).toBeVisible({ timeout: 90_000 });
    await F.expectHeads(screen, ['Paid by', 'Receipts', 'Taken at the till']);
    const cash = report.tenders.find((t: any) => t.method === 'CASH');
    await expect(F.rowOf(screen, 'Cash').first()).toContainText(F.money(cash.amount_minor), { timeout: 30_000 });
    await expect(screen.getByText(F.money(report.sales.gross_minor), { visible: true }).first()).toBeVisible();
  });

  test('Cash counts opens with its week rail and the counted-cash columns', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/finance/stores/cash-counts?store=store-01');
    await expect(screen.getByRole('heading', { name: 'Cash counts', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/^Week of /).first()).toBeVisible({ timeout: 60_000 });
  });
});

describe('where the takings land', { tags: [...TAGS, 'takings'] }, () => {
  test('a day\'s takings entry puts cash in the shop drawer and card/QRIS straight into Cash in Bank of head office — no card receivable', { session: 'rina' }, async () => {
    const postings = (await F.cloud().get('/api/v1/finance/sales-postings')) as any[];
    const posted = postings.find((p) => p.status === 'POSTED' && p.journal_entry_id);
    expect(posted, 'the demo stage posts a day\'s takings').toBeTruthy();
    const { lines } = await F.entry(posted.journal_entry_id);
    F.expectBalanced(lines);
    const cash = lines.filter((l: any) => l.memo === 'CASH takings');
    expect(cash.length).toBeGreaterThan(0);
    for (const l of cash) expect(l).toMatchObject({ account_code: '1002', unit_id: posted.site_id });
    const cards = lines.filter((l: any) => /^(CARD|QRIS)/.test(l.memo ?? '') && /takings$/.test(l.memo ?? ''));
    expect(cards.length).toBeGreaterThan(0);
    for (const l of cards) {
      expect(l.account_code).toMatch(/^100[5-9]$|^1010$/); // a bank account, not 1020/1021 card receivable
      expect(l.unit_id).toBe('ho');
    }
    expect(lines.some((l: any) => l.account_code === '1020' || l.account_code === '1021')).toBe(false);
  });

  test('Sales Postings: choose a store and the posted day lists with its entry number; Deposits and Cash Transactions open', { session: 'rina' }, async ({ app, screen }) => {
    const posted = ((await F.cloud().get('/api/v1/finance/sales-postings')) as any[]).find((p) => p.status === 'POSTED');
    await app.open('/finance/receivables/sales-postings');
    await F.onScreen(screen, 'Sales Postings');
    await expect(screen.getByText('Choose a site to see its sales postings.')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('combobox').first().tap();
    await screen.getByRole('option', { name: /Cikupa/ }).tap();
    await expect(screen.getByText(posted.entry_number).first()).toBeVisible({ timeout: 60_000 });
    for (const [path, title] of [['/finance/cash-bank/deposits', 'Deposits'], ['/finance/cash-bank/cash-transactions', 'Transactions']] as const) {
      await app.open(path);
      await F.onScreen(screen, title);
    }
  });
});
