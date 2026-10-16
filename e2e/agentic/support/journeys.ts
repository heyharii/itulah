// Cross-domain journeys: helpers that belong to no single domain. Everything a domain already
// owns is imported from its own file (rig, po, finance, marketing, pos, outbound, inventory, sales).
//
// What is new here:
//  * `ownSupplier` — a supplier of our own. The shared helpers look supplier 0001 up in the first 50
//    rows of /suppliers and the rig now holds hundreds (GAR… codes sort first), so `makeItem`,
//    `makeItemFast`, `makeOwnItem` all throw "supplier 0001 missing". A journey on its own supplier
//    also reads its payable (ledger, ageing) without anyone else's postings in it.
//  * `ownStock` — PO → delivery → article setup → tagging, the same arrange as outbound.ts `buildStock`
//    (which is not exported and leans on the broken lookup).
//  * the money readers a journey proves each hand-off with.
//  * the till driven inside the hub browser (the web till is a Vite server of its own on :5584).
import { expect } from 'e2e';
import { randomUUID } from 'node:crypto';
import { PORTS, RIG } from './base.ts';
import { as, deliver, nudge, placePo, rows, tag, uid, waitFor, type ItemCtx } from './rig.ts';
import { PRINTER_PORT, availability, inboundFor, shipmentOf, storeReceive, toInTransit, type Sku } from './outbound.ts';
import * as F from './finance.ts';
import * as pos from './pos.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type App = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { tag, uid, waitFor, nudge, rows, as };
export const cloud = F.cloud;

// ── suppliers and items of our own ───────────────────────────────────────────

export interface OwnSupplier {
  id: string;
  code: string;
  name: string;
}

/** Found by name or created once and reused by every run (the supplier master must not fill up with test suppliers). */
export async function ownSupplier(kind: string): Promise<OwnSupplier> {
  const name = `Journey e2e ${kind}`;
  const found = ((await cloud().get(`/api/v1/suppliers?q=${encodeURIComponent(name)}&limit=50`)).rows as Json[]).find((s) => s.name === name);
  if (found) return { id: found.supplier_id, code: found.supplier_code, name: found.name };
  const s = await cloud().post('/api/v1/suppliers', {
    name,
    contact_name: 'Uji Journey',
    phone: null,
    email: null,
    address: 'Jl. Uji',
    status: 'ACTIVE',
    category: 'MERCHANDISE',
    legal_form: 'PT',
  });
  return { id: s.supplier_id, code: s.supplier_code, name: s.name };
}

/** A sourcing item (2 colours × 2 sizes = 4 SKUs once set up) on our supplier, as the shared `makeItem`, minus the lookup. */
export async function ownItem(sup: OwnSupplier, t: string, price = 40_000): Promise<ItemCtx> {
  const item = await cloud().post(`/api/v1/suppliers/${sup.id}/items`, {
    supplier_item_code: `${t}-KAO`,
    name: `Kaos Uji ${t}`,
    unit_price_minor: price,
    currency: 'IDR',
    status: 'ACTIVE',
    division_code: 'PRIA',
    tags: ['KAOS'],
    colour_codes: ['BLACK', 'WHITE'],
    size_codes: ['03', '04'],
  });
  return { supplier: { supplier_id: sup.id, supplier_code: sup.code, name: sup.name }, item };
}

/** A fresh PO of `qty` pieces on our supplier, raised through the route New PO uses. */
export async function ownPo(sup: OwnSupplier, qty: number, { price = 40_000, t = tag('J') } = {}) {
  const ctx = await ownItem(sup, t, price);
  const po = await placePo(ctx, qty, { notes: `Uji journey ${t}` });
  return { t, ctx, po };
}

// ── the books ────────────────────────────────────────────────────────────────

/** Every movement on a supplier's payable account, oldest first. */
export async function supplierLedger(code: string): Promise<{ closing: number; rows: Json[] }> {
  const l = await cloud().get(`/api/v1/finance/payment-ledger/SUPPLIER/${encodeURIComponent(code)}/movements?from=2026-01-01&to=2099-12-31`);
  return { closing: l.closing_minor as number, rows: l.rows as Json[] };
}

/** What the supplier is owed, as the Accounts Payable ageing counts it (deliveries not yet billed included). */
export async function ageingTotal(code: string): Promise<number> {
  const a = await cloud().get(`/api/v1/finance/payables-aging?as_of=${F.today()}`);
  return ((a.suppliers as Json[]).find((s) => s.supplier_id === code)?.buckets.total_minor as number | undefined) ?? 0;
}

/** The payable movements one document made (a goods receipt, a bill, a payment, a credit note), by its source id. */
export async function movementsOf(code: string, sourceId: string): Promise<Json[]> {
  return (await supplierLedger(code)).rows.filter((r) => r.source_id === sourceId);
}

/** Wait for a delivery to show on Finance › Unbilled deliveries (the cloud lists it once the DC's receipt has synced). */
export async function waitUnbilled(receiptId: string): Promise<Json> {
  return waitFor(`delivery ${receiptId} on Unbilled deliveries`, async () => {
    await nudge('dc', 'cloud');
    return (await F.unbilledAll()).rows.find((u) => u.receipt_id === receiptId);
  }, 240_000, 4_000);
}

/**
 * The delivery is "owed to its supplier" when the DC's receipt is applied at head office (one step after it is
 * listed as unbilled when the Gudang runs in the cloud): wait for the payable to carry `want` more than `base`.
 */
export async function waitOwed(code: string, base: number, want: number): Promise<void> {
  await waitFor(`${code}'s payable to carry ${want} more`, async () => {
    await nudge('dc', 'cloud');
    return (await ageingTotal(code)) === base + want ? true : null;
  }, 120_000, 3_000);
}

// ── stock of our own, set up and tagged ──────────────────────────────────────

export interface OwnStock {
  t: string;
  sup: OwnSupplier;
  ctx: ItemCtx;
  poNumber: string;
  article: string;
  articleId: string;
  /** 4 SKUs (2 colours × 2 sizes), each holding qty/4 free pieces at the DC. */
  skus: Sku[];
  perSku: number;
}

/**
 * Merchandising and the DC take an accepted delivery from "Unidentified" to stock on the shelf: the article is
 * set up and issued, the tagging job's labels are printed and confirmed. Resolves when the article's SKUs are
 * free in dc.warehouse at head office. Same route as outbound.ts `buildStock`.
 */
export async function setUpAndTag(ctx: ItemCtx, poNumber: string, qty: number, t: string, basePrice = 99_000) {
  const c = cloud();
  const nina = as('dc', 'nina');
  const waiting = await waitFor(`${poNumber} unidentified in Cloud`, async () => {
    await nudge('dc', 'cloud');
    return rows(await c.get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === poNumber);
  }, 240_000);
  const item = ctx.item;
  const colours = (item.colours ?? []).map((x: Json) => x.colour_code);
  const useColours: string[] = (colours.length ? colours : ['BLACK', 'WHITE']).slice(0, 2);
  const sizes: string[] = (item.size_codes ?? ['03', '04']).slice(0, 2);
  const grid = useColours.flatMap((_, d) => sizes.map((s) => ({ d: d + 1, s })));
  const each = Math.floor(waiting.quantity / grid.length);
  const extra = waiting.quantity - each * grid.length;
  const variants = grid
    .map((g, i) => ({ colour_digit: String(g.d), size_code: g.s, quantity: each + (i < extra ? 1 : 0), base_price_minor: basePrice }))
    .filter((v) => v.quantity > 0);
  const session = await c.post('/api/v1/article-setups', {
    receipt_line_id: waiting.receipt_line_id,
    article_code: null,
    article_name: waiting.article_name,
    division_code: waiting.division_code,
    tags: waiting.tags ?? [],
    image_url: item.image_url ?? null,
    currency: 'IDR',
    colours: useColours.map((x, i) => ({ colour_digit: String(i + 1), colour_code: x })),
    variants,
    created_by: 'rina',
  });
  await c.post(`/api/v1/article-setups/${session.session_id}/issue`, { issued_by: 'rina' });

  const job = await waitFor(`tagging job for ${t}`, async () => {
    await nudge('cloud', 'dc');
    return rows(await nina.get('/api/v1/dc/tagging-jobs')).find((j) => JSON.stringify(j).includes(t) && !['DONE', 'COMPLETED', 'PRINTED'].includes(j.status));
  }, 240_000);
  const printing = await nina.post('/api/v1/dc/print-sessions', {
    job_id: job.job_id, printer_host: '127.0.0.1', printer_port: PRINTER_PORT, label_width_mm: 58, label_height_mm: 40, chunk_size: 10, actor_id: 'nina',
  });
  for (let i = 0; i < Math.ceil(qty / 10) + 1; i++) {
    const run = await nina.post(`/api/v1/dc/print-sessions/${printing.session_id}/run`, { actor_id: 'nina' });
    if (!run.printed) break;
  }
  await nina.post('/api/v1/dc/tagging-confirmations', { job_id: job.job_id, actor_id: 'nina', idempotency_key: uid() });

  const article = `Kaos Uji ${t}`;
  const mine = await waitFor(`${t} SKUs free at head office`, async () => {
    await nudge('dc', 'cloud');
    const m = (await availability()).filter((r) => r.article_name === article);
    return m.length === 4 && m.every((r) => r.on_hand_qty >= qty / 4) ? m : null;
  }, 240_000);
  return {
    article,
    articleId: mine[0].article_id as string,
    skus: mine
      .map((r: Json) => ({ sku_code: r.sku_code, sku_id: r.sku_id, colour: r.colour, size: r.size, article_name: r.article_name }))
      .sort((a: Sku, b: Sku) => a.sku_code.localeCompare(b.sku_code)) as Sku[],
  };
}

/** A PO for a fresh article of our supplier, delivered, accepted, set up and tagged: `qty` pieces (qty/4 per SKU) free in dc.warehouse. */
export async function ownStock(sup: OwnSupplier, qty = 16, o: { t?: string; basePrice?: number } = {}): Promise<OwnStock> {
  const t = o.t ?? tag('JS');
  const ctx = await ownItem(sup, t);
  const poNumber = await placePo(ctx, qty, { notes: `Uji journey ${t}` });
  await deliver(ctx, poNumber, qty, { review: 'Accept' });
  const set = await setUpAndTag(ctx, poNumber, qty, t, o.basePrice ?? 99_000);
  return { t, sup, ctx, poNumber, perSku: qty / 4, ...set };
}

// ── hub screens ──────────────────────────────────────────────────────────────

/** "Rp 1.234.567" → 1234567 for the first figure in `text`. */
export const rupiahIn = (text: string | null | undefined): number | null => {
  const m = (text ?? '').replace(/ | /g, ' ').match(/Rp\s*([\d.]+)/);
  return m ? Number(m[1]!.replace(/\./g, '')) : null;
};

// ── the till, inside the hub's browser ───────────────────────────────────────

/** Where the web till listens (a Vite server of its own on the VM; cookies are per host, not port, so the hub is signed in again after a visit). */
export const TILL_URL = `http://127.0.0.1:${PORTS.till}`;

/** An `app` that opens the till's pages, so `pos.openCounter` and friends run unchanged inside a hub test. */
export function tillOf(app: App, screen: Screen, browser: any): pos.Till { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tillApp = new Proxy(app, {
    get(target, prop) {
      if (prop === 'open') return (path = '/') => target.open(/^https?:/.test(path) ? path : TILL_URL + path);
      const v = (target as any)[prop]; // eslint-disable-line @typescript-eslint/no-explicit-any
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { app: tillApp, screen, browser };
}

/**
 * The counter, whether or not this browser tab is already signed in to the till (the till keeps its token in
 * the tab: a second visit in one journey opens straight on the counter, so `pos.openCounter` finds no form).
 */
export async function openCounter(t: pos.Till, { float = 500_000 } = {}) {
  await pos.countUncounted();
  await pos.ensureShift(float);
  await t.app.open('/');
  const field = pos.scanField(t.screen);
  try {
    await expect(field).toBeVisible({ timeout: 6_000 });
    return;
  } catch {
    /* the sign-in form is up */
  }
  await pos.signInTill(t);
  await expect(field).toBeVisible({ timeout: 30_000 });
}

/**
 * A completed sale at the web till: scan, (coupon), (member), pay the whole basket in cash, finish.
 * Never a bag charge. Returns the sale id the "Transaksi selesai" card prints and the amount that was due.
 */
export async function tillSale(
  t: pos.Till,
  epcs: string[],
  o: { coupon?: string; member?: string; promo?: { name: string; benefit: number } } = {},
  late?: ReturnType<typeof lateChecks>,
): Promise<{ saleId: string; due: number; quote: Json }> {
  const { screen } = t;
  await openCounter(t);
  await pos.scanUnits(t, ...epcs);
  // The garments of a new article: the till names and prices them from the catalogue it read at sign-in.
  await late?.late('the till names and prices the garment of a new article (it shows TANPA HARGA / "Tidak ada di buku harga")', async () => {
    await expect(screen.getByText('TANPA HARGA', { exact: true })).toBeHidden({ timeout: 4_000 });
  });
  if (o.member) {
    await screen.getByLabel('Nomor member').fill(o.member);
    const asked = await pos.quote(epcs, { member: o.member });
    if (asked.points_earned > 0) await expect(screen.getByText(`+${asked.points_earned}`, { exact: true })).toBeVisible({ timeout: 15_000 });
  }
  if (o.coupon) {
    await screen.getByLabel('Kode kupon').fill(o.coupon);
    await screen.getByRole('button', 'Pakai').tap();
    await expect(screen.getByRole('button', `Lepas kupon ${o.coupon}`)).toBeVisible({ timeout: 15_000 });
    if (o.promo) {
      await expect(screen.getByText(o.promo.name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(screen.getByText(`−${pos.rp(o.promo.benefit)}`, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }
  }
  const quote = await pos.quote(epcs, { coupons: o.coupon ? [o.coupon] : [], member: o.member ?? null });
  const due = pos.dueOf(quote);
  expect(await pos.payTotal(t, due), 'the till total equals the node quote').toBe(due);
  await pos.goToPayment(t);
  await screen.getByRole('button', /^Bayar Rp/).tap();
  await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
  const saleId = await pos.finishSale(t);
  return { saleId, due, quote };
}

/** Floor units of one SKU on store-01 right now. */
export async function floorOf(sku: string): Promise<string[]> {
  const at = await pos.places();
  return Object.entries(at)
    .filter(([e, place]) => place === pos.FLOOR && e.slice(2, 13) === sku)
    .map(([e]) => e)
    .sort();
}

export const todayJakarta = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

export { randomUUID };

// ── own pieces on store-01's shop floor ──────────────────────────────────────

/** A garment goes from the shop's stockroom to the shop floor (what Move stock does in the store app). */
export async function moveToFloor(epc: string): Promise<void> {
  await as('store', 'maya').post('/api/v1/store/movements', {
    epc, quantity: 1, from: 'store-01.warehouse:on_hand', to: pos.FLOOR, cause: 'NORMAL_MOVE', reason: 'Uji journey: ke lantai toko', actor_id: 'maya', idempotency_key: uid(),
  });
  await pos.waitOnFloor(epc);
}

export interface Shelf {
  stock: OwnStock;
  sent: Json;
  /** The units now standing on store-01's floor. */
  epcs: string[];
}

/**
 * Pieces of our own on store-01's floor, so a journey that sells never spends the shop's scarce stock:
 * 4 pieces set up and tagged (one per SKU), allotted to store-01, picked, packed, dispatched, counted in
 * blind, and `onFloor` of them moved from the stockroom to the floor. Takes about 40 seconds.
 */
export async function ownFloorUnits(sup: OwnSupplier, { onFloor = 1, basePrice = 99_000 } = {}): Promise<Shelf> {
  const stock = await ownStock(sup, 4, { basePrice });
  const cells = stock.skus.map((sku) => ({ sku, store: 'store-01', qty: 1 }));
  const sent = await toInTransit(cells, `Uji journey ${stock.t}`);
  const inbound = await inboundFor(shipmentOf(sent.trip, 'store-01').shipment_number);
  await storeReceive(inbound.delivery_id, cells.map((c) => ({ sku_code: c.sku.sku_code, quantity: 1 })));
  const at = await pos.places();
  const inRoom = Object.entries(at)
    .filter(([e, place]) => place === 'store-01.warehouse:on_hand' && stock.skus.some((k) => k.sku_code === e.slice(2, 13)))
    .map(([e]) => e)
    .sort();
  expect(inRoom, 'the four counted pieces stand in the stockroom').toHaveLength(4);
  const epcs = inRoom.slice(0, onFloor);
  for (const epc of epcs) await moveToFloor(epc);
  return { stock, sent, epcs };
}

// ── screen checks that must not gate a chain ─────────────────────────────────

/**
 * A journey's screens are checked after the hand-off they show has been proven through the API. A miss is
 * kept (not thrown) so the chain runs to its end; the journey's last test asserts the list is empty.
 */
export function lateChecks() {
  const misses: string[] = [];
  return {
    misses,
    async late(what: string, check: () => Promise<void>) {
      try {
        await check();
      } catch (e) {
        misses.push(`${what}: ${String((e as Error).message).split('\n')[0]}`);
      }
    },
  };
}

/** A tap; when something sits over the control (a toast, a sticky header) the keyboard does the same. */
export async function tapSoft(locator: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await locator.tap({ timeout: 8_000 });
  } catch {
    await locator.focus();
    await locator.press('Enter');
  }
}
