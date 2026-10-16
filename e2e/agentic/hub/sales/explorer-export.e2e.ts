// Sales Explorer: Export writes the rows on screen — same order, same filters, the
// Total at the foot — as a real .xlsx. The file is opened and held against the API.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  explorer, explorerOptions, GROUPS, jakartaToday, locateDownload, marginOf, noStock, periodLabel, readXlsx, resolvePeriod, shareOf,
} from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const nameOf = (group: string, row: Json) => {
  const found = /^(\d+) · (.+)$/.exec(row.label);
  if (group === 'month') return null; // shown as "October 2026"
  if ((group === 'article' || group === 'sku') && found) return { code: found[1], title: found[2] };
  if (group === 'sku' && row.detail) return { code: row.detail, title: row.label };
  return { code: null, title: row.label };
};
const same = (a: unknown, b: number | null, tol = 0) => (b === null ? a === null || a === undefined : typeof a === 'number' && Math.abs(a - b) <= tol);

async function exported(browser: Json, screen: Json) {
  const file = await browser.waitForDownload(() => screen.getByRole('button', 'Export').tap());
  const path = locateDownload(file.path, file.suggestedFilename);
  return { file, ...readXlsx(path) };
}

describe('Sales Explorer · Export', { tags: ['sales'] }, () => {
  for (const g of GROUPS.filter((x) => ['division', 'article', 'sku', 'session', 'payment', 'month'].includes(x.value))) {
    test(`SAL-24 Export, rows by ${g.label}: header, every row and the Total equal the API`, { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
      const options = await explorerOptions();
      const r = resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
      await app.open(`/sales/explorer?f=${encodeURIComponent(`g=${g.value}`)}`);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await expect(screen.getByRole('button', 'Export')).toBeEnabled();
      const api = await explorer({ ...r, group: g.value });
      const out = await exported(browser, screen);
      expect(out.file.suggestedFilename).toMatch(new RegExp(`^Sales-by-${g.label.replace(/ /g, '-')}-${r.from}-${r.to}\\.xlsx$`));
      expect(out.sheet).toBe(`Sales by ${g.label}`);
      expect(out.rows[0][0]).toBe(`Sales by ${g.label}`);
      expect(out.rows[1][0]).toBe(periodLabel(r.from, r.to));

      const coded = g.value === 'article' || g.value === 'sku';
      const pay = g.value === 'payment';
      const stock = !noStock(g.value);
      const canCost = api.can_see_cost as boolean;
      const head = [
        ...(coded ? ['Code'] : []), g.label, 'Detail',
        ...(pay ? ['Transactions', 'Collected', 'Per transaction', 'Share']
          : ['Sales', 'Pieces', 'Discount', ...(canCost ? ['Gross profit', 'Margin %'] : []), ...(stock ? ['Stock', ...(canCost ? ['Stock at acquisition'] : [])] : []), 'Share']),
      ];
      const at = out.rows.findIndex((row) => row[0] === head[0] && row[1] === head[1]);
      expect(at, `header row ${head.join(' | ')} in ${JSON.stringify(out.rows.slice(0, 5))}`).toBeGreaterThanOrEqual(0);
      expect(out.rows[at].filter((c) => c !== null)).toEqual(head);

      const body = out.rows.slice(at + 1);
      const lead = coded ? 2 : 1;
      api.rows.forEach((row: Json, i: number) => {
        const line = body[i];
        const f = row.figures as Json;
        const parts = nameOf(g.value, row);
        if (parts) {
          if (coded) expect(line[0]).toBe(parts.code);
          expect(line[lead - 1]).toBe(parts.title);
        }
        let c = lead + 1;
        if (pay) {
          expect(same(line[c++], f.receipts), `${row.label} transactions`).toBe(true);
          expect(same(line[c++], f.sales_minor), `${row.label} collected`).toBe(true);
          expect(same(line[c++], f.receipts ? f.sales_minor / f.receipts : null, 1), `${row.label} per transaction`).toBe(true);
        } else {
          expect(same(line[c++], f.sales_minor), `${row.label} sales`).toBe(true);
          expect(same(line[c++], f.qty), `${row.label} pieces`).toBe(true);
          expect(same(line[c++], f.discount_minor), `${row.label} discount`).toBe(true);
          if (canCost) {
            expect(same(line[c++], f.profit_minor), `${row.label} profit`).toBe(true);
            const m = marginOf(f);
            expect(same(line[c++], m === null ? null : m / 100, 0.0006), `${row.label} margin`).toBe(true);
          }
          if (stock) {
            expect(same(line[c++], f.stock), `${row.label} stock`).toBe(true);
            if (canCost) expect(same(line[c++], f.stock_cost_minor), `${row.label} stock acq`).toBe(true);
          }
        }
        const share = shareOf(f, api.total);
        expect(same(line[c], share === null ? null : share / 100, 0.0006), `${row.label} share`).toBe(true);
      });
      // The Total, closing the sheet.
      const total = body[api.rows.length];
      expect(total[lead - 1]).toBe('Total');
      expect(same(total[pay ? lead + 2 : lead + 1], api.total.sales_minor), 'total sales').toBe(true);
      expect(body.length).toBe(api.rows.length + 1);
    });
  }

  test('SAL-25 Export of the Per store view adds a column group per store, with the same numbers', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    const options = await explorerOptions();
    const r = resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
    await app.open(`/sales/explorer?f=${encodeURIComponent('v=stores')}`);
    await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true', WAIT);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await expect(screen.getByRole('columnheader', 'C016')).toBeVisible(WAIT);
    const api = await explorer({ ...r, group: 'division', matrix: true });
    const out = await exported(browser, screen);
    const at = out.rows.findIndex((row) => row[0] === 'Division');
    const head = out.rows[at].filter((c) => c !== null) as string[];
    const names = (api.stores as Json[]).map((s) => (s.code ?? s.name).replace(/-TOKO$/i, ''));
    const wantHead = ['Division', 'Detail', 'Sales', 'Pieces', 'Discount', 'Gross profit', 'Margin %', 'Stock', 'Stock at acquisition', 'Share', ...names.flatMap((n) => ['Stock', 'Stock at acquisition', 'Sales', 'Pieces'].map((col) => `${n} ${col}`))];
    expect(head).toEqual(wantHead);
    const body = out.rows.slice(at + 1);
    api.rows.forEach((row: Json, i: number) => {
      const byStore = new Map<string, Json>(row.cells.map((c: Json) => [c.site_id, c.figures]));
      (api.stores as Json[]).forEach((s, j) => {
        const f = byStore.get(s.site_id);
        const col = (name: string) => body[i][head.indexOf(`${names[j]} ${name}`)];
        expect(same(col('Sales'), f?.sales_minor ?? null), `${row.label} ${names[j]} sales`).toBe(true);
        expect(same(col('Pieces'), f?.qty ?? null), `${row.label} ${names[j]} pieces`).toBe(true);
        expect(same(col('Stock'), f?.stock ?? null), `${row.label} ${names[j]} stock`).toBe(true);
      });
    });
  });

  test('SAL-26 Export is off while there is nothing to export (a span with no sales)', { session: 'rina', timeout: 400_000 }, async ({ app, screen }) => {
    await app.open(`/sales/explorer?f=${encodeURIComponent('p=last')}`);
    await expect(screen.getByText(/^Nothing sold in this period/)).toBeVisible(WAIT);
    await expect(screen.getByRole('button', 'Export')).toBeDisabled();
  });
});
