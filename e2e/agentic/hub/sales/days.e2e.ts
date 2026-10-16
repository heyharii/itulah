// /sales (More › Sales): the fleet by trading day — the chart's five totals, the days table that
// unfolds into the shops, the comparison, the shop filter and the shop's day sheet — each held
// against GET /api/v1/reports/sales/series and /window.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  agree, bucketTitle, daysProblems, fmtCount, jakartaToday, matrixOf, OPENS_ON, previousSpanOf, readFacts, readGrid, readTables, dialogLines,
  readTiles, rp, series, showSales, SALES_KINDS, SPANS, spanOf, windowReport, num, type Bucket,
} from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The days table + tiles on screen against the series for (bucket, buckets). */
async function daysMatch(ctx: { screen: Json; browser: Json }, bucket: Bucket, buckets: number, opts: { focus?: string | null; compare?: { from: string; to: string; short: string } } = {}) {
  const { screen, browser } = ctx;
  const range = spanOf(bucket, buckets);
  const prior = opts.compare ? { ...opts.compare, bucket } : previousSpanOf(bucket, buckets);
  const got = await agree({
    api: async () => ({ now: await series(range.from, range.to, bucket), before: await series(prior.from, prior.to, bucket) }),
    read: async () => {
      const end = Date.now() + 90_000;
      let grid = await readGrid(browser);
      // The rows of the span just asked for (nothing is unfolded yet), not the previous span's.
      while (Date.now() < end && grid.body.length !== buckets) {
        await new Promise((r) => setTimeout(r, 1000));
        grid = await readGrid(browser);
      }
      return { grid, tiles: await readTiles(browser) };
    },
    stable: (api) => [api.now.cells, api.now.buckets, api.before.cells],
    check: (s, api) => {
      const bad = daysProblems(s.grid, api.now, bucket, { before: api.before, short: opts.compare?.short ?? 'vs prev', focus: opts.focus ?? null });
      const m = matrixOf(api.now, opts.focus ?? null);
      const mb = matrixOf(api.before, opts.focus ?? null);
      if (s.tiles.length !== 5) bad.push(`tiles ${s.tiles.length}`);
      SALES_KINDS.forEach((k, i) => {
        const t = s.tiles[i];
        if (!t) return;
        if (t.label !== k.label) bad.push(`tile ${i}: ${t.label} ≠ ${k.label}`);
        const w = showSales(k.kind, m.grand(k.kind));
        if (t.value !== w) bad.push(`tile ${k.label}: "${t.value}" ≠ "${w}"`);
        const wd = mb.grand(k.kind) === 0 ? (m.grand(k.kind) > 0 ? 'new' : '—') : null;
        if (wd !== null && t.sub !== wd) bad.push(`tile ${k.label} delta "${t.sub}" ≠ "${wd}"`);
      });
      return bad;
    },
    reload: async () => {
      await browser.reload();
      await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
    },
  });
  expect(got.problems, `${bucket} ${buckets} ${JSON.stringify(range)}`).toEqual([]);
  return got.api as { now: Json; before: Json };
}

describe('Sales › days', { tags: ['sales'] }, () => {
  test('SAL-37 the opening view (30 days): totals tiles, every day row, the Whole span foot and "vs prev" equal the API', { session: 'rina', tags: ['sales', 'smoke'], timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await expect(screen.getByRole('button', 'day')).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByRole('button', '30')).toHaveAttribute('aria-pressed', 'true');
    await daysMatch({ screen, browser }, 'day', 30);
  });

  for (const bucket of ['day', 'week', 'month'] as Bucket[]) {
    test(`SAL-38 resolution "${bucket}": each span (${SPANS[bucket].join(' · ')}) draws the right columns`, { session: 'rina', timeout: 900_000 }, async ({ app, screen, browser }) => {
      await app.open('/sales');
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      if (bucket !== 'day') await screen.getByRole('button', bucket).tap();
      await expect(screen.getByRole('button', bucket)).toHaveAttribute('aria-pressed', 'true');
      // The span a resolution opens on, and only the spans it offers.
      await expect(screen.getByRole('button', String(OPENS_ON[bucket]))).toHaveAttribute('aria-pressed', 'true');
      for (const n of SPANS[bucket]) await expect(screen.getByRole('button', String(n), { exact: true })).toBeVisible();
      for (const n of SPANS[bucket]) {
        await screen.getByRole('button', String(n), { exact: true }).tap();
        await expect(screen.getByRole('button', String(n), { exact: true })).toHaveAttribute('aria-pressed', 'true');
        await daysMatch({ screen, browser }, bucket, n);
      }
    });
  }

  test('SAL-39 the five totals are buttons: pressing one lights it and keeps every figure', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    for (const k of SALES_KINDS) {
      await screen.getByRole('button', new RegExp(`^${k.label}(?=\\s[\\dR])`, 'i')).tap();
      await expect(screen.getByRole('button', new RegExp(`^${k.label}(?=\\s[\\dR])`, 'i'))).toHaveAttribute('aria-pressed', 'true');
      const tiles = await readTiles(browser as Json);
      expect(tiles.filter((t) => t.pressed).map((t) => t.label)).toEqual([k.label]);
    }
    await daysMatch({ screen, browser }, 'day', 30);
  });

  test('SAL-40 a day unfolds into the shops that traded, biggest first, and folds again', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const range = spanOf('day', 30);
    const api = await series(range.from, range.to, 'day');
    const m = matrixOf(api);
    const day = [...m.buckets].reverse().find((b) => m.bucket(b, 'gross_minor') > 0)!;
    const traded = m.traded(day).sort((a, b) => m.site(b.site_id, day, 'gross_minor') - m.site(a.site_id, day, 'gross_minor'));
    const title = bucketTitle(day, 'day');
    await screen.getByRole('button', new RegExp(`^${title}`)).tap();
    const grid = await readGrid(browser as Json);
    const at = grid.body.findIndex((c) => c[0].text.startsWith(title));
    traded.forEach((s, i) => {
      const cells = grid.body[at + 1 + i];
      expect(cells[0].text).toBe(s.site_name);
      expect(cells[1].text).toBe(showSales('gross_minor', m.site(s.site_id, day, 'gross_minor')));
      expect(cells[3].text).toBe(showSales('sales_count', m.site(s.site_id, day, 'sales_count')));
    });
    await screen.getByRole('button', new RegExp(`^${title}`)).tap();
    await expect(screen.getByRole('button', traded[0].site_name, { exact: true })).toBeHidden();
  });

  test('SAL-41 naming a shop under a day narrows the whole screen to it (chart title, no Shops column); the picker takes it off', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const range = spanOf('day', 30);
    const api = await series(range.from, range.to, 'day');
    const m = matrixOf(api);
    const day = [...m.buckets].reverse().find((b) => m.bucket(b, 'gross_minor') > 0)!;
    const shop = m.traded(day)[0];
    await screen.getByRole('button', new RegExp(`^${bucketTitle(day, 'day')}`)).tap();
    await screen.getByRole('button', shop.site_name, { exact: true }).tap();
    await expect(browser).toHaveURL(new RegExp(`store=${shop.site_id}`));
    await expect(screen.getByText(shop.site_name, { exact: true }).first()).toBeVisible();
    await daysMatch({ screen, browser }, 'day', 30, { focus: shop.site_id });
    await expect(screen.getByRole('columnheader', 'Shops')).toBeHidden();
    // Off again through the picker's own clear.
    await screen.getByRole('button', 'Clear').tap();
    await expect(browser).not.toHaveURL(/store=/);
    await expect(screen.getByRole('columnheader', 'Shops')).toBeVisible();
  });

  test('SAL-42 the shop filter across every shop (16 or more): each shows only its own days and totals', { session: 'rina', timeout: 1_200_000 }, async ({ app, screen, browser }) => {
    const range = spanOf('day', 30);
    const api = await series(range.from, range.to, 'day');
    expect((api.sites as Json[]).filter((s) => s.site_kind === 'STORE').length).toBeGreaterThanOrEqual(16);
    for (const s of api.sites as Json[]) {
      await app.open(`/sales?store=${s.site_id}`);
      await expect(screen.getByRole('table')).toBeVisible(WAIT);
      await daysMatch({ screen, browser }, 'day', 30, { focus: s.site_id });
    }
  });

  test("SAL-43 a shop's takings under a day open that shop's day sheet: totals, tenders, drawer and receipts equal the window report", { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const range = spanOf('day', 30);
    const api = await series(range.from, range.to, 'day');
    const m = matrixOf(api);
    const day = [...m.buckets].reverse().find((b) => m.bucket(b, 'gross_minor') > 0)!;
    const shop = m.traded(day)[0];
    await screen.getByRole('button', new RegExp(`^${bucketTitle(day, 'day')}`)).tap();
    await screen.getByRole('button', showSales('gross_minor', m.site(shop.site_id, day, 'gross_minor')), { exact: true }).first().tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Receipts', { exact: true })).toBeVisible(WAIT);
    const got = await agree({
      api: () => windowReport(shop.site_id, day, day, 100),
      read: async () => ({ facts: await readFacts(browser as Json), tables: await readTables(browser as Json), lines: await dialogLines(browser as Json) }),
      stable: (w) => [w.sales, w.tenders, w.cash, w.returns, w.transactions.map((t: Json) => t.id)],
      check: (s, w) => {
        const bad: string[] = [];
        if (num(s.facts['Sales']) !== w.sales.count) bad.push(`Sales ${s.facts['Sales']} ≠ ${w.sales.count}`);
        if (num(s.facts['Units']) !== w.sales.units_sold) bad.push(`Units ${s.facts['Units']} ≠ ${w.sales.units_sold}`);
        if (s.facts['Average basket'] !== rp(w.sales.average_minor)) bad.push(`Average basket ${s.facts['Average basket']} ≠ ${rp(w.sales.average_minor)}`);
        if (num(s.facts['Voided']) !== w.sales.voided_count) bad.push(`Voided ${s.facts['Voided']} ≠ ${w.sales.voided_count}`);
        for (const line of [rp(w.cash.cash_expected_minor), rp(w.sales.gross_minor), rp(w.sales.net_minor), rp(w.sales.tax_minor)]) if (!s.lines.includes(line)) bad.push(`sheet lacks ${line}`);
        const receipts = s.tables.find((t) => t[0]?.[0] === 'Sale');
        if (!receipts) bad.push('no Receipts table');
        else if (receipts.length - 1 !== w.transactions.length) bad.push(`receipts ${receipts.length - 1} ≠ ${w.transactions.length}`);
        else (w.transactions as Json[]).forEach((t, i) => {
          if (!receipts[i + 1][0].startsWith(t.sale_number)) bad.push(`receipt ${i + 1} ${receipts[i + 1][0]} ≠ ${t.sale_number}`);
          if (num(receipts[i + 1][2]) !== t.units) bad.push(`${t.sale_number} units ${receipts[i + 1][2]}`);
          if (receipts[i + 1][3] !== rp(t.total_minor)) bad.push(`${t.sale_number} total ${receipts[i + 1][3]} ≠ ${rp(t.total_minor)}`);
        });
        const tenders = s.tables.find((t) => t[0]?.[0] === 'Method');
        if ((w.tenders as Json[]).length > 0) {
          if (!tenders) bad.push('no Taken in table');
          else (w.tenders as Json[]).forEach((t, i) => {
            if (num(tenders[i + 1]?.[1]) !== t.count) bad.push(`tender ${t.method} count ${tenders[i + 1]?.[1]}`);
            if (tenders[i + 1]?.[2] !== rp(t.amount_minor)) bad.push(`tender ${t.method} amount ${tenders[i + 1]?.[2]} ≠ ${rp(t.amount_minor)}`);
          });
        }
        return bad;
      },
      reload: async () => undefined,
      tries: 3,
    });
    expect(got.problems).toEqual([]);
    void shop; void fmtCount;
  });

  test('SAL-44 Compare: "Same dates last year" and a named span re-ask the server and relabel the column', { session: 'rina', timeout: 600_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales');
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('button', /^Compare/).tap();
    await screen.getByRole('button', 'Same dates last year').tap();
    await expect(browser).toHaveURL(/cmp=year/);
    const range = spanOf('day', 30);
    const lastYear = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - 365); return x.toLocaleDateString('en-CA'); };
    await expect(screen.getByRole('columnheader', `vs ${lastYear(range.from).slice(0, 4)}`)).toBeVisible();
    await daysMatch({ screen, browser }, 'day', 30, { compare: { from: lastYear(range.from), to: lastYear(range.to), short: `vs ${lastYear(range.from).slice(0, 4)}` } });
    // A span the reader names.
    await screen.getByRole('button', /^Compare/).tap();
    await screen.getByRole('button', 'Compare from').tap();
    await screen.getByRole('textbox', 'Type Compare from').fill('2026-09-01');
    await screen.getByRole('textbox', 'Type Compare from').press('Enter');
    await screen.getByRole('button', 'Compare to').tap();
    await screen.getByRole('textbox', 'Type Compare to').fill('2026-09-30');
    await screen.getByRole('textbox', 'Type Compare to').press('Enter');
    await screen.getByRole('button', 'Compare against that').tap();
    await expect(browser).toHaveURL(/cmp=custom/);
    await expect(screen.getByRole('columnheader', 'vs 1 Sept')).toBeVisible();
    await daysMatch({ screen, browser }, 'day', 30, { compare: { from: '2026-09-01', to: '2026-09-30', short: 'vs 1 Sept' } });
  });
});
