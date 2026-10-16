// More › Store Analytics (/sales/analytics, titled "Sales Analytics"): the estate read one
// store at a time — the five totals, Gaining / Losing ground, a row per store with its share
// and its growth against the span before — held against GET /api/v1/reports/sales/series.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  agree, analyticsProblems, matrixOf, OPENS_ON, previousSpanOf, readGrid, readMovers, readTiles, series, showSales, SALES_KINDS, SPANS, spanOf, growthLabel, type Bucket,
} from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function analyticsMatch(ctx: { screen: Json; browser: Json }, bucket: Bucket, buckets: number, sort?: { key: 'gross_minor' | 'sales_count' | 'units_sold' | 'average_minor' | null; desc: boolean }) {
  const { screen, browser } = ctx;
  const range = spanOf(bucket, buckets);
  const prior = previousSpanOf(bucket, buckets);
  const got = await agree({
    api: async () => ({ now: await series(range.from, range.to, bucket), before: await series(prior.from, prior.to, bucket) }),
    read: async () => {
      const end = Date.now() + 90_000;
      let grid = await readGrid(browser);
      while (Date.now() < end && grid.body.length === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        grid = await readGrid(browser);
      }
      return { grid, tiles: await readTiles(browser), movers: await readMovers(browser) };
    },
    stable: (a) => [a.now.cells, a.before.cells, a.now.sites],
    check: (s, a) => {
      const bad = analyticsProblems(s.grid, a.now, a.before, sort?.key ?? 'gross_minor', sort?.desc ?? true);
      const m = matrixOf(a.now);
      const mb = matrixOf(a.before);
      SALES_KINDS.forEach((k, i) => {
        const t = s.tiles[i];
        if (!t) return bad.push(`tile ${k.label} missing`);
        if (t.value !== showSales(k.kind, m.grand(k.kind))) bad.push(`tile ${k.label}: "${t.value}" ≠ "${showSales(k.kind, m.grand(k.kind))}"`);
      });
      // Gaining / Losing ground: at most five stores, ranked by growth, never a store with nothing before it.
      const growths = m.sites
        .map((x) => ({ name: x.site_name, was: mb.site(x.site_id, null, 'gross_minor'), now: m.site(x.site_id, null, 'gross_minor') }))
        .filter((x) => x.was > 0)
        .map((x) => ({ name: x.name, g: (x.now - x.was) / x.was }));
      const up = growths.filter((x) => x.g > 0).sort((p, q) => q.g - p.g).slice(0, 5);
      const down = growths.filter((x) => x.g < 0).sort((p, q) => p.g - q.g).slice(0, 5);
      const check = (title: string, list: { name: string; g: number }[], empty: string) => {
        const lines = s.movers[title] ?? [];
        if (list.length === 0) {
          if (!lines.includes(empty)) bad.push(`${title}: should say "${empty}", got ${JSON.stringify(lines)}`);
        } else list.forEach((x) => {
          if (!lines.includes(x.name)) bad.push(`${title}: lacks ${x.name}`);
          if (!lines.includes(growthLabel(x.g))) bad.push(`${title}: lacks ${growthLabel(x.g)}`);
        });
      };
      check('Gaining', up, 'No store took more than it did in the span before.');
      check('Losing ground', down, 'No store took less than it did in the span before.');
      return bad;
    },
    reload: async () => {
      await browser.reload();
      await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
    },
  });
  expect(got.problems, `${bucket} ${buckets}`).toEqual([]);
  return got.api as { now: Json; before: Json };
}

describe('Sales Analytics', { tags: ['sales'] }, () => {
  test('SAL-45 opening view (30 days): the totals, movers and a row per store equal the API', { session: 'rina', tags: ['sales', 'smoke'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/analytics');
    await expect(screen.getByRole('heading', 'Sales Analytics', { level: 1 })).toBeVisible(WAIT);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await expect(screen.getByRole('button', 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByRole('button', '30')).toHaveAttribute('aria-pressed', 'true');
    const { now } = await analyticsMatch({ screen, browser }, 'day', 30);
    const range = spanOf('day', 30);
    await expect(screen.getByText(`${range.from} — ${range.to}`)).toBeVisible();
    // "N of M stores trading" says how many of the estate's stores sold anything.
    const m = matrixOf(now);
    const trading = m.sites.filter((s: Json) => m.site(s.site_id, null, 'sales_count') > 0).length;
    await expect(screen.getByText(new RegExp(`${trading} of ${m.sites.length} stores trading`))).toBeVisible();
  });

  for (const bucket of ['day', 'week', 'month'] as Bucket[]) {
    test(`SAL-46 resolution "${bucket}" × each span (${SPANS[bucket].join(' · ')})`, { session: 'rina', timeout: 900_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales/analytics');
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      const label = bucket[0].toUpperCase() + bucket.slice(1);
      if (bucket !== 'day') await screen.getByRole('button', label).tap();
      await expect(screen.getByRole('button', label)).toHaveAttribute('aria-pressed', 'true');
      await expect(screen.getByRole('button', String(OPENS_ON[bucket]), { exact: true })).toHaveAttribute('aria-pressed', 'true');
      for (const n of SPANS[bucket]) {
        await screen.getByRole('button', String(n), { exact: true }).tap();
        await expect(screen.getByRole('button', String(n), { exact: true })).toHaveAttribute('aria-pressed', 'true');
        await analyticsMatch({ screen, browser }, bucket, n);
      }
    });
  }

  test('SAL-47 the five totals are the ranking: pressing one lights it (the bars re-rank by it)', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/analytics');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    for (const k of SALES_KINDS) {
      await screen.getByRole('button', new RegExp(`^${k.label}(?=\\s[\\dR])`, 'i')).tap();
      await expect(screen.getByRole('button', new RegExp(`^${k.label}(?=\\s[\\dR])`, 'i'))).toHaveAttribute('aria-pressed', 'true');
      expect((await readTiles(browser as Json)).filter((t) => t.pressed).map((t) => t.label)).toEqual([k.label]);
    }
  });

  for (const col of [
    { header: 'Takings', key: 'gross_minor' },
    { header: 'Transactions', key: 'sales_count' },
    { header: 'Units', key: 'units_sold' },
    { header: 'Avg Transaction', key: 'average_minor' },
  ] as const) {
    test(`SAL-48 sorting by "${col.header}": a second press reverses it`, { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales/analytics');
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      // Opens sorted by Takings, high to low.
      if (col.key !== 'gross_minor') {
        await screen.getByRole('button', col.header).tap();
      } else {
        await screen.getByRole('button', col.header).tap(); // second press: low to high
      }
      const first = col.key === 'gross_minor' ? false : true;
      await analyticsMatch({ screen, browser }, 'day', 30, { key: col.key, desc: first });
      await screen.getByRole('button', col.header).tap();
      await analyticsMatch({ screen, browser }, 'day', 30, { key: col.key, desc: !first });
    });
  }

  test("SAL-49 a store's row opens its sheet (same as the day sheet): facts equal the window report for the span", { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/analytics');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const range = spanOf('day', 30);
    const now = await series(range.from, range.to, 'day');
    const m = matrixOf(now);
    const top = [...m.sites].sort((a, b) => m.site(b.site_id, null, 'gross_minor') - m.site(a.site_id, null, 'gross_minor'))[0];
    await screen.getByRole('row').filter({ hasText: top.site_name }).first().tap();
    await expect(browser).toHaveURL(new RegExp(`store=${top.site_id}`));
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Receipts', { exact: true })).toBeVisible(WAIT);
    await expect(sheet.getByText('Takings', { exact: true })).toBeVisible();
  });
});
