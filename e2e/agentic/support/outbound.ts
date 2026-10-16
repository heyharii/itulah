// Outbound & Allotment helpers (domain-local; shared API helpers live in rig.ts).
// Arrange: own DC stock (PO → delivery → article setup → tags printed), then the
// whole outbound chain through the routes the apps use — allot → pick → pack →
// dispatch → store receives blind — so a test drives one branch in the UI and
// proves the numbers here again.
import { randomUUID } from 'node:crypto';
import { as, deliver, nudge, placePo, rows, tag, uid, waitFor, type ItemCtx, supplier0001 } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PRINTER_PORT = Number(process.env.RIG_LABEL_PORT ?? 9109);
export const SOURCE_POOL = 'dc.warehouse';
export const DC_SITE = 'dc';
/** The only store with a node on the rig (maya's); the other 15 exist in the cloud only. */
export const STORE_NODE = 'store-01';
/** Stores 01..13 have DC outbound pools on the rig; the three c01x stores do not. */
export const STORES = Array.from({ length: 13 }, (_, i) => `store-${String(i + 1).padStart(2, '0')}`);
export const STORE_NAME: Record<string, string> = {
  'store-01': 'Cikupa', 'store-02': 'Muaro Bungo', 'store-03': 'Purbalingga', 'store-04': 'Bumiayu', 'store-05': 'Jambi',
  'store-06': 'Wiramode', 'store-07': 'Brebes', 'store-08': 'Pasuruan', 'store-09': 'WMJB', 'store-10': 'WMBA',
  'store-11': 'Sipin', 'store-12': 'Banjaran', 'store-13': 'Wonosobo', 'store-c014': 'Tasikmalaya', 'store-c015': 'Garut', 'store-c016': 'Cirebon',
};

/** Branches that need the cloud-hosted Gudang (amend, move back, short picks, work-off cards). */
export const CLOUD_DC = process.env.RIG_DC_HOSTING === 'cloud';

export interface Sku {
  sku_code: string;
  sku_id: string;
  colour: string;
  size: string;
  article_name: string;
}

export interface Stock {
  t: string;
  ctx: ItemCtx;
  poNumber: string;
  article: string;
  /** The 4 SKUs (2 colours × 2 sizes), each holding qty/4 free pieces at the DC. */
  skus: Sku[];
  perSku: number;
}

const memo = new Map<string, Promise<Stock>>();

/**
 * Stock of our own: a PO for a fresh article, delivered and accepted, set up by
 * merchandising, labels printed and tagging confirmed — `qty` pieces, qty/4 per
 * SKU, free in dc.warehouse. Memoised per `key` so a file's tests share it.
 */
export function ownStock(key: string, qty = 80): Promise<Stock> {
  let got = memo.get(key);
  if (!got) {
    got = buildStock(qty).catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, got);
  }
  return got;
}

/**
 * rig.ts `makeItem` lists the supplier's items with limit=200 and finds nothing once the rig holds
 * more than 200 (235 at 16:30 on 9 Oct); this one uses the create route's own answer.
 */
export async function makeOwnItem(t: string, price = 40_000): Promise<ItemCtx> {
  const cloud = as('cloud', 'rina');
  const supplier = await supplier0001();
  if (!supplier) throw new Error('supplier 0001 missing — run e2e/agentic/provision.sh');
  const code = `${t}-KAO`;
  // The create route answers with the item itself; the supplier's item list is capped and has outgrown 200.
  const item = await cloud.post(`/api/v1/suppliers/${supplier.supplier_id}/items`, {
    supplier_item_code: code, name: `Kaos Uji ${t}`, unit_price_minor: price, currency: 'IDR', status: 'ACTIVE', division_code: 'PRIA',
    tags: ['KAOS'], colour_codes: ['BLACK', 'WHITE'], size_codes: ['03', '04'],
  });
  return { supplier, item };
}

/** A stock nobody else shares (no memo): for tests that read or spread the article's whole stock. */
export const freshStock = (qty = 8): Promise<Stock> => buildStock(qty);

async function buildStock(qty: number): Promise<Stock> {
  const t = tag('OB');
  const ctx = await makeOwnItem(t);
  const poNumber = await placePo(ctx, qty, { notes: `Uji outbound ${t}` });
  await deliver(ctx, poNumber, qty, { review: 'Accept' });
  const cloud = as('cloud', 'rina');
  const nina = as('dc', 'nina');

  const waiting = await waitFor(`${poNumber} unidentified in Cloud`, async () => {
    await nudge('dc', 'cloud');
    return rows(await cloud.get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === poNumber);
  }, 180_000);
  const item = ctx.item;
  const colours = (item.colours ?? []).map((c: Json) => c.colour_code);
  const useColours: string[] = (colours.length ? colours : ['BLACK', 'WHITE']).slice(0, 2);
  const sizes: string[] = (item.size_codes ?? ['03', '04']).slice(0, 2);
  const grid = useColours.flatMap((_, d) => sizes.map((s) => ({ d: d + 1, s })));
  const each = Math.floor(waiting.quantity / grid.length);
  const extra = waiting.quantity - each * grid.length;
  const variants = grid
    .map((g, i) => ({ colour_digit: String(g.d), size_code: g.s, quantity: each + (i < extra ? 1 : 0), base_price_minor: 99_000 }))
    .filter((v) => v.quantity > 0);
  const session = await cloud.post('/api/v1/article-setups', {
    receipt_line_id: waiting.receipt_line_id,
    article_code: null,
    article_name: waiting.article_name,
    division_code: waiting.division_code,
    tags: waiting.tags ?? [],
    image_url: item.image_url ?? null,
    currency: 'IDR',
    colours: useColours.map((c, i) => ({ colour_digit: String(i + 1), colour_code: c })),
    variants,
    created_by: 'rina',
  });
  await cloud.post(`/api/v1/article-setups/${session.session_id}/issue`, { issued_by: 'rina' });

  const job = await waitFor(`tagging job for ${t}`, async () => {
    await nudge('cloud', 'dc');
    return rows(await nina.get('/api/v1/dc/tagging-jobs')).find((j) => JSON.stringify(j).includes(t) && !['DONE', 'COMPLETED', 'PRINTED'].includes(j.status));
  }, 180_000);
  const printing = await nina.post('/api/v1/dc/print-sessions', {
    job_id: job.job_id, printer_host: '127.0.0.1', printer_port: PRINTER_PORT, label_width_mm: 58, label_height_mm: 40, chunk_size: 10, actor_id: 'nina',
  });
  // The printer takes a chunk of 10 at a time.
  for (let i = 0; i < Math.ceil(qty / 10) + 1; i++) {
    const run = await nina.post(`/api/v1/dc/print-sessions/${printing.session_id}/run`, { actor_id: 'nina' });
    if (!run.printed) break;
  }
  await nina.post('/api/v1/dc/tagging-confirmations', { job_id: job.job_id, actor_id: 'nina', idempotency_key: uid() });

  const skus = await waitFor(`${t} SKUs free at head office`, async () => {
    await nudge('dc', 'cloud');
    const mine = (await availability()).filter((r) => r.article_name === `Kaos Uji ${t}`);
    return mine.length === 4 && mine.every((r) => r.on_hand_qty >= qty / 4) ? mine : null;
  }, 180_000);
  return {
    t,
    ctx,
    poNumber,
    article: `Kaos Uji ${t}`,
    perSku: qty / 4,
    skus: skus
      .map((r: Json) => ({ sku_code: r.sku_code, sku_id: r.sku_id, colour: r.colour, size: r.size, article_name: r.article_name }))
      .sort((a: Sku, b: Sku) => a.sku_code.localeCompare(b.sku_code)),
  };
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function availability(): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get('/api/v1/inventory/availability?limit=3000'));
}

/** Free pieces at head office for one SKU. */
export async function freeOf(sku: Sku): Promise<number> {
  return (await availability()).find((r) => r.sku_code === sku.sku_code)?.on_hand_qty ?? 0;
}

export async function allotmentDetail(id: string): Promise<Json> {
  return as('cloud', 'rina').get(`/api/v1/inventory/allotments/${id}`);
}

export async function allotmentList(q = ''): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get(`/api/v1/inventory/allotments?limit=500${q}`));
}

/** The allotment (any status) with this number. */
export async function allotmentByNumber(number: string): Promise<Json | undefined> {
  const active = (await allotmentList()).find((a) => a.allotment_number === number);
  if (active) return active;
  return rows(await as('cloud', 'rina').get('/api/v1/inventory/allotments?limit=500&status=FINISHED')).find((a) => a.allotment_number === number);
}

export interface Cell {
  sku: Sku;
  store: string;
  qty: number;
}

// ── arrange: the chain, step by step ─────────────────────────────────────────

/** MD raises one allotment of the given cells (the route the grid's Submit uses). */
export async function allot(cells: Cell[], notes = 'Uji e2e outbound'): Promise<Json> {
  return as('cloud', 'rina').post('/api/v1/inventory/allotments', {
    type: 'TO_STORE',
    notes,
    actor_id: 'rina',
    idempotency_key: uid(),
    lines: cells.map((c) => ({
      source_site_id: DC_SITE,
      source_pool_id: SOURCE_POOL,
      destination_type: 'STORE',
      destination_id: c.store,
      sku_id: c.sku.sku_id,
      quantity: c.qty,
    })),
  });
}

/** The allotment is at the DC when its picklists (one per shop) are on the to-pick list. */
export async function waitToPick(number: string, shops: number | null = null): Promise<Json[]> {
  return waitFor(`${number} on the DC to-pick list`, async () => {
    await nudge('cloud', 'dc');
    const mine = rows(await as('dc', 'nina').get('/api/v1/dc/picklist/allotments')).filter((p) => p.allotment_number === number);
    return mine.length > 0 && (shops === null || mine.length >= shops) ? mine : null;
  }, 180_000, 3_000);
}

export async function toPick(): Promise<Json[]> {
  return rows(await as('dc', 'nina').get('/api/v1/dc/picklist/allotments'));
}

/** Accept one picklist (allotment × shop) as the picker does; `found` lowers a SKU below what was asked. */
export async function pick(p: Json, found: Record<string, number> = {}): Promise<Json> {
  const lines = p.lines
    .map((l: Json) => ({ sku_code: l.sku_code, quantity: Math.min(found[l.sku_code] ?? l.outstanding, l.outstanding) }))
    .filter((l: Json) => l.quantity > 0);
  return as('dc', 'nina').post('/api/v1/dc/picklists', {
    source_pool_id: SOURCE_POOL,
    lines,
    actor_id: 'nina',
    note: null,
    idempotency_key: uid(),
    destination_id: p.destination_id,
    allotment_id: p.allotment_id,
  });
}

/** Pack and seal one carton for a shop from its picklist sessions. */
export async function pack(shop: string, lines: { sku_code: string; quantity: number }[], sessionIds: string[]): Promise<Json> {
  return as('dc', 'nina').post('/api/v1/dc/packs', {
    destination_store_id: shop,
    lines,
    actor_id: 'nina',
    idempotency_key: uid(),
    seal: true,
    pick_session_ids: sessionIds,
  });
}

export async function dispatchTrip(koliIds: string[], note = 'Uji e2e'): Promise<Json> {
  return as('dc', 'yusuf').post('/api/v1/dc/dispatch-trips', { koli_ids: koliIds, trip_note: note, actor_id: 'yusuf', idempotency_key: uid() });
}

/** Allot → pick everything → pack one carton per shop → return the cartons (not yet dispatched). */
export async function toPacked(cells: Cell[], notes = 'Uji e2e outbound') {
  const made = await allot(cells, notes);
  const shops = [...new Set(cells.map((c) => c.store))];
  const picks = await waitToPick(made.allotment_number, shops.length);
  const cartons: Json[] = [];
  for (const shop of shops) {
    const mine = picks.filter((p) => p.destination_id === shop);
    const sessions: string[] = [];
    for (const p of mine) sessions.push((await pick(p)).summary.session.session_id);
    const lines = cells.filter((c) => c.store === shop).map((c) => ({ sku_code: c.sku.sku_code, quantity: c.qty }));
    const manifest = await pack(shop, lines, sessions);
    cartons.push(manifest.koli);
  }
  return { made, cartons };
}

/** …and on the truck: one trip, in transit. */
export async function toInTransit(cells: Cell[], notes = 'Uji e2e outbound', note = `Trip ${tag('TR')}`) {
  const got = await toPacked(cells, notes);
  const trip = await dispatchTrip(got.cartons.map((k) => k.koli_id), note);
  return { ...got, trip, note };
}

// ── the store ────────────────────────────────────────────────────────────────

/** The surat jalan a trip made for one shop. */
export function shipmentOf(trip: Json, store: string): Json {
  return (trip.shipments ?? []).find((s: Json) => s.destination_store_id === store);
}

/** The delivery announced to store-01 for this surat jalan; waits for sync. */
export async function inboundFor(shipmentNumber: string, timeoutMs = 180_000): Promise<Json> {
  const maya = as('store', 'maya');
  return waitFor(`${shipmentNumber} announced to the store`, async () => {
    await nudge('dc', 'cloud', 'store');
    return rows(await maya.call('GET', '/api/v1/store/inbound', undefined, { ok: false })).find((d: Json) => d.shipment_reference === shipmentNumber);
  }, timeoutMs, 4_000);
}

export async function storeReceive(deliveryId: string, counts: { sku_code: string; quantity: number }[]): Promise<Json> {
  return as('store', 'maya').post(`/api/v1/store/inbound/${deliveryId}/receive-count`, { counts, actor_id: 'maya', idempotency_key: randomUUID() });
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Tidy-up: send a carton off on a trip of its own (so the Pack lane / Dispatch sheet are not left cluttered). */
export async function ship(koli: Json | null): Promise<void> {
  if (koli) await dispatchTrip([koli.koli_id], 'Uji sisa');
}

/** Tidy-up: send every sealed carton waiting for a shop (a store the test owns) on one trip. */
export async function shipReady(store: string): Promise<void> {
  const ready = rows(await as('dc', 'nina').get('/api/v1/dc/koli?ready=true')).filter((k) => k.destination_store_id === store && ['PACKED', 'SHIPMENT'].includes(k.position));
  if (ready.length) await dispatchTrip(ready.map((k) => k.koli_id), 'Uji sisa');
}

/**
 * Tidy-up for tests that stop half way: pack whatever is still waiting for a shop (all its picklists), so the next
 * run's Picked lane / Pack sheet is not cluttered with this run's leftovers. Returns the carton, or null.
 */
export async function packRemaining(store: string): Promise<Json | null> {
  const nina = as('dc', 'nina');
  const rounds = rows(await nina.get('/api/v1/dc/picklists')).filter((r) => r.destination_id === store && r.waiting > 0);
  if (rounds.length === 0) return null;
  const lines = new Map<string, number>();
  for (const r of rounds) {
    const detail = await nina.get(`/api/v1/dc/pick-sessions/${r.session.session_id}`);
    for (const l of detail.lines ?? []) if (l.waiting > 0) lines.set(l.sku_code, (lines.get(l.sku_code) ?? 0) + l.waiting);
  }
  if (lines.size === 0) return null;
  const manifest = await pack(store, [...lines].map(([sku_code, quantity]) => ({ sku_code, quantity })), rounds.map((r) => r.session.session_id));
  return manifest.koli;
}

// ── debugging aid ────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from 'node:fs';

/** Write the visible text + interactive elements (role/name) of the page to .e2e/out/outbound/dumps/<name>.txt. */
export async function dump(browser: { evaluate: (fn: any, arg?: any) => Promise<any> }, name: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text: string = await browser.evaluate(() => {
    const out: string[] = ['URL ' + location.href, '--- innerText ---', document.body.innerText.slice(0, 7000), '--- interactive ---'];
    document.querySelectorAll('button, a, [role], input, textarea, select, [aria-label]').forEach((el) => {
      const e = el as HTMLElement;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const role = e.getAttribute('role') || e.tagName.toLowerCase();
      const label = e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0, 70) || (e as HTMLInputElement).placeholder || '';
      out.push(`${role} | ${label.replace(/\n/g, ' / ')}${(e as HTMLButtonElement).disabled ? ' [disabled]' : ''}`);
    });
    return out.join('\n');
  });
  mkdirSync('.e2e/out/outbound/dumps', { recursive: true });
  writeFileSync(`.e2e/out/outbound/dumps/${name}.txt`, text);
}


// ── UI helpers (hub) ─────────────────────────────────────────────────────────
type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type App = any; // eslint-disable-line @typescript-eslint/no-explicit-any
import { expect } from 'e2e';

/** Merchandise › Allotments, settled. */
export async function openAllotments(app: App, screen: Screen) {
  await app.open('/allotment');
  await expect(screen.getByRole('heading', 'Allotments')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole('tab', /^Allotted/)).toBeVisible({ timeout: 30_000 });
}

/** One allotment's sheet, opened by its deep link. */
export async function openAllotmentSheet(app: App, screen: Screen, id: string, number: string) {
  await app.open(`/allotment?allotment=${id}`);
  const sheet = screen.getByRole('dialog', new RegExp(`^${number}`));
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  await expect(sheet.getByText('Lines')).toBeVisible({ timeout: 45_000 });
  return sheet;
}

/** The DC has taken the allotment (it can be cancelled from now on). */
export async function waitAccepted(id: string, timeoutMs = 120_000): Promise<Json> {
  return waitFor(`${id} accepted by the DC`, async () => {
    await nudge('cloud', 'dc');
    const d = await allotmentDetail(id);
    return d.edge_application_status === 'ACCEPTED' ? d : null;
  }, timeoutMs, 3_000);
}

/** Wait until the allotment's detail satisfies `ok` (sync takes seconds). */
export async function waitDetail(id: string, ok: (d: Json) => boolean, timeoutMs = 120_000): Promise<Json> {
  return waitFor(`allotment ${id} to settle`, async () => {
    await nudge('cloud', 'dc');
    const d = await allotmentDetail(id);
    return ok(d) ? d : null;
  }, timeoutMs, 3_000);
}

/** Grid cell for a SKU and store, e.g. cell(screen, '00000019103', 'C001 · Cikupa'). */
export const cell = (screen: Screen, sku: string, store: string) => screen.getByLabel(`${sku} to ${store}`);
export const storeLabel = (id: string) => {
  const n = Number(id.replace('store-c', '').replace('store-', ''));
  return `C${String(n).padStart(3, '0')} · ${STORE_NAME[id] ?? ''}`;
};
