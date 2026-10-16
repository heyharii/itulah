// Bugs found while mapping Sales — each test asserts the RIGHT behaviour and is red until the app is fixed.
//
//  1. reports/sales/series and /window (backend/src/cloud/postgres/reports.rs) count every edge_sale,
//     voided ones included: the edge branch of the UNION has no `status = 'COMPLETED'` filter, and the
//     voided count reads only the centre `sale` table. So Sales and Sales Analytics show voided sales as
//     takings, while the Explorer, the breakdowns and Shop Floor leave them out — one screen says
//     Rp 20,1 M, the next Rp 4,0 M, for the same trading day.
//  2. a shop has two names: "Store 01" on the rows, "Cikupa" on its own sheet.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { agree, centreSales, fmtCount, jakartaToday, num, readFacts, readTiles, rp, spanOf, windowReport, bucketTitle } from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

async function completedIn(from: string, to: string) {
  const all = await centreSales(500);
  const inWindow = all.filter((s) => dayOf(s.completed_at ?? s.created_at) >= from && dayOf(s.completed_at ?? s.created_at) <= to);
  return {
    capped: all.length >= 500,
    completed: inWindow.filter((s) => s.status === 'COMPLETED'),
    voided: inWindow.filter((s) => s.status === 'VOIDED'),
  };
}

describe('Sales › voided sales are not takings', { tags: ['sales', 'bug'] }, () => {
  test('SAL-64 BUG: Sales (30 days) — Takings and Transactions are the completed sales only', { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    const range = spanOf('day', 30);
    const first = await completedIn(range.from, range.to);
    test.skip(first.capped || first.voided.length === 0, 'needs a voided sale in the window and fewer than 500 sales held');
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const got = await agree({
      api: () => completedIn(range.from, range.to),
      read: () => readTiles(browser as Json),
      stable: (a) => [a.completed.map((s: Json) => s.id), a.voided.length],
      check: (tiles, a) => {
        const bad: string[] = [];
        const takings = (a.completed as Json[]).reduce((t, s) => t + s.total_minor, 0);
        const t = Object.fromEntries(tiles.map((x) => [x.label, x.value]));
        if (t['Takings'] !== rp(takings)) bad.push(`Takings ${t['Takings']} ≠ completed ${rp(takings)} (${a.voided.length} voided sales are in the figure)`);
        if (t['Transactions'] !== fmtCount(a.completed.length)) bad.push(`Transactions ${t['Transactions']} ≠ ${a.completed.length} completed (${a.voided.length} voided are counted)`);
        return bad;
      },
      reload: async () => {
        await browser.reload();
        await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
      },
    });
    expect(got.problems).toEqual([]);
  });

  test('SAL-65 BUG: Sales Analytics (30 days) — the Takings and Transactions tiles are the completed sales only', { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    const range = spanOf('day', 30);
    const first = await completedIn(range.from, range.to);
    test.skip(first.capped || first.voided.length === 0, 'needs a voided sale in the window and fewer than 500 sales held');
    await app.open('/sales/analytics');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const got = await agree({
      api: () => completedIn(range.from, range.to),
      read: () => readTiles(browser as Json),
      stable: (a) => [a.completed.map((s: Json) => s.id), a.voided.length],
      check: (tiles, a) => {
        const takings = (a.completed as Json[]).reduce((t, s) => t + s.total_minor, 0);
        const t = Object.fromEntries(tiles.map((x) => [x.label, x.value]));
        const bad: string[] = [];
        if (t['Takings'] !== rp(takings)) bad.push(`Takings ${t['Takings']} ≠ completed ${rp(takings)}`);
        if (t['Transactions'] !== fmtCount(a.completed.length)) bad.push(`Transactions ${t['Transactions']} ≠ ${a.completed.length}`);
        return bad;
      },
      reload: async () => {
        await browser.reload();
        await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
      },
    });
    expect(got.problems).toEqual([]);
  });

  test("SAL-66 BUG: a shop's day sheet counts the voided sales (the Voided fact and the banner)", { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    const today = jakartaToday();
    const first = await completedIn(today, today);
    const voided = first.voided.filter((s: Json) => s.site_id === 'store-01');
    test.skip(first.capped || voided.length === 0, 'needs a voided sale at store-01 today and fewer than 500 sales held');
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('button', new RegExp(`^${bucketTitle(today, 'day')}`)).tap();
    await screen.getByRole('button', rp((await windowReport('store-01', today, today, 1)).sales.gross_minor), { exact: true }).first().tap();
    await expect(screen.getByRole('dialog').getByText('Receipts', { exact: true })).toBeVisible(WAIT);
    const facts = await readFacts(browser as Json);
    expect(num(facts['Voided'])).toBe(voided.length);
    await expect(screen.getByRole('dialog').getByText(/were voided in this span|was voided in this span/)).toBeVisible();
  });
});

describe('Sales › one shop, one name', { tags: ['sales', 'bug'] }, () => {
  test("SAL-67 BUG: a store's row and its own sheet call it the same thing", { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen }) => {
    await app.open('/sales/analytics');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const row = screen.getByRole('row').filter({ hasText: 'Store 01' }).first();
    await expect(row).toBeVisible();
    await row.tap();
    // The sheet's title is the shop's name: it must be the row's name ("Store 01"), not another one ("Cikupa").
    await expect(screen.getByRole('dialog').getByRole('heading', 'Store 01')).toBeVisible(WAIT);
  });
});
