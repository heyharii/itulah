// Sales Explorer: pressing a row — a division, tag, store or supplier is stepped into
// (and the way back is above the rows), a month narrows the period, an article or a
// SKU opens its sheet, a session or a payment method is only read.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  explorer, explorerMatches, explorerOptions, fmtCount, jakartaToday, marginOf, num, readFacts, readTables, resolvePeriod, rp,
} from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function range(period = '') {
  const options = await explorerOptions();
  return resolvePeriod(period, jakartaToday(), options.latest_day, options.earliest_day);
}

describe('Sales Explorer · drilling', { tags: ['sales'] }, () => {
  for (const d of [
    { group: 'division', label: 'Division', all: 'All divisions', filter: 'divisions', applied: 'Division' },
    { group: 'tag', label: 'Tag', all: 'All tags', filter: 'tags', applied: 'Tag' },
    { group: 'store', label: 'Store', all: 'All stores', filter: 'stores', applied: 'Stores' },
    { group: 'supplier', label: 'Supplier', all: 'All suppliers', filter: 'suppliers', applied: 'Supplier' },
  ] as const) {
    test(`SAL-16 ${d.label} row: steps into its articles, "${d.all}" steps back out`, { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
      const r = await range();
      const first = (await explorer({ ...r, group: d.group })).rows[0] as Json;
      await app.open(`/sales/explorer?f=${encodeURIComponent(`g=${d.group}`)}`);
      await expect(screen.getByRole('tab', d.label)).toHaveAttribute('aria-selected', 'true', WAIT);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await screen.getByRole('row').nth(1).tap();

      // Now in that row's articles, narrowed to it, with the way back above the rows.
      await expect(screen.getByRole('tab', 'Article')).toHaveAttribute('aria-selected', 'true');
      const trail = screen.getByRole('navigation', 'Where you are');
      await expect(trail.getByRole('button', d.all)).toBeVisible();
      await expect(trail).toContainText(first.label);
      await expect(screen.getByText(`${d.applied}: ${first.label}`)).toBeVisible();
      await explorerMatches({ screen, browser }, { ...r, group: 'article', [d.filter]: [first.key] } as Json);

      await trail.getByRole('button', d.all).tap();
      await expect(screen.getByRole('tab', d.label)).toHaveAttribute('aria-selected', 'true');
      await expect(screen.getByRole('navigation', 'Where you are')).toBeHidden();
      await expect(screen.getByText(`${d.applied}: ${first.label}`)).toBeHidden();
      await explorerMatches({ screen, browser }, { ...r, group: d.group });
    });
  }

  test('SAL-17 Month row narrows the period to that month (kept inside the period) and steps into its articles', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    const r = await range();
    const first = (await explorer({ ...r, group: 'month' })).rows[0] as Json;
    await app.open(`/sales/explorer?f=${encodeURIComponent('g=month')}`);
    await expect(screen.getByRole('tab', 'Month')).toHaveAttribute('aria-selected', 'true', WAIT);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('row').nth(1).tap();
    await expect(screen.getByRole('tab', 'Article')).toHaveAttribute('aria-selected', 'true');
    await expect(screen.getByRole('navigation', 'Where you are').getByRole('button', 'All months')).toBeVisible();
    const month = { from: first.key < r.from ? r.from : first.key, to: r.to };
    // The month's last day, or the end of the period when that comes first.
    const last = new Date(Number(first.key.slice(0, 4)), Number(first.key.slice(5, 7)), 0).toLocaleDateString('en-CA');
    month.to = last > r.to ? r.to : last;
    await explorerMatches({ screen, browser }, { ...month, group: 'article' });
    await screen.getByRole('navigation', 'Where you are').getByRole('button', 'All months').tap();
    await expect(screen.getByRole('tab', 'Month')).toHaveAttribute('aria-selected', 'true');
    await explorerMatches({ screen, browser }, { ...r, group: 'month' });
  });

  for (const g of ['session', 'payment'] as const) {
    test(`SAL-18 ${g === 'session' ? 'Cashier session' : 'Payment method'} row is only read: pressing it changes nothing`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open(`/sales/explorer?f=${encodeURIComponent(`g=${g}`)}`);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      const before = await browser.url();
      await screen.getByRole('row').nth(1).tap();
      await expect(screen.getByRole('navigation', 'Where you are')).toBeHidden();
      await expect(screen.getByRole('dialog')).toBeHidden();
      expect(await browser.url()).toBe(before);
    });
  }

  test('SAL-19 Back button walks back out of a drill', { session: 'rina', timeout: 400_000 }, async ({ app, screen }) => {
    await app.open('/sales/explorer');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const r = await range();
    const first = (await explorer({ ...r, group: 'division' })).rows[0] as Json;
    await screen.getByRole('row').nth(1).tap();
    await expect(screen.getByRole('tab', 'Article')).toHaveAttribute('aria-selected', 'true');
    await screen.getByRole('tab', 'SKU').tap();
    await expect(screen.getByRole('tab', 'SKU')).toHaveAttribute('aria-selected', 'true');
    await screen.getByRole('textbox', 'Search SKUs').waitFor({ state: 'visible' });
  });

  test('SAL-20 Article row opens its sheet: facts, the stores it sold in, its SKUs against the stores', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    const r = await range();
    const list = await explorer({ ...r, group: 'article' });
    const row = list.rows[0] as Json;
    const [, code, title] = /^(\d+) · (.+)$/.exec(row.label)!;
    await app.open(`/sales/explorer?f=${encodeURIComponent('g=article')}`);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('row').nth(1).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText(title, { exact: true })).toBeVisible(WAIT);
    await expect(sheet.getByText(code, { exact: true })).toBeVisible();
    await expect(sheet.getByText('Stores', { exact: true })).toBeVisible(WAIT);

    const detail = await explorer({ ...r, group: 'sku', q: code, matrix: true, limit: 500 });
    const f = row.figures as Json;
    const facts = await readFacts(browser as Json);
    expect(facts['Sales']).toBe(rp(f.sales_minor));
    expect(num(facts['Sold'])).toBe(f.qty);
    expect(num(facts['Discount'])).toBe(f.discount_minor);
    expect(facts['Returns']).toContain(rp(f.returns_minor));
    if (detail.can_see_cost && f.profit_minor !== null) {
      expect(facts['Gross profit']).toContain(rp(f.profit_minor));
      const m = marginOf(f);
      if (m !== null) expect(facts['Gross profit']).toMatch(new RegExp(`${m.toFixed(1).replace('.', ',')}%`));
      expect(facts['Stock at acquisition']).toBe(rp(f.stock_cost_minor));
    }
    expect(num(facts['Stock'])).toBe(f.stock ?? null);

    const tables = await readTables(browser as Json);
    // Stores: one row per store that sold or holds this article, then "All stores".
    const storeTotals = new Map<string, Json>(detail.store_totals.map((c: Json) => [c.site_id, c.figures]));
    const present = detail.stores.filter((s: Json) => {
      const x = storeTotals.get(s.site_id);
      return x && (x.qty !== 0 || x.sales_minor !== 0 || (x.stock ?? 0) > 0);
    });
    const stores = tables[0];
    expect(stores.map((r2) => r2[0])).toEqual(['Store', ...present.map((s: Json) => s.name), 'All stores']);
    present.forEach((s: Json, i: number) => {
      const x = storeTotals.get(s.site_id)!;
      expect(stores[i + 1].slice(1)).toEqual([fmtCount(x.qty), rp(x.sales_minor), fmtCount(x.stock ?? 0)]);
    });
    expect(stores[stores.length - 1].slice(1)).toEqual([fmtCount(f.qty), rp(f.sales_minor), fmtCount(f.stock ?? 0)]);

    // SKUs: Colour / size down the side, pieces sold per store, Sold, Stock.
    const grid = tables[1];
    expect(grid, 'SKU grid').toBeDefined();
    expect(grid.length - 1).toBe(detail.rows.length);
    detail.rows.forEach((sku: Json, i: number) => {
      const line = grid[i + 1];
      expect(num(line[line.length - 2])).toBe(sku.figures.qty);
      expect(num(line[line.length - 1])).toBe(sku.figures.stock ?? 0);
    });
  });

  test('SAL-21 SKU row opens its own sheet (facts and stores, no SKU grid)', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    const r = await range();
    const list = await explorer({ ...r, group: 'sku' });
    const row = list.rows[0] as Json;
    await app.open(`/sales/explorer?f=${encodeURIComponent('g=sku')}`);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('row').nth(1).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Stores', { exact: true })).toBeVisible(WAIT);
    const facts = await readFacts(browser as Json);
    expect(facts['Sales']).toBe(rp(row.figures.sales_minor));
    expect(num(facts['Sold'])).toBe(row.figures.qty);
    const tables = await readTables(browser as Json);
    expect(tables).toHaveLength(1);
    await expect(sheet.getByText('SKUs', { exact: true })).toBeHidden();
  });

  test('SAL-22 search narrows the rows through the server, says "No match.", and clears', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    const r = await range();
    const first = (await explorer({ ...r, group: 'division' })).rows[0] as Json;
    await app.open('/sales/explorer');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const box = screen.getByRole('textbox', 'Search divisions');
    await box.fill(first.label);
    await expect(browser).toHaveURL(new RegExp(`q=${first.label}`));
    await explorerMatches({ screen, browser }, { ...r, group: 'division', q: first.label });
    await box.fill('zzzz-no-such-division');
    await expect(browser).toHaveURL(/q=zzzz-no-such-division/);
    await explorerMatches({ screen, browser }, { ...r, group: 'division', q: 'zzzz-no-such-division' }, { emptyText: 'No match.' });
    await screen.getByRole('button', 'Clear search').tap();
    await expect(box).toHaveValue('');
    await expect(browser).not.toHaveURL(/q=/);
    await explorerMatches({ screen, browser }, { ...r, group: 'division' });
  });

  test('SAL-23 more rows load as the table scrolls ("100 of N")', { session: 'rina', timeout: 200_000 }, async () => {
    test.skip(true, 'the rig has under 100 rows in every grouping (13 pieces sold); needs the load-test data (po_load_240k) to page');
  });
});

describe('Sales Explorer · search finds what its label says', { tags: ['sales', 'bug'] }, () => {
  // The box says "Search suppliers" / "Search stores" / "Search divisions"; the server matches q
  // against the articles under a row, not against the row's own name, so typing a supplier's
  // name finds no supplier (`q=Garmen` → 0 suppliers, `q=Store` → 0 stores, `q=Pria` → 0 divisions).
  for (const g of ['division', 'supplier', 'store', 'tag'] as const) {
    test(`SAL-22b Search ${g}s by the name on the row — BUG: q only searches the articles under the row`, { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen, browser }) => {
      const r = await range();
      const first = (await explorer({ ...r, group: g })).rows[0] as Json;
      await app.open(`/sales/explorer?f=${encodeURIComponent(`g=${g}`)}`);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      const box = screen.getByRole('textbox', `Search ${g === 'store' ? 'stores' : g + 's'}`);
      await box.fill(first.label);
      await expect(browser).toHaveURL(new RegExp(`q=${encodeURIComponent(first.label).replace(/%20/g, '(\\+|%20)')}`));
      // Wait until the screen shows the server's answer to this search, whatever it is...
      const { shown } = await explorerMatches({ screen, browser }, { ...r, group: g, q: first.label }, {});
      // ...and the row we typed the name of must be in it.
      expect(shown.grid.body.map((c) => c[0].titles[0] ?? c[0].lines[0])).toContain(first.label);
    });
  }
});
