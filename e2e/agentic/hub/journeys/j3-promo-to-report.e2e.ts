// J3 — Promo to report. rina creates and publishes a promotion in Marketing (20% off one article of our
// own, behind a coupon code, filed under a campaign of ours) → store-01's quote shows it, and applies it
// only with the code → dian rings the sale up at the web till with the coupon → the sale reaches head
// office and the promotion's use counters → Sales by campaign shows the sale under the campaign →
// Finance shows the money (Sales by day, and the day's takings document for the shop).
//
// The article is one we set up ourselves and walked to store-01's floor (ownFloorUnits), so the shop's
// shared stock is not spent and no other suite's basket meets the promotion (it fires only with its code).
// Cash only, and never a bag charge (it blocks store-01's sync, TILL-45b). EDC settlement is ignored.
import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';
import * as J from '../../support/journeys.ts';
import * as pos from '../../support/pos.ts';
import { signedIn } from '../../support/inventory.ts';
import { closeList, makeCampaign, promoIn, publishSheet, ruleNamed, shopSees, tag, usageOf } from '../../support/marketing.ts';
import { as, nudge, waitFor } from '../../support/rig.ts';
import { breakdown, jakartaToday, num, readGrid, windowReport } from '../../support/sales.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const L = J.lateChecks();
const PERCENT = 20;

describe('J3 Promo to report', { serial: true, tags: ['journey', 'j3', 'marketing', 'pos', 'sales', 'finance'] }, () => {

  test('J3-01 a garment of our own stands on store-01\'s floor (set up, allotted, packed, sent, counted in, put out) and the shop quotes its price', { timeout: 420_000 }, async () => {
    S.sup = await J.ownSupplier('promo to report');
    const shelf = await J.ownFloorUnits(S.sup, { onFloor: 1 });
    S.t = shelf.stock.t;
    S.article = shelf.stock.article;
    S.epc = shelf.epcs[0];
    S.sku = S.epc.slice(2, 13);
    S.articleCode = S.sku.slice(0, 8);
    expect(await pos.placeOf(S.epc)).toBe(pos.FLOOR);
    const q = await pos.quote([S.epc]);
    S.price = pos.dueOf(q);
    expect(S.price, 'the shop prices a brand-new article from the opening price book').toBeGreaterThan(0);
    S.benefit = Math.round((S.price * PERCENT) / 100);
  });

  test('J3-02 rina creates the promotion in Marketing › New promotion: 20% off our article, coupon code, filed under a campaign — published and ACTIVE', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    S.campaignName = `Jurnal ${S.t}`;
    S.campaignId = await makeCampaign(S.campaignName);
    S.promoName = `Diskon ${S.t}`;
    S.code = tag('KJ');
    await signedIn(app, browser, 'rina');
    await app.open('/commercial/promotions');
    await screen.getByRole('button', 'New promotion').first().tap();
    const dialog = screen.getByRole('dialog');
    await expect(dialog).toContainText('Summary', { timeout: 60_000 });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(S.promoName);
    await dialog.getByRole('textbox', 'Per cent off').fill(String(PERCENT));
    await screen.getByRole('combobox', 'The articles this promotion applies to').fill(S.article);
    await screen.getByRole('option').filter({ hasText: S.article }).first().tap();
    await closeList(screen);
    const limits = dialog.getByRole('button', { name: /^Limits/ });
    if ((await dialog.getByRole('textbox', 'Coupon code').count()) === 0) await limits.tap();
    await dialog.getByRole('textbox', 'Coupon code').fill(S.code);
    await dialog.getByRole('combobox', 'The campaign this offer belongs to').fill(S.campaignName);
    await screen.getByRole('option').filter({ hasText: S.campaignName }).first().tap();
    await publishSheet(screen);

    const rule = await ruleNamed(S.promoName);
    expect(rule, 'the published rule').toBeDefined();
    S.ruleId = rule!.rule_id;
    expect(rule!.status).toBe('ACTIVE');
    expect(rule!.coupon_code).toBe(S.code);
    expect(rule!.definition.effect).toMatchObject({ kind: 'PERCENT', bps: PERCENT * 100 });
    expect(rule!.definition.scope.applicability).toMatchObject({ on: 'ARTICLE', article_codes: [S.articleCode] });
    expect(rule!.definition.campaign_id).toBe(S.campaignId);
  });

  test('J3-03 store-01 hears of it: its quote lists the promotion, applies it with the code (−20%) and refuses it without', { timeout: 300_000 }, async () => {
    await shopSees(S.ruleId);
    const withCode = await J.waitFor('the shop to apply the coupon', async () => {
      const e = await promoIn([S.epc], S.ruleId, { coupons: [S.code] });
      return e?.applied ? e : null;
    }, 90_000, 2_000);
    expect(withCode.benefit_minor).toBe(S.benefit);
    const without = await promoIn([S.epc], S.ruleId);
    expect(without.applied).toBe(false);
    expect(without.reason ?? '').toMatch(/coupon/i);
  });

  test('J3-04 dian rings it up at the web till with the coupon, pays cash: the till total is the shop\'s quote, the node books the sale and the garment leaves the floor', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    S.before = await as('store', 'maya').get(`/api/v1/store/reports/sales/window?from=${J.todayJakarta()}&to=${J.todayJakarta()}`);
    const sale = await J.tillSale(J.tillOf(app, screen, browser), [S.epc], { coupon: S.code, promo: { name: S.promoName, benefit: S.benefit } }, L);
    S.saleId = sale.saleId;
    S.due = sale.due;
    S.shiftDay = (await pos.myShifts()).open?.business_date as string; // a sale trades for its shift's day (sales_posting.rs), not the calendar day it was rung
    expect(S.due).toBe(S.price - S.benefit);
    const r = await pos.receipt(S.saleId);
    expect(r.total_minor).toBe(S.due);
    expect((r.tenders as Json[]).find((x) => x.method === 'CASH')?.amount_minor).toBeGreaterThanOrEqual(S.due);
    expect((await pos.saleInWindow(S.saleId))?.total_minor).toBe(S.due);
    expect(await pos.placeOf(S.epc)).toBe('external/customer');
  });

  test('J3-05 the sale reaches head office and the promotion and its campaign each count one use of the discount', { timeout: 420_000 }, async () => {
    const synced = await waitFor('the sale at head office', async () => {
      await nudge('store', 'cloud');
      const list = await J.cloud().get('/api/v1/sales?limit=500');
      return (list.items ?? list.rows ?? []).find((s: Json) => s.id === S.saleId);
    }, 240_000, 4_000);
    expect(synced).toMatchObject({ site_id: 'store-01', total_minor: S.due, status: 'COMPLETED' });
    const rule = await waitFor('the rule\'s use', async () => {
      await nudge('store', 'cloud');
      const u = await usageOf('RULE', S.ruleId);
      return u && u.uses >= 1 ? u : null;
    }, 180_000, 4_000);
    expect(rule).toMatchObject({ uses: 1, spent_minor: S.benefit });
    const campaign = await usageOf('CAMPAIGN', S.campaignId);
    expect(campaign).toMatchObject({ uses: 1, spent_minor: S.benefit });
  });

  test('J3-06 Sales › by campaign shows the sale under the campaign: one piece, the net amount that was paid', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    const from = `${jakartaToday().slice(0, 4)}-01-01`;
    const to = jakartaToday();
    const row = await waitFor('the campaign in Sales by campaign', async () => {
      await nudge('store', 'cloud');
      return ((await breakdown('campaign', from, to)).rows as Json[]).find((r) => r.code === S.campaignId);
    }, 240_000, 4_000);
    expect(row).toMatchObject({ name: S.campaignName, quantity: 1, net_minor: S.due });
    await signedIn(app, browser, 'rina'); // the till visit left the hub's cookie to the till's login
    await L.late('Sales by campaign draws the campaign with its quantity and sales', async () => {
      await app.open('/sales/by-campaign');
      await expect(screen.getByRole('heading', { name: 'Sales by campaign', level: 1 })).toBeVisible({ timeout: 90_000 });
      await screen.getByRole('textbox', 'Search campaigns').fill(S.campaignName);
      await expect(screen.getByText(S.campaignName, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      const grid = await readGrid(browser);
      const line = grid.body.find((r) => r[0]?.text === S.campaignName);
      if (!line) throw new Error(`no row "${S.campaignName}" in ${JSON.stringify(grid.body.map((r) => r[0]?.text))}`);
      if (num(line[1]?.text) !== 1 || num(line[2]?.text) !== S.due) throw new Error(`the row reads ${JSON.stringify(line.map((c) => c.text))}, expected 1 piece and ${S.due}`);
    });
  });

  test('J3-07 Finance sees the money: the day\'s receipts at head office list the sale as CASH, the shop\'s takings document for the day carries the cash, Sales by day shows the Cash row', { timeout: 420_000 }, async ({ app, screen }) => {
    const day = jakartaToday();
    const tx = await waitFor('the sale in the day\'s receipts', async () => {
      await nudge('store', 'cloud');
      return ((await windowReport('store-01', day, day, 200)).transactions as Json[]).find((t) => t.id === S.saleId);
    }, 180_000, 4_000);
    expect(tx).toMatchObject({ total_minor: S.due, units: 1, methods: ['CASH'] });
    // the shop's takings document for the day the sale trades on (a DRAFT — nothing is posted here: the day holds other suites' sales too)
    const made = await F.cloud().call('POST', '/api/v1/finance/sales-postings/generate', { site_id: 'store-01', business_date: S.shiftDay }, { ok: false });
    if (made?.error) {
      // The rig posts a day at demo time; a sale rung later on the same shift lands in a day that is already in the books.
      // By design a posted day is corrected by reversing it, never regenerated over — so the sale is not in the books yet.
      expect(made.error, `the takings of ${S.shiftDay}`).toMatch(/already posted/);
      const posted = ((await F.cloud().get('/api/v1/finance/sales-postings')) as Json[]).find((p) => p.site_id === 'store-01' && p.business_date === S.shiftDay);
      expect(posted?.status).toBe('POSTED');
      expect(Date.parse(posted.posted_at), 'the day was posted before this sale was rung, so it is not in that entry').toBeLessThan(Date.parse(tx.completed_at));
    } else {
      const doc = made.posting ? made : await F.cloud().get(`/api/v1/finance/sales-postings/${made.posting_id}`);
      expect(doc.posting.status).toBe('DRAFT');
      expect(doc.posting.sale_count).toBeGreaterThanOrEqual(1);
      const cash = (doc.lines as Json[]).find((l) => l.method === 'CASH');
      expect(cash, 'a CASH takings line').toBeTruthy();
      expect(cash.gross_minor).toBeGreaterThanOrEqual(S.due);
      expect(doc.exceptions ?? []).toEqual([]);
    }
    // Finance's Sales by day files the sale under its shift's day (S.shiftDay); Sales › reports use the calendar day it was rung.
    await L.late(`Finance › Stores › Sales by day lists the Cash row of ${S.shiftDay}, the day the sale trades on`, async () => {
      const [, mm, dd] = S.shiftDay.split('-');
      const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1];
      const dailyCash = async () => ((await F.cloud().get(`/api/v1/reports/sales/daily?site_id=store-01&date=${S.shiftDay}`)).tenders as Json[]).find((t) => t.method === 'CASH')?.amount_minor as number;
      expect(await dailyCash(), 'the shift day\'s cash at head office includes this sale').toBeGreaterThanOrEqual(S.due);
      let want = await dailyCash();
      for (let i = 0; i < 4; i++) {
        await app.open('/finance/stores/sales?store=store-01');
        await expect(screen.getByRole('heading', { name: 'Sales by day', level: 1 })).toBeVisible({ timeout: 60_000 });
        await screen.getByRole('button', { name: new RegExp(`\\b${Number(dd)} ${mon}\\b`) }).tap();
        try {
          await expect(F.rowOf(screen, 'Cash').first()).toContainText(F.money(want), { timeout: 20_000 });
          return;
        } catch (e) {
          const now = await dailyCash();
          if (now === want) throw e; // the books stood still and the screen still disagrees
          want = now; // other sales landed meanwhile
        }
      }
      throw new Error('the day kept moving');
    });
  });

  test('J3-99 [bug] the screens along the way agree with the books (misses collected along the journey)', { tags: ['bug'] }, async () => {
    expect(L.misses, 'screen checks that missed').toEqual([]);
  });
});
