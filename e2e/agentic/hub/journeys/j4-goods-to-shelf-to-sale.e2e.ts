// J4 — Goods to shelf to sale. A PO for a new article is delivered to the DC, set up as an article and
// tagged → rina allots all 16 pieces in New allotment (store-01 gets 8, store-02 and store-03 get 4
// each) → the DC picks one list per shop, packs one carton per shop and sends one truck → store-01
// counts its carton in blind → a garment goes from the stockroom to the floor and the web till sells it →
// at every step what Inventory holds (per pool, per SKU) and what the Sales Explorer shows agree with
// what happened: DC minus allotted, store-01 minus sold, the rest on the road.
//
// Only store-01 has a node on the rig, so store-02 and store-03 stay "on the road".
import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as J from '../../support/journeys.ts';
import * as O from '../../support/outbound.ts';
import * as pos from '../../support/pos.ts';
import { signedIn } from '../../support/inventory.ts';
import { as, nudge, poNumbers, rows, waitFor } from '../../support/rig.ts';
import { explorer, explorerMatches, explorerOptions, jakartaToday, num, resolvePeriod } from '../../support/sales.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const L = J.lateChecks();

const QTY = 16;
/** [SKU index, store, pieces]: every piece of the article is given to a shop. */
const PLAN: [number, string, number][] = [
  [0, 'store-01', 2], [0, 'store-02', 2],
  [1, 'store-01', 2], [1, 'store-03', 2],
  [2, 'store-02', 2], [2, 'store-03', 2],
  [3, 'store-01', 4],
];
const piecesFor = (store: string) => PLAN.filter((p) => p[1] === store).reduce((s, p) => s + p[2], 0);
const SOLD_SKU = 3; // the SKU of which store-01 gets 4, one of them goes to the floor and is sold

/** Free/allotted/on-hand pieces of each of our SKUs in a pool, as the cloud's availability (Inventory) reports them. */
async function pool(poolId: string): Promise<number[]> {
  const a = rows(await J.cloud().get(`/api/v1/inventory/availability?source_pool_id=${encodeURIComponent(poolId)}&q=${S.t}&limit=50`));
  return S.skus.map((k: O.Sku) => a.find((r) => r.sku_code === k.sku_code)?.stock_qty ?? 0);
}
/** Wait until a pool holds exactly `want` of each SKU (the nodes report to the cloud every few seconds). */
async function poolIs(poolId: string, want: number[]) {
  await waitFor(`${poolId} to hold ${JSON.stringify(want)}`, async () => {
    await nudge('dc', 'cloud', 'store');
    return JSON.stringify(await pool(poolId)) === JSON.stringify(want) ? true : null;
  }, 180_000, 4_000);
}

/** The On Hand & Shortfall figures for the whole matching set: Stock · Allotted · On hand. */
async function metrics(browser: any): Promise<Record<string, number | null>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = (await browser.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll('div'))) {
      const label = (el as HTMLElement).innerText?.trim().toLowerCase();
      if (el.children.length === 0 && ['stock', 'allotted', 'on hand'].includes(label)) {
        const value = (el.nextElementSibling as HTMLElement | null)?.innerText?.trim();
        if (value !== undefined) out[label] = value;
      }
    }
    return out;
  })) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, num(v)]));
}

describe('J4 Goods to shelf to sale', { serial: true, tags: ['journey', 'j4', 'po', 'outbound', 'inventory', 'pos', 'sales'] }, () => {

  test('J4-01 a new article reaches the DC shelf: PO delivered and accepted, article set up, labels printed — 16 pieces free in dc.warehouse, 4 per SKU', { timeout: 480_000 }, async () => {
    S.sup = await J.ownSupplier('goods to shelf');
    const stock = await J.ownStock(S.sup, QTY);
    Object.assign(S, { t: stock.t, stock, skus: stock.skus, article: stock.article, articleId: stock.articleId, po: stock.poNumber });
    expect(S.skus).toHaveLength(4);
    expect((await poNumbers(S.po)).received_stock_units).toBe(QTY);
    await poolIs('dc.warehouse', [4, 4, 4, 4]);
    expect(await O.freeOf(S.skus[0])).toBe(4);
  });

  test('J4-02 rina allots every piece in New allotment (store-01 8 · store-02 4 · store-03 4): one allotment, Inventory now shows it promised', { timeout: 420_000 }, async ({ app, screen, browser }) => {
    await signedIn(app, browser, 'rina');
    await app.open(`/allotment/new?supplier=${S.sup.code}&articles=${S.articleId}`);
    await expect(screen.getByRole('heading', new RegExp(`^New allotment · ${S.sup.name}`))).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(new RegExp(`1 article · ${QTY} pcs to allot`))).toBeVisible({ timeout: 45_000 });
    for (const [i, store, qty] of PLAN) await O.cell(screen, S.skus[i].sku_code, O.storeLabel(store)).fill(String(qty));
    await expect(screen.getByText(`All ${QTY} allotted`)).toBeVisible();
    const submit = screen.getByRole('button', 'Submit').first();
    await expect(submit).toBeEnabled();
    await submit.tap();
    const saved = screen.getByText(/^Saved ALT-\d+ \(/);
    await expect(saved).toBeVisible({ timeout: 60_000 });
    S.allotmentNumber = (await saved.textContent())!.match(/ALT-\d+/)![0];
    const book = await O.allotmentByNumber(S.allotmentNumber);
    S.allotmentId = book!.id;
    expect(book).toMatchObject({ total_quantity: QTY, destination_count: 3 });
    const d = await O.allotmentDetail(S.allotmentId);
    for (const store of ['store-01', 'store-02', 'store-03']) {
      expect(d.lines.filter((l: Json) => l.destination_id === store).reduce((s: number, l: Json) => s + l.quantity, 0)).toBe(piecesFor(store));
    }
    expect(await O.freeOf(S.skus[0])).toBe(0);
    await L.late('Inventory › On Hand & Shortfall shows the pieces promised: Stock 16 · Allotted 16 · On hand 0', async () => {
      await app.open('/inventory/availability');
      await screen.getByRole('textbox').first().fill(S.t);
      await expect(screen.getByText(S.skus[0].sku_code, { exact: true })).toBeVisible({ timeout: 60_000 });
      const m = await metrics(browser);
      if (m['stock'] !== QTY || m['allotted'] !== QTY || m['on hand'] !== 0) throw new Error(`Stock/Allotted/On hand read ${JSON.stringify(m)}, expected ${QTY}/${QTY}/0`);
    });
  });

  test('J4-03 the DC picks one list per shop, packs one sealed carton per shop and sends one truck: the pieces leave dc.warehouse for the road', { timeout: 420_000 }, async () => {
    const picks = await O.waitToPick(S.allotmentNumber, 3);
    expect(picks).toHaveLength(3);
    const cartons: Json[] = [];
    for (const store of ['store-01', 'store-02', 'store-03']) {
      const sessions: string[] = [];
      for (const p of picks.filter((x) => x.destination_id === store)) sessions.push((await O.pick(p)).summary.session.session_id);
      const lines = PLAN.filter((p) => p[1] === store).map(([i, , qty]) => ({ sku_code: S.skus[i].sku_code, quantity: qty }));
      const manifest = await O.pack(store, lines, sessions);
      expect(manifest.koli.destination_store_id).toBe(store);
      cartons.push(manifest.koli);
    }
    S.trip = await O.dispatchTrip(cartons.map((k) => k.koli_id), `Truk ${S.t}`);
    expect(S.trip.shipments).toHaveLength(3);
    await poolIs('dc.warehouse', [0, 0, 0, 0]);
    expect(await O.freeOf(S.skus[0])).toBe(0);
  });

  test('J4-04 store-01 counts its carton in blind: it sees a delivery on the road but not what was packed; counting 8 receives it, Central shows 8 received', { timeout: 480_000 }, async () => {
    S.sj = O.shipmentOf(S.trip, 'store-01');
    const inbound = await O.inboundFor(S.sj.shipment_number);
    expect(inbound).toMatchObject({ status: 'IN_TRANSIT', result: null });
    const counts = PLAN.filter((p) => p[1] === 'store-01').map(([i, , qty]) => ({ sku_code: S.skus[i].sku_code, quantity: qty }));
    const got = await O.storeReceive(inbound.delivery_id, counts);
    expect(got.delivery.status).toBe('RECEIVED');
    expect(got.delivery.result).toEqual({ expected_units: piecesFor('store-01'), received_units: piecesFor('store-01'), missing_units: 0, extra_units: 0 });
    const d = await O.waitDetail(S.allotmentId, (x) => x.received_qty >= piecesFor('store-01'));
    expect(d.received_qty).toBe(piecesFor('store-01'));
    expect(d.receiving_gap_qty).toBe(0);
    // store-02 and store-03 have no node on this rig: their cartons are still on the truck
    const road = rows(await as('dc', 'yusuf').get('/api/v1/dc/shipments')).filter((x) => x.dispatch_id === S.trip.dispatch.dispatch_id && x.destination_store_id !== 'store-01');
    expect(road.map((x) => x.position)).toEqual(['IN_TRANSIT', 'IN_TRANSIT']);
  });

  test('J4-05 a garment goes from the stockroom to the shop floor: Inventory shows the stockroom 2·2·0·4 and the floor 0·0·0·1', { timeout: 300_000 }, async () => {
    await poolIs('store-01.warehouse', [2, 2, 0, 4]);
    const at = await pos.places();
    S.epc = Object.entries(at)
      .filter(([e, place]) => place === 'store-01.warehouse:on_hand' && e.slice(2, 13) === S.skus[SOLD_SKU].sku_code)
      .map(([e]) => e)
      .sort()[0];
    expect(S.epc, 'a counted-in garment of the SKU in the stockroom').toBeTruthy();
    await J.moveToFloor(S.epc);
    await poolIs('store-01.floor', [0, 0, 0, 1]);
    await poolIs('store-01.warehouse', [2, 2, 0, 3]);
  });

  test('J4-06 dian sells it at the web till, cash: the till total is the shop\'s quote, the node books the sale, the garment is out of the floor', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    const sale = await J.tillSale(J.tillOf(app, screen, browser), [S.epc], {}, L);
    S.saleId = sale.saleId;
    S.due = sale.due;
    expect(S.due).toBeGreaterThan(0);
    expect((await pos.receipt(S.saleId)).total_minor).toBe(S.due);
    expect(await pos.placeOf(S.epc)).toBe('external/customer');
  });

  test('J4-07 Inventory agrees with what happened: DC 0 · stockroom 2·2·0·3 · floor 0 · on the road 2·2·4·0 — all 16 pieces accounted for, one of them sold', { timeout: 420_000 }, async () => {
    await poolIs('store-01.floor', [0, 0, 0, 0]);
    const where = {
      dc: await pool('dc.warehouse'),
      stockroom: await pool('store-01.warehouse'),
      floor: await pool('store-01.floor'),
      road: await pool('dc.outbound.in-transit'),
    };
    expect(where).toEqual({ dc: [0, 0, 0, 0], stockroom: [2, 2, 0, 3], floor: [0, 0, 0, 0], road: [2, 2, 4, 0] });
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(where.dc) + sum(where.stockroom) + sum(where.floor) + sum(where.road) + 1, 'every piece is somewhere, the sold one included').toBe(QTY);
  });

  test('J4-08 Sales Explorer agrees: the sale reached head office and the article shows one piece sold for the amount that was paid', { timeout: 480_000 }, async ({ app, screen, browser }) => {
    await waitFor('the sale at head office', async () => {
      await nudge('store', 'cloud');
      const list = await J.cloud().get('/api/v1/sales?limit=500');
      return (list.items ?? list.rows ?? []).find((s: Json) => s.id === S.saleId);
    }, 240_000, 4_000);
    const options = await explorerOptions();
    const r = resolvePeriod('', jakartaToday(), options.latest_day, options.earliest_day);
    const row = await waitFor('the article in the Explorer', async () => {
      await nudge('store', 'cloud');
      const api = await explorer({ ...r, group: 'article', q: S.t });
      return (api.rows as Json[])[0] ?? null;
    }, 240_000, 4_000);
    expect(row.figures ?? row).toMatchObject({ sales_minor: S.due });
    expect(JSON.stringify(row)).toContain(S.article);
    await signedIn(app, browser, 'rina');
    await L.late('the Sales Explorer page equals the API for this article', async () => {
      await app.open(`/sales/explorer?f=${encodeURIComponent('g=article')}`);
      await expect(screen.getByRole('textbox', 'Search articles')).toBeVisible({ timeout: 120_000 });
      await screen.getByRole('textbox', 'Search articles').fill(S.t);
      await explorerMatches({ screen, browser }, { ...r, group: 'article', q: S.t });
    });
  });

  test('J4-99 [bug] the screens along the way agree with the books (misses collected along the journey)', { tags: ['bug'] }, async () => {
    expect(L.misses, 'screen checks that missed').toEqual([]);
  });
});
