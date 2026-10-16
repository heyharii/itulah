// Sales Explorer: how the rows are read — Totals or Per store (a column group per
// store, 16 of them, the Totals pinned), and the Heatmap that tints the stores.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { explorerMatches, explorerOptions, GROUPS, jakartaToday, readGrid, resolvePeriod } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };

async function range() {
  const options = await explorerOptions();
  return resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
}

describe('Sales Explorer · Per store', { tags: ['sales'] }, () => {
  for (const g of GROUPS.filter((x) => x.value !== 'store')) {
    test(`SAL-06 Per store, rows by ${g.label}: every store's cells and the pinned Totals equal the API`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales/explorer');
      await expect(screen.getByRole('textbox', 'Search divisions')).toBeVisible(WAIT);
      if (g.value !== 'division') await screen.getByRole('tab', g.label).tap();
      await screen.getByRole('button', 'Per store').tap();
      await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true');
      await expect(screen.getByRole('button', 'Totals')).toHaveAttribute('aria-pressed', 'false');
      await expect(browser).toHaveURL(/v%3Dstores/);
      const { api } = await explorerMatches({ screen, browser }, { ...(await range()), group: g.value }, { view: 'stores' });
      const grid = await readGrid(browser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      // Every store (16 or more) and the pinned Totals sit side by side in the first header row.
      expect(api.stores.length).toBeGreaterThanOrEqual(16);
      expect(grid.heads[0]).toHaveLength(1 + api.stores.length + 1);
      expect(grid.heads[0][grid.heads[0].length - 1]).toBe('Totals');
    });
  }

  test('SAL-07 stores that sold nothing show dashes, never zeros; the one that sold shows its figures', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer?f=v%3Dstores');
    await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true', WAIT);
    const { api } = await explorerMatches({ screen, browser }, { ...(await range()), group: 'division' }, { view: 'stores' });
    const grid = await readGrid(browser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    const trading = new Set<string>(api.rows.flatMap((r: any) => r.cells.filter((c: any) => c.figures.sales_minor > 0).map((c: any) => c.site_id))); // eslint-disable-line @typescript-eslint/no-explicit-any
    const idle = api.stores.filter((s: any) => !trading.has(s.site_id)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(idle.length).toBeGreaterThanOrEqual(10);
    // Every body row: two cells per store (stock, sales); an idle store's sales cell is a dash.
    for (const cells of grid.body) {
      api.stores.forEach((s: any, j: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!trading.has(s.site_id)) expect(cells[2 + j * 2].text, `${s.site_id} sales cell`).toBe('—');
      });
    }
  });

  test('SAL-08 Heatmap: on by default, its key shows under Per store only, off writes h=0 into the address', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer');
    await expect(screen.getByRole('switch', 'Heatmap')).toHaveAttribute('aria-checked', 'true', WAIT);
    // Totals: the switch is dimmed and there is no key.
    await expect(screen.getByText(/highest store, per row/)).toBeHidden();
    await screen.getByRole('button', 'Per store').tap();
    await expect(screen.getByText(/highest store, per row/)).toBeVisible();
    await expect(screen.getByText(/Lowest store/)).toBeVisible();
    await screen.getByRole('switch', 'Heatmap').tap();
    await expect(screen.getByRole('switch', 'Heatmap')).toHaveAttribute('aria-checked', 'false');
    await expect(browser).toHaveURL(/h%3D0/);
    await expect(screen.getByText(/highest store, per row/)).toBeHidden();
    await screen.getByRole('switch', 'Heatmap').tap();
    await expect(screen.getByText(/highest store, per row/)).toBeVisible();
  });

  test('SAL-09 Totals brings the plain table back; Per store survives a reload', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer?f=v%3Dstores');
    await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true', WAIT);
    await browser.reload();
    await expect(screen.getByRole('button', 'Per store')).toHaveAttribute('aria-pressed', 'true', WAIT);
    await screen.getByRole('button', 'Totals').tap();
    await expect(screen.getByRole('button', 'Totals')).toHaveAttribute('aria-pressed', 'true');
    await explorerMatches({ screen, browser }, { ...(await range()), group: 'division' });
  });

  test('SAL-10 rows by Store: Per store is not offered, and a stale v=stores address still draws the plain table', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/explorer?f=g%3Dstore%26v%3Dstores');
    await expect(screen.getByRole('tab', 'Store')).toHaveAttribute('aria-selected', 'true', WAIT);
    await expect(screen.getByRole('button', 'Per store')).toBeDisabled();
    await explorerMatches({ screen, browser }, { ...(await range()), group: 'store' });
    const grid = await readGrid(browser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(grid.heads[0]).toEqual(['Store', 'Sales', 'Discount', 'Gross profit', 'Stock · Acq', 'Share']);
  });
});
