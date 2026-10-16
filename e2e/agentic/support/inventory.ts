// Inventory domain helpers: stock of our own on the rig, the DC's side of an
// official count, and the readings every test proves its numbers with.
//
// Stock is made through the routes the apps use (ported from
// scripts/demo-populate.py `stage_goods`): PO → delivery counted → buyer accepts
// (pieces sit "Unidentified") → article set up and issued → tagging job printed
// to the label sink and confirmed (every piece gets an EPC and moves to
// dc.warehouse). Everything carries the run's `tag()`, so a count that names
// these EPCs can never touch stock another suite made.
import { randomUUID } from 'node:crypto';
import { signInByApi } from './session.ts';
import { as, deliver, dcLine, nudge, placePo, rows, tag, waitFor, type ItemCtx, supplier0001 } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const LABEL_SINK_PORT = Number(process.env.RIG_LABEL_PORT ?? 9109);
export const DC_WAREHOUSE = 'dc.warehouse';

/** The store units the Stock screen draws a card for: kind STORE and ACTIVE (more than the stores that are OPEN). */
export async function activeStoreUnits(): Promise<{ id: string; code: string; name: string }[]> {
  const units = rows(await as('cloud', 'rina').get('/api/v1/organisation/units'));
  return units.filter((u) => u.kind === 'STORE' && u.status === 'ACTIVE').map((u) => ({ id: u.id, code: u.code, name: u.name }));
}

/** A count as the hub writes it: dots group thousands ("1.799"). */
export const idn = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const DC_UNIDENTIFIED = 'dc.pending.unidentified';

// ── readings ─────────────────────────────────────────────────────────────────

/** The DC node's own pools (never the cloud's merged fleet read). */
export async function dcPools(): Promise<Json[]> {
  return rows(await as('dc', 'yusuf').get('/api/v1/inventory/pools'));
}

export async function dcPool(id: string): Promise<Json> {
  const pool = (await dcPools()).find((p) => p.id === id);
  if (!pool) throw new Error(`pool ${id} not on the DC node`);
  return pool;
}

/** The cloud's fleet read: every node's pools, shadowed rows marked. */
export async function fleet(): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get('/api/v1/inventory/fleet-pools'));
}

/** The pool row the fleet counts (Edge fact position over a shadowed cloud row). */
export async function fleetPool(id: string): Promise<Json | undefined> {
  return (await fleet()).find((p) => p.id === id && p.authority?.included_in_fleet_total);
}

/** One page of a pool's availability on the cloud, filtered by a search term. */
export async function availability(poolId: string, q: string): Promise<Json[]> {
  const page = await as('cloud', 'rina').get(`/api/v1/inventory/availability?source_pool_id=${encodeURIComponent(poolId)}&q=${encodeURIComponent(q)}&limit=200`);
  return rows(page);
}

/** The DC ledger's postings, filtered by a search term (an EPC, a SKU, a tag). */
export async function dcMovements(q: string, limit = 200): Promise<Json[]> {
  return rows(await as('dc', 'yusuf').get(`/api/v1/inventory/movements?q=${encodeURIComponent(q)}&limit=${limit}`));
}

/** The cloud ledger's postings (what Inventory › Movements reads). */
export async function cloudMovements(q: string, limit = 200): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get(`/api/v1/inventory/movements?q=${encodeURIComponent(q)}&limit=${limit}`));
}

/** The cloud's count book, filtered by a search term (pool id, reason, opener). */
export async function cloudCounts(q: string): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get(`/api/v1/inventory/counts?q=${encodeURIComponent(q)}&limit=200`));
}

export async function cloudCount(id: string): Promise<Json> {
  return as('cloud', 'rina').get(`/api/v1/inventory/counts/${id}`);
}

export async function missingRows(q: string): Promise<Json[]> {
  return rows(await as('cloud', 'rina').get(`/api/v1/inventory/missing?q=${encodeURIComponent(q)}&limit=200`));
}

// ── stock of our own ─────────────────────────────────────────────────────────

/**
 * rig.ts `makeItem` looks the new item up in the supplier's first 200 items; supplier 0001
 * now carries 300+ (every suite adds its own), so the lookup misses. Same item, found by
 * walking `next_cursor`.
 */
export async function makeOwnItem(t: string, { price = 40_000 } = {}): Promise<ItemCtx> {
  const cloud = as('cloud', 'rina');
  const supplier = await supplier0001();
  if (!supplier) throw new Error('supplier 0001 missing — run e2e/agentic/provision.sh');
  const code = `${t}-KAO`;
  const find = async () => {
    let cursor: string | null = null;
    do {
      const page: Json = await cloud.get(`/api/v1/suppliers/${supplier.supplier_id}/items?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const hit = rows(page).map((i) => i.item ?? i).find((i) => i.supplier_item_code === code);
      if (hit) return hit;
      cursor = page?.next_cursor ?? null;
    } while (cursor);
    return undefined;
  };
  await cloud.post(`/api/v1/suppliers/${supplier.supplier_id}/items`, {
    supplier_item_code: code,
    name: `Kaos Uji ${t}`,
    unit_price_minor: price,
    currency: 'IDR',
    status: 'ACTIVE',
    division_code: 'PRIA',
    tags: ['KAOS'],
    colour_codes: ['BLACK', 'WHITE'],
    size_codes: ['03', '04'],
  });
  const item = await waitFor(`item ${code}`, find, 60_000, 1_000);
  return { supplier, item };
}

export interface OwnStock {
  t: string;
  ctx: ItemCtx;
  poNumber: string;
  /** Pieces delivered and accepted. */
  qty: number;
  article: string;
}

/** A PO for a fresh tagged article, delivered and accepted: pieces sit "Unidentified" at the DC. */
export async function unidentifiedStock(qty = 8, t = tag('IV')): Promise<OwnStock> {
  const ctx = await makeOwnItem(t);
  const poNumber = await placePo(ctx, qty, { notes: `Uji inventory ${t}` });
  await deliver(ctx, poNumber, qty, { review: 'Accept' });
  return { t, ctx, poNumber, qty, article: `Kaos Uji ${t}` };
}

export interface Tagged extends OwnStock {
  /** The article's SKUs (a count scoped to these touches no other suite's pieces). */
  skus: { sku_id: string; sku_code: string; article_name: string }[];
}

/**
 * Stock from the PO on to the shelf: article set up and issued by merchandising,
 * labels printed, tagging confirmed. Resolves when the pieces are in dc.warehouse
 * with EPCs (read back from the DC's ledger).
 */
export async function taggedStock(qty = 8, t = tag('IV')): Promise<Tagged> {
  const own = await unidentifiedStock(qty, t);
  const cloud = as('cloud', 'rina');
  const nina = as('dc', 'nina');

  // The receipt line waits in Cloud as unidentified until merchandising says what it is.
  const waiting = await waitFor(`${own.poNumber} unidentified in Cloud`, async () => {
    await nudge('dc', 'cloud');
    return rows(await cloud.get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === own.poNumber);
  }, 180_000);

  const item = own.ctx.item;
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

  // The issued setup becomes a tagging job at the DC: print the labels, confirm they are on.
  const job = await waitFor(`tagging job for ${own.t}`, async () => {
    await nudge('cloud', 'dc');
    const jobs = rows(await nina.get('/api/v1/dc/tagging-jobs'));
    return jobs.find((j) => JSON.stringify(j).includes(own.t) && !['DONE', 'COMPLETED', 'PRINTED'].includes(j.status));
  }, 180_000);
  const printing = await nina.post('/api/v1/dc/print-sessions', {
    job_id: job.job_id,
    printer_host: '127.0.0.1',
    printer_port: LABEL_SINK_PORT,
    label_width_mm: 58,
    label_height_mm: 40,
    chunk_size: 10,
    actor_id: 'nina',
  });
  await nina.call('POST', `/api/v1/dc/print-sessions/${printing.session_id}/run`, { actor_id: 'nina' });
  await nina.post('/api/v1/dc/tagging-confirmations', { job_id: job.job_id, actor_id: 'nina', idempotency_key: randomUUID() });

  // The pieces are on the shelf when the cloud's availability (it reads the DC's fact positions) lists
  // the article's SKUs with every piece. Which pieces are ours is decided by SKU, never by a text search:
  // the DC's `q` on its movements is ignored, so a search returns other suites' pieces too.
  const skus = await waitFor(`${own.t} in the cloud's availability`, async () => {
    await nudge('dc', 'cloud');
    const lines = await availability(DC_WAREHOUSE, own.t);
    return lines.length > 0 && lines.reduce((sum, r) => sum + r.stock_qty, 0) === qty ? lines : null;
  }, 240_000, 3_000);
  return { ...own, skus: skus.map((r) => ({ sku_id: r.sku_id as string, sku_code: r.sku_code as string, article_name: r.article_name as string })) };
}

/** Head office closes whatever is left open on a cloud-owned site so each run starts from none. */
export async function closeOpenCounts(site: string) {
  const cloud = as('cloud', 'rina');
  for (const c of await cloudCounts(site)) {
    if (c.site_id !== site) continue;
    const body = () => ({ actor_id: 'rina', idempotency_key: randomUUID() });
    if (c.status === 'DRAFT') await cloud.post(`/api/v1/inventory/counts/${c.id}/activate`, body());
    if (c.status === 'DRAFT' || c.status === 'ACTIVE') await cloud.post(`/api/v1/inventory/counts/${c.id}/submit`, body());
    if (c.status !== 'CLOSED') await cloud.post(`/api/v1/inventory/counts/${c.id}/approve`, body());
  }
}

// ── official counts, the DC's side ───────────────────────────────────────────

/** Head office asks for a count (the route the hub's New count / Count store uses). */
export async function raiseCount(body: { site_id: string; pool_id: string; kind: 'FULL' | 'CYCLE' | 'TARGETED'; reason: string; epcs?: string[]; sku_ids?: string[] }, activate = true) {
  const cloud = as('cloud', 'rina');
  const made = await cloud.post('/api/v1/inventory/counts', { sku_ids: [], epcs: [], ...body, actor_id: 'rina', idempotency_key: randomUUID() });
  if (activate) await cloud.post(`/api/v1/inventory/counts/${made.id}/activate`, { actor_id: 'rina', idempotency_key: randomUUID() });
  return made as { id: string; status: string };
}

/** The count at the DC (it arrives through sync). */
export async function dcCountSheet(countId: string): Promise<Json> {
  const nina = as('dc', 'nina');
  return waitFor(`count ${countId} at the DC`, async () => {
    await nudge('cloud', 'dc');
    const hit = rows(await nina.get('/api/v1/dc/official-counts')).find((c) => c.count_id === countId);
    return hit ? nina.get(`/api/v1/dc/official-counts/${countId}`) : null;
  }, 120_000, 2_000);
}

/** The handheld's walk: these EPCs were found (the rest of the scope were not). */
export async function walkCount(countId: string, found: { epc: string; sku_code: string }[]) {
  return as('dc', 'nina').post(`/api/v1/dc/official-counts/${countId}/entries`, {
    entries: found.map((f) => ({ epc: f.epc, sku_code: f.sku_code, found_quantity: 1 })),
    actor_id: 'nina',
    idempotency_key: randomUUID(),
  });
}

/** The DC submits its walk; the cloud sees the count in REVIEW once it syncs. */
export async function submitAtDc(countId: string) {
  return as('dc', 'nina').post(`/api/v1/dc/official-counts/${countId}/submit`, { actor_id: 'nina', idempotency_key: randomUUID() });
}

/** Wait until the cloud shows the count in `status`. */
export async function waitCountStatus(countId: string, status: string, timeoutMs = 120_000) {
  return waitFor(`count ${countId} ${status}`, async () => {
    await nudge('dc', 'cloud');
    const c = await cloudCount(countId);
    return c.status === status ? c : null;
  }, timeoutMs, 2_000);
}

export const reason = (t: string, what: string) => `Uji ${what} ${t}`;
export { tag };

// ── a workaround for a broken module in the working tree ─────────────────────

/**
 * NOTE: the hub registers a service worker that serves its modules from its own cache, so this
 * route is often never hit; treat it as a best effort, not as something a test may rely on.
 *
 * The working tree (9 Oct 2026) removed `observationAnomalies` and
 * `inventoryKeys.anomalies` from lib/queries/inventory.ts while observations.tsx
 * and exceptions.tsx still import them, so every /inventory/* route dies with
 * "does not provide an export named 'observationAnomalies'". The `INV-00` test
 * asserts the module loads and stays red until that is fixed. Every other test
 * of the module calls this first so it can still check its own screen: it
 * serves the module with the two missing members appended, and does nothing
 * once the app has them again.
 */
export async function healInventoryModule(browser: { route: (pattern: string, handler: (route: any) => Promise<void>) => Promise<unknown> }) {
  let healed: string | undefined;
  await browser.route('**/src/lib/queries/inventory.ts*', async (route: any) => {
    if (healed === undefined) {
      // Vite answers a bare GET of a .ts path with index.html; the browser's own headers (Sec-Fetch-Dest: script) get the module.
      const res = await fetch(route.request.url, { headers: { ...route.request.headers, 'sec-fetch-dest': 'script', accept: '*/*' } });
      let body = await res.text();
      if (body.trimStart().startsWith('<!doctype')) return route.continue();
      if (!/export\s+(async\s+)?function\s+observationAnomalies|export\s*\{[^}]*\bobservationAnomalies\b/.test(body)) {
        body += '\nexport function observationAnomalies(signal) { return node.get("/api/v1/inventory/observation-anomalies", { signal }).then((b) => b.items); }\n';
      }
      body += '\nif (typeof inventoryKeys.anomalies !== "function") inventoryKeys.anomalies = () => ["inventory", "observation-anomalies"];\n';
      healed = body;
    }
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: healed });
  });
}

/** Sign in by API inside a test (a serial group cannot restore a saved session). */
export async function signedIn(
  app: { open: (path?: string) => Promise<unknown> },
  browser: Parameters<typeof signInByApi>[0],
  who: 'rina' | 'nina' | 'yusuf' | 'admin' = 'rina',
) {
  await app.open('/');
  await signInByApi(browser, who);
}
