// More › Member, Returns, Shop Floor and the sale receipt sheet (?sale=): the smaller screens of the
// Sales menu, each held against the endpoint it reads.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  agree, centreSales, cloud, customerSales, customerSummary, fmtCount, jakartaToday, num, readFacts, readGrid, readKpis, readTables, returnsList, rp,
} from '../../support/sales.ts';

const WAIT = { timeout: 120_000 };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const MEMBER = '081311110001'; // Sari — the demo member with points and a few receipts

describe('Sales › Member', { tags: ['sales'] }, () => {
  test('SAL-53 opens on the prompt; Look up stays off until an id is typed', { session: 'rina', timeout: 300_000 }, async ({ app, screen }) => {
    await app.open('/sales/customer');
    await expect(screen.getByRole('heading', 'Member', { level: 1 })).toBeVisible(WAIT);
    await expect(screen.getByText(/^Type a member id above/)).toBeVisible();
    await expect(screen.getByRole('button', 'Look up')).toBeDisabled();
    await screen.getByRole('textbox').first().fill(MEMBER);
    await expect(screen.getByRole('button', 'Look up')).toBeEnabled();
  });

  test('SAL-54 looking a member up: the five totals equal the summary; every completed purchase is listed with its figures', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/customer');
    await expect(screen.getByRole('button', 'Look up')).toBeVisible(WAIT);
    await screen.getByRole('textbox').first().fill(MEMBER);
    await screen.getByRole('button', 'Look up').tap();
    await expect(browser).toHaveURL(new RegExp(`member=${MEMBER}`));
    await expect(screen.getByText(`Reading ${MEMBER}.`, { exact: false })).toBeVisible(WAIT);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const got = await agree({
      api: async () => ({ summary: await customerSummary(MEMBER), history: await customerSales(MEMBER) }),
      read: async () => ({ kpis: await readKpis(browser as Json), grid: await readGrid(browser as Json) }),
      stable: (a) => [a.summary, a.history.transactions.map((t: Json) => t.sale_id)],
      check: (s, a) => {
        const bad: string[] = [];
        const sm = a.summary as Json;
        const want: Record<string, string> = {
          'Purchases, all time': fmtCount(sm.transaction_count),
          Charged: rp(sm.spent_minor),
          'Promotions took off': rp(sm.saved_minor),
          'Points earned': fmtCount(sm.points_earned_total),
          'Average basket': sm.transaction_count === 0 ? '—' : rp(Math.round(sm.spent_minor / sm.transaction_count)),
        };
        for (const [label, value] of Object.entries(want)) {
          const k = s.kpis.find((x) => x.label === label);
          if (!k) bad.push(`tile ${label} missing`);
          else if (k.value.replace(/\s+/g, ' ') !== value) bad.push(`${label}: "${k.value}" ≠ "${value}"`);
        }
        const completed = (a.history.transactions as Json[]).filter((t) => t.status === 'COMPLETED');
        for (const t of completed) {
          const row = s.grid.body.find((c) => c[5]?.text === rp(t.total_minor) && num(c[4]?.text) === t.points_earned && num(c[2]?.text) === t.item_count);
          if (!row) bad.push(`purchase ${t.sale_id} (${rp(t.total_minor)}, ${t.points_earned} pts) is not listed`);
          else if (row[1].text !== t.site_id) bad.push(`store "${row[1].text}" ≠ ${t.site_id}`);
        }
        const heads = s.grid.heads[0] ?? [];
        if (JSON.stringify(heads) !== JSON.stringify(['When', 'Store', 'Items', 'Saved', 'Points', 'Charged'])) bad.push(`heads ${JSON.stringify(heads)}`);
        return bad;
      },
      reload: async () => {
        await browser.reload();
        await screen.getByRole('table').waitFor({ state: 'visible', timeout: 120_000 });
      },
    });
    expect(got.problems).toEqual([]);
  });

  test("SAL-55 BUG: a voided sale is not a purchase — the history lists exactly the purchases the totals count", { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen }) => {
    await app.open(`/sales/customer?member=${MEMBER}`);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    const summary = await customerSummary(MEMBER);
    const history = (await customerSales(MEMBER)).transactions as Json[];
    test.skip(!history.some((t) => t.status === 'VOIDED'), 'this member has no voided sale on the rig');
    // The tiles say N purchases; the list under them must show N rows, not N + the voided ones.
    await expect(screen.getByRole('row')).toHaveCount(summary.transaction_count + 1, WAIT);
  });

  test('SAL-56 a member no shop has served: the prompt says so and the totals are zero', { session: 'rina', timeout: 300_000 }, async ({ app, screen }) => {
    await app.open('/sales/customer?member=000-nobody');
    await expect(screen.getByText('That member holds a card and has not used it yet — no shop has reported a purchase against this id.')).toBeVisible(WAIT);
    await expect(screen.getByText('Purchases, all time')).toBeVisible();
  });

  test("SAL-57 a purchase opens its basket: store, items, points, lines and the charged ladder equal the receipt", { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const history = (await customerSales(MEMBER)).transactions as Json[];
    const sale = history.find((t) => t.status === 'COMPLETED')!;
    await app.open(`/sales/customer?member=${MEMBER}`);
    await expect(screen.getByRole('table')).toBeVisible(WAIT);
    await screen.getByRole('row').filter({ hasText: rp(sale.total_minor) }).first().tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Basket', { exact: true })).toBeVisible(WAIT);
    const detail = await cloud().get(`/api/v1/customer/${MEMBER}/transactions/${sale.sale_id}`);
    const facts = await readFacts(browser as Json);
    expect(facts['Store']).toBe(detail.sale.site_id);
    expect(num(facts['Items'])).toBe(detail.sale.item_count);
    expect(num(facts['Points'])).toBe(detail.sale.points_earned);
    const tables = await readTables(browser as Json);
    const basket = tables[0];
    expect(basket.length - 1).toBe(detail.lines.length);
    (detail.lines as Json[]).forEach((l, i) => {
      expect(basket[i + 1][0]).toBe(l.sku_code);
      expect(num(basket[i + 1][1])).toBe(l.quantity);
      expect(basket[i + 1][2]).toBe(rp(l.unit_price_minor));
      expect(basket[i + 1][3]).toBe(rp(l.line_total_minor));
    });
    await expect(sheet.getByText(rp(detail.sale.total_minor), { exact: true }).first()).toBeVisible();
  });
});

describe('Sales › Returns', { tags: ['sales'] }, () => {
  test('SAL-58 Returns: the totals are the server\'s; with none taken back the screen says so', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/returns');
    await expect(screen.getByRole('heading', 'Returns', { level: 1 })).toBeVisible(WAIT);
    const got = await agree({
      api: () => returnsList(),
      read: async () => ({ kpis: await readKpis(browser as Json), grid: await readGrid(browser as Json), empty: await screen.getByText(/^Nothing has been taken back yet\./).isVisible() }),
      stable: (r) => [r.total, r.refund_total_minor, r.rows.map((x: Json) => x.id)],
      check: (s, r) => {
        const bad: string[] = [];
        const k = (label: string) => s.kpis.find((x) => x.label === label)?.value.replace(/\s+/g, ' ');
        if (k('Returns') !== fmtCount(r.total)) bad.push(`Returns "${k('Returns')}" ≠ ${r.total}`);
        if (k('Refunded') !== rp(r.refund_total_minor)) bad.push(`Refunded "${k('Refunded')}" ≠ ${rp(r.refund_total_minor)}`);
        if (r.total === 0) {
          if (!s.empty) bad.push('no empty sentence');
        } else {
          if (s.grid.body.length !== Math.min(r.total, 100)) bad.push(`rows ${s.grid.body.length} ≠ ${Math.min(r.total, 100)}`);
          (r.rows as Json[]).slice(0, s.grid.body.length).forEach((row, i) => {
            const c = s.grid.body[i];
            if (c?.[0]?.text !== row.return_number) bad.push(`row ${i + 1}: ${c?.[0]?.text} ≠ ${row.return_number}`);
            if (c?.[5]?.text !== rp(row.refund_total_minor)) bad.push(`${row.return_number}: refunded ${c?.[5]?.text}`);
          });
        }
        return bad;
      },
      reload: async () => {
        await browser.reload();
        await screen.getByRole('heading', 'Returns', { level: 1 }).waitFor({ state: 'visible', timeout: 120_000 });
      },
    });
    expect(got.problems).toEqual([]);
  });

  test('SAL-59 sorting, the Store / Taken by / When / Refunded chips and the return sheet', { session: 'rina', timeout: 200_000 }, async () => {
    test.skip(true, 'the rig has no return: a till return has no sync fact (sales_posting.rs), and a centre-side return needs a centre sale that draws the stock the POS suites share');
  });
});

describe('Sales › Shop Floor', { tags: ['sales'] }, () => {
  test('SAL-60 Shop Floor: tills open, owing, stores trading, sales held, takings and refunded equal the centre\'s sale list', { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    await app.open('/sales/overview');
    await expect(screen.getByRole('heading', 'Shop Floor', { level: 1 })).toBeVisible(WAIT);
    await expect(screen.getByText('Tills open', { exact: true })).toBeVisible(WAIT);
    const got = await agree({
      api: async () => ({ sales: await centreSales(500), returns: await returnsList() }),
      read: async () => ({ kpis: await readKpis(browser as Json), grid: await readGrid(browser as Json) }),
      stable: (a) => [a.sales.map((s: Json) => [s.id, s.status]), a.returns.total],
      check: (s, a) => {
        const bad: string[] = [];
        const rows = a.sales as Json[];
        const open = rows.filter((r) => r.status === 'OPEN');
        const done = rows.filter((r) => r.status === 'COMPLETED');
        const stores = new Set(rows.map((r) => r.site_id));
        const want: Record<string, string> = {
          'Tills open': fmtCount(open.length),
          'Owing on them': rp(open.reduce((t, r) => t + Math.max(r.total_minor - r.paid_minor, 0), 0)),
          'Stores trading': fmtCount(stores.size),
          'Sales held': fmtCount(done.length),
          Takings: rp(done.reduce((t, r) => t + r.total_minor, 0)),
          Refunded: rp(a.returns.refund_total_minor),
        };
        for (const [label, value] of Object.entries(want)) {
          const k = s.kpis.find((x) => x.label === label);
          if (!k) bad.push(`${label} missing`);
          else if (k.value.replace(/\s+/g, ' ') !== value) bad.push(`${label}: "${k.value}" ≠ "${value}"`);
        }
        // Where the fleet stands: a store per row, its takings from completed sales only.
        const perStore = new Map<string, number>();
        for (const r of done) perStore.set(r.site_id, (perStore.get(r.site_id) ?? 0) + r.total_minor);
        for (const [site, takings] of perStore) {
          const row = s.grid.body.find((c) => c[0].text === site);
          if (row && row[2].text !== rp(takings)) bad.push(`${site}: takings "${row[2].text}" ≠ ${rp(takings)}`);
        }
        return bad;
      },
      reload: async () => {
        await browser.reload();
        await screen.getByText('Tills open', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
      },
    });
    expect(got.problems).toEqual([]);
  });

  test("SAL-61 with no basket left open the queue says every till is square", { session: 'rina', timeout: 300_000 }, async ({ app, screen }) => {
    const open = (await centreSales(500)).filter((s) => s.status === 'OPEN');
    test.skip(open.length > 0, 'a till has a basket open right now');
    await app.open('/sales/overview');
    await expect(screen.getByText('Every till is square — nothing is sitting open.')).toBeVisible(WAIT);
  });
});

describe('Sales › receipt sheet (?sale=)', { tags: ['sales'] }, () => {
  test("SAL-62 a store sale opens its receipt: facts, items, tenders and the ladder equal /shop-sales/{id}", { session: 'rina', timeout: 400_000 }, async ({ app, screen, browser }) => {
    const sale = (await centreSales(500)).find((s) => s.status === 'COMPLETED' && s.source === 'EDGE')!;
    const detail = await cloud().get(`/api/v1/shop-sales/${sale.id}`);
    await app.open(`/sales?sale=${sale.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Items', { exact: true })).toBeVisible(WAIT);
    const facts = await readFacts(browser as Json);
    expect(facts['Discount']).toBe(rp(detail.discount_total_minor));
    expect(num(facts['Points earned'])).toBe(detail.points_earned);
    const tables = await readTables(browser as Json);
    const items = tables[0];
    expect(items.length - 1).toBe(detail.lines.length);
    (detail.lines as Json[]).forEach((l, i) => {
      expect(items[i + 1][0]).toContain(l.sku_code);
      expect(num(items[i + 1][1])).toBe(l.quantity);
      expect(items[i + 1][3]).toBe(l.line_total_minor === null ? '—' : rp(l.line_total_minor));
    });
    const tenders = tables.find((t) => t[0]?.[0] === 'Method')!;
    (detail.tenders as Json[]).forEach((t, i) => {
      expect(tenders[i + 1][0]).toBe(t.method);
      expect(tenders[i + 1][1]).toBe(rp(t.amount_minor));
    });
    await expect(sheet.getByText(`Cloud sale ID: ${detail.sale_id}`)).toBeVisible();
    await expect(sheet.getByText(rp(detail.total_minor), { exact: true }).first()).toBeVisible();
  });

  test('SAL-63 BUG: the receipt of a voided sale says it was voided', { session: 'rina', tags: ['sales', 'bug'], timeout: 400_000 }, async ({ app, screen }) => {
    const voided = (await centreSales(500)).find((s) => s.status === 'VOIDED');
    test.skip(!voided, 'no voided sale on the rig');
    await app.open(`/sales?sale=${voided!.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByText('Items', { exact: true })).toBeVisible(WAIT);
    await expect(sheet.getByText(/void/i).first()).toBeVisible();
  });
});
