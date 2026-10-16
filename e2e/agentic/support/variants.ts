// PO colour & size (variants) — arrange steps through the routes the apps use, and the UI drivers shared by
// hub/variants/*. Owner's decisions of 10 Oct 2026 (memory project_po_variants_2026_10): one purchase price per line,
// quantity per variant, optional photos per variant (≤12), the bay counts PER VARIANT blind (0963), the buyer reviews
// the count variant by variant, New Articles prefills from the COUNTED figures, Allotment shows 32px thumbnails.
import { expect } from 'e2e';
import { as, countLine, dcLine, nudge, openReceipt, poDetail, rows, tag, uid, verifyCount, waitFor, type ItemCtx } from './rig.ts';
import { makeItemFast } from './po.ts';
import { PRINTER_PORT, SOURCE_POOL, availability, type Sku } from './outbound.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
type Screen = any;
type App = any;

/** The catalogue item of `makeItemFast` offers BLACK/WHITE × 03 (M) / 04 (L). The hub says them "Black", "White", "M", "L". */
export const CODE_LABEL: Record<string, string> = { BLACK: 'Black', WHITE: 'White', '03': 'M', '04': 'L' };
export const labelOf = (v: Spec) => `${CODE_LABEL[v.colour] ?? v.colour} ${CODE_LABEL[v.size] ?? v.size}`;

export interface Spec {
  colour: string;
  size: string;
  /** ordered pieces */
  qty: number;
  /** photograph links already "stored" (the rig has no bucket, so these are plain https links the server only checks for shape) */
  photos?: string[];
}

/** Black M 4 · Black L 3 · White M 2 · White L 3 = 12 pieces. Unequal on purpose: a swapped variant shows. */
export const SPEC: Spec[] = [
  { colour: 'BLACK', size: '03', qty: 4 },
  { colour: 'BLACK', size: '04', qty: 3 },
  { colour: 'WHITE', size: '03', qty: 2 },
  { colour: 'WHITE', size: '04', qty: 3 },
];
export const total = (xs: { qty: number }[]) => xs.reduce((s, x) => s + x.qty, 0);

export const photoUrl = (t: string, n = 1) => `https://photos.rig.test/${t}/${n}.jpg`;
export const key = (colour: string, size: string) => `${colour}|${size}`;

const promisedDate = () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

/** The line body the New PO form sends (composer.tsx lineExtras + variantsForWire): a purchase price only, no base price. */
function lineBody(ctx: ItemCtx, specs: Spec[] | null, quantity: number) {
  return {
    supplier_item_id: ctx.item.supplier_item_id,
    quantity,
    promised_date: promisedDate(),
    unit_price_minor: null,
    article_name: null,
    image_url: null,
    division_code: null,
    tags: null,
    base_price_minor: null,
    markup_bps: null,
    ...(specs
      ? { variants: specs.map((v) => ({ colour_code: v.colour, size_code: v.size, quantity: v.qty, base_price_minor: null, image_urls: v.photos ?? [] })) }
      : {}),
  };
}

export async function postPo(ctx: ItemCtx, lines: Json[], notes: string, ok = true): Promise<Json> {
  return as('cloud', 'rina').call(
    'POST',
    '/api/v1/purchase-orders/catalog',
    { po_number: null, supplier_id: ctx.supplier.supplier_id, destination_site_id: null, notes, discount_minor: null, payment_terms_code: null, lines },
    { ok },
  );
}

/** A fresh supplier item (2 colours × 2 sizes, Rp 40.000) and a PO of it split into `specs`. */
export async function variantPo(specs: Spec[] = SPEC, opts: { notes?: string } = {}) {
  const t = tag('VP');
  const ctx = await makeItemFast(t);
  const receipt = await postPo(ctx, [lineBody(ctx, specs, total(specs))], opts.notes ?? `Uji varian ${t}`);
  return { t, ctx, po: receipt.po_number as string, article: `Kaos Uji ${t}`, specs };
}

/** The same item, ordered as a whole (no variants) — the regression line. */
export async function plainPo(qty = 8) {
  const t = tag('PL');
  const ctx = await makeItemFast(t);
  const receipt = await postPo(ctx, [lineBody(ctx, null, qty)], `Uji tanpa varian ${t}`);
  return { t, ctx, po: receipt.po_number as string, article: `Kaos Uji ${t}` };
}

/** A two-line PO: line 1 split into variants, line 2 an item ordered as a whole. */
export async function mixedPo(specs: Spec[] = SPEC, plainQty = 6) {
  const t = tag('MX');
  const a = await makeItemFast(`${t}A`);
  const b = await makeItemFast(`${t}B`);
  const receipt = await postPo(a, [lineBody(a, specs, total(specs)), lineBody(b, null, plainQty)], `Uji campur ${t}`);
  return { t, a, b, po: receipt.po_number as string, articleA: `Kaos Uji ${t}A`, articleB: `Kaos Uji ${t}B`, specs, plainQty };
}

/** The PO's lines at head office, in line order. */
export async function lines(po: string): Promise<Json[]> {
  return ((await poDetail(po)).lines ?? []) as Json[];
}

/** The DC's work line for one PO line, once it has synced there (a no-op wait on the cloud-hosted warehouse). */
export const workLine = (po: string) => dcLine(po);

/** `counted` = pieces per variant, keyed `COLOUR|size`; a missing key is 0 (it did not come). `wrong` = Not as Ordered pieces. */
export function breakdown(specs: Spec[], counted: Record<string, number>) {
  return specs.map((v) => ({ colour_code: v.colour, size_code: v.size, counted_quantity: counted[key(v.colour, v.size)] ?? 0 }));
}

/**
 * The bay's whole count sheet by the route Receiving uses (POST /api/v1/dc/purchase-counts/batch). One entry per
 * (po line, per-variant figures | whole figure). Returns the batch answer: items[].count_id.
 */
export async function countSheet(
  ctx: ItemCtx,
  entries: { po_line_id: string; variants?: ReturnType<typeof breakdown>; whole?: number; wrong?: number }[],
  ok = true,
): Promise<Json> {
  const receipt = await openReceipt(ctx);
  return as('dc', 'nina').call(
    'POST',
    '/api/v1/dc/purchase-counts/batch',
    {
      receipt_id: receipt.receipt_id,
      counts: entries.map((e) => {
        const right = e.variants ? e.variants.reduce((s, v) => s + v.counted_quantity, 0) : (e.whole ?? 0);
        return {
          po_line_id: e.po_line_id,
          counted_quantity: right + (e.wrong ?? 0),
          wrong_quantity: e.wrong ?? 0,
          variants: e.variants ?? [],
        };
      }),
      actor_id: 'nina',
      idempotency_key: uid(),
    },
    { ok },
  );
}

/** Count the variant PO's one line per variant. */
export async function countVariants(p: { ctx: ItemCtx; po: string; specs: Spec[] }, counted: Record<string, number>, wrong = 0) {
  const line = await workLine(p.po);
  const sheet = await countSheet(p.ctx, [{ po_line_id: line.po_line_id, variants: breakdown(p.specs, counted), wrong }]);
  return { line, sheet, count: sheet.items[0] as Json };
}

/** The counts waiting for the buyer's decision on a PO (the Review Count payload). */
export async function awaiting(po: string): Promise<Json[]> {
  return rows(await as('dc', 'rina').get('/api/v1/dc/purchase-counts')).filter((c) => c.po_number === po);
}

export async function waitAwaiting(po: string): Promise<Json[]> {
  return waitFor(`${po} count awaiting review`, async () => {
    await nudge('cloud', 'dc');
    const l = await awaiting(po);
    return l.length ? l : null;
  }, 90_000, 2_000);
}

/** The ordered/counted/outstanding figures of one awaiting count, keyed `COLOUR|size`. */
export function figures(count: Json): Record<string, { ordered: number; outstanding: number; counted: number }> {
  return Object.fromEntries(
    (count.variants ?? []).map((v: Json) => [key(v.colour_code, v.size_code), { ordered: v.ordered_quantity, outstanding: v.outstanding_quantity, counted: v.counted_quantity }]),
  );
}

export const accept = (countId: string, price = 40_000) => verifyCount(countId, 'Accept', price);

export { countLine };

// ── hub drivers ──────────────────────────────────────────────────────────────

/** Open the Add item sheet of a fresh composer (supplier, date, method chosen). */
export async function openAddItem(app: App, screen: Screen) {
  const { fillHeader, openComposer } = await import('./po.ts');
  await openComposer(app, screen);
  await fillHeader(screen);
  await screen.getByRole('button', 'New item').tap();
  await expect(screen.getByRole('combobox', 'Colors')).toBeVisible({ timeout: 15_000 });
}

/** Name, division and tag of a new item — without the quantity and price (they depend on whether variants are chosen). */
export async function nameItem(screen: Screen, name: string) {
  await screen.getByRole('textbox', { name: /^Name/ }).fill(name);
  await screen.getByRole('combobox', 'Division').fill('Pria');
  await screen.getByRole('option').first().tap();
  await screen.getByRole('combobox', 'Tags').fill('Kaos');
  await screen.getByRole('option', 'Kaos').tap();
  await screen.getByRole('combobox', 'Tags').press('Escape');
}

/** Pick colours (labels) in the Colors box. */
export async function pickColours(screen: Screen, labels: string[]) {
  const box = screen.getByRole('combobox', 'Colors');
  for (const l of labels) {
    await box.fill(l);
    await screen.getByRole('option', l).tap();
  }
  await box.press('Escape');
}

/** Pick sizes (labels) in the Sizes box. */
export async function pickSizes(screen: Screen, labels: string[]) {
  const box = screen.getByRole('combobox', 'Sizes');
  for (const l of labels) {
    await box.fill(l);
    await screen.getByRole('option', l).tap();
  }
  await box.press('Escape');
}

/** The quantity box of one variant row in the Add item table (`Quantity of BLACK 03`). */
export const variantBox = (screen: Screen, colour: string, size?: string) =>
  screen.getByLabel(`Quantity of ${[colour, size].filter(Boolean).join(' ')}`);

/** Submit the PO from the composer and return its number (the receipt popup vanishes after 3 s). */
export async function submitOrder(screen: Screen): Promise<string> {
  await screen.getByRole('button', 'Review order').tap();
  await expect(screen.getByText('Review this order')).toBeVisible();
  await screen.getByRole('button', 'Submit').tap();
  const popup = screen.getByText(/PO-\d{6}-\d{3} created/);
  await expect(popup).toBeVisible({ timeout: 30_000 });
  return /PO-\d{6}-\d{3}/.exec((await popup.textContent()) ?? '')![0];
}

/** Ops › Receiving: open the sheet of a PO. */
export { openCount, openReview } from './po.ts';

/** The counted box of one variant on the Receiving sheet. */
export const countBox = (screen: Screen, article: string, label: string) => screen.getByLabel(`Counted pieces of ${article} ${label}`);

// ── stock for the New Articles and Allotment tests ───────────────────────────

/** A delivered, accepted variant PO whose goods sit "Unidentified" and wait in New Articles. */
export async function deliveredVariantPo(specs: Spec[] = SPEC, counted?: Record<string, number>, opts: { whole?: boolean } = {}) {
  const p = await variantPo(specs);
  const line = await workLine(p.po);
  const orderedAll = Object.fromEntries(specs.map((v) => [key(v.colour, v.size), v.qty]));
  const figuresCounted = counted ?? orderedAll;
  let count: Json;
  if (opts.whole) {
    // counted as a whole, with no breakdown (an older count): New Articles then falls back to the ordered figures
    const receipt = await openReceipt(p.ctx);
    count = await countLine(receipt.receipt_id, line.po_line_id, total(specs));
  } else {
    count = (await countSheet(p.ctx, [{ po_line_id: line.po_line_id, variants: breakdown(specs, figuresCounted) }])).items[0];
  }
  // Exactly as ordered receives itself; anything else waits for the buyer.
  await nudge('dc', 'cloud');
  if (!opts.whole && Object.entries(figuresCounted).some(([k, n]) => n !== orderedAll[k])) await accept(count.count_id);
  const waiting = await waitFor(`${p.po} unidentified`, async () => {
    await nudge('dc', 'cloud');
    return rows(await as('cloud', 'rina').get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === p.po);
  }, 180_000, 3_000);
  return { ...p, line, count, waiting };
}

/** Variant stock free at head office, as support/outbound.ts buildStock makes it, but the article carries a photograph link. */
export async function variantStock(image = true) {
  const d = await deliveredVariantPo();
  const cloud = as('cloud', 'rina');
  const nina = as('dc', 'nina');
  const useColours = ['BLACK', 'WHITE'];
  const url = image ? photoUrl(d.t, 0) : null;
  const session = await cloud.post('/api/v1/article-setups', {
    receipt_line_id: d.waiting.receipt_line_id,
    article_code: null,
    article_name: d.waiting.article_name,
    division_code: d.waiting.division_code,
    tags: d.waiting.tags ?? [],
    image_url: url,
    currency: 'IDR',
    colours: useColours.map((c, i) => ({ colour_digit: String(i + 1), colour_code: c })),
    variants: SPEC.map((v) => ({ colour_digit: v.colour === 'BLACK' ? '1' : '2', size_code: v.size, quantity: v.qty, base_price_minor: 99_000 })),
    created_by: 'rina',
  });
  await cloud.post(`/api/v1/article-setups/${session.session_id}/issue`, { issued_by: 'rina' });
  const job = await waitFor(`tagging job for ${d.t}`, async () => {
    await nudge('cloud', 'dc');
    return rows(await nina.get('/api/v1/dc/tagging-jobs')).find((j) => JSON.stringify(j).includes(d.t) && !['DONE', 'COMPLETED', 'PRINTED'].includes(j.status));
  }, 180_000);
  const printing = await nina.post('/api/v1/dc/print-sessions', {
    job_id: job.job_id, printer_host: '127.0.0.1', printer_port: PRINTER_PORT, label_width_mm: 58, label_height_mm: 40, chunk_size: 10, actor_id: 'nina',
  });
  for (let i = 0; i < Math.ceil(total(SPEC) / 10) + 1; i++) {
    const run = await nina.post(`/api/v1/dc/print-sessions/${printing.session_id}/run`, { actor_id: 'nina' });
    if (!run.printed) break;
  }
  await nina.post('/api/v1/dc/tagging-confirmations', { job_id: job.job_id, actor_id: 'nina', idempotency_key: uid() });
  const skus = await waitFor(`${d.t} SKUs free at head office`, async () => {
    await nudge('dc', 'cloud');
    const mine = (await availability()).filter((r) => r.article_name === d.article);
    return mine.length === 4 && mine.every((r) => r.on_hand_qty >= 2) ? mine : null;
  }, 180_000);
  return {
    ...d,
    image: url,
    skus: skus.map((r: Json) => ({ sku_code: r.sku_code, sku_id: r.sku_id, colour: r.colour, size: r.size, article_name: r.article_name, article_id: r.article_id, article_code: r.article_code })) as (Sku & { article_id: string; article_code: string })[],
    pool: SOURCE_POOL,
  };
}
