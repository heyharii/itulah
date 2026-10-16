// Test data through the routes the apps use, straight to the rig's nodes with
// a bearer token (no browser). Ported from e2e/po-flow/run.py: build what a
// branch needs here, drive the branch itself in the UI, and prove the numbers
// here again. Every helper takes a run-unique `tag` so tests never collide.
import { randomUUID } from 'node:crypto';
import { PASSWORD, RIG, type Person } from './base.ts';

export type NodeName = 'cloud' | 'dc' | 'store';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const tokens = new Map<string, string>();

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Json, where: string) {
    super(`${where} → ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 600));
  }
}

/** A signed-in client for one person on one node. */
export class Api {
  constructor(readonly node: NodeName, readonly who: Person) {}

  get base(): string {
    return RIG[this.node];
  }

  private async token(): Promise<string> {
    const key = `${this.node}:${this.who}`;
    let token = tokens.get(key);
    if (!token) {
      const res = await fetch(`${this.base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.who, password: PASSWORD }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) throw new ApiError(res.status, body, `${key} sign-in`);
      token = body.token as string;
      tokens.set(key, token);
    }
    return token;
  }

  /** Any call; `ok: false` returns the body of a refusal instead of throwing. */
  async call(method: string, path: string, body?: Json, { ok = true } = {}): Promise<Json> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${await this.token()}`,
    };
    if (method !== 'GET') headers['idempotency-key'] = randomUUID();
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (ok && !res.ok) throw new ApiError(res.status, parsed, `${this.node}:${this.who} ${method} ${path}`);
    return parsed;
  }

  get(path: string) {
    return this.call('GET', path);
  }

  post(path: string, body: Json = {}) {
    return this.call('POST', path, body);
  }
}

export const as = (node: NodeName, who: Person) => new Api(node, who);

/** The list inside a response, whatever the endpoint calls it. */
export function rows(payload: Json): Json[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['items', 'rows', 'data', 'results', 'lines', 'deliveries', 'pools']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

export const uid = () => randomUUID();

/** A short run-unique tag, e.g. `T5K2Q`, for names, notes and supplier codes. */
export function tag(prefix = 'T'): string {
  return prefix + Date.now().toString(36).slice(-4).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `probe` returns something truthy (sync between nodes takes seconds). */
export async function waitFor<T>(label: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, everyMs = 3_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const got = await probe();
      if (got) return got;
    } catch (error) {
      last = error;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`);
}

/** Ask the nodes to sync now instead of on their next tick. */
export async function nudge(...nodes: NodeName[]) {
  for (const node of nodes.length ? nodes : (['dc', 'cloud', 'store'] as NodeName[])) {
    await as(node, 'admin').call('POST', '/api/v1/sync/trigger', {}, { ok: false }).catch(() => undefined);
  }
}

export async function settle() {
  await nudge('dc', 'cloud');
  await sleep(6_000);
}

// ── purchase orders ──────────────────────────────────────────────────────────

export interface ItemCtx {
  supplier: Json;
  item: Json;
}

/** Supplier 0001 (demo seed), found by following the pages: test suppliers
 *  pile up in front of it as runs accumulate. */
export async function supplier0001(): Promise<Json> {
  const cloud = as('cloud', 'rina');
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const body: Json = await cloud.get(`/api/v1/suppliers?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const hit = rows(body).find((s) => s.supplier_code === '0001');
    if (hit) return hit;
    cursor = body?.next_cursor ?? null;
    if (!cursor) break;
  }
  throw new Error('supplier 0001 missing — run e2e/agentic/provision.sh');
}

/** Supplier 0001 (demo seed) with a sourcing item of its own for this tag: 2 colours × 2 sizes, Rp 40.000. */
export async function makeItem(t: string, { price = 40_000 } = {}): Promise<ItemCtx> {
  const cloud = as('cloud', 'rina');
  const supplier = await supplier0001();
  // Take the item from the create answer: the supplier's list grows past any
  // page size as runs pile up, so looking it up again misses it.
  const created = await cloud.post(`/api/v1/suppliers/${supplier.supplier_id}/items`, {
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
  const item = created?.item ?? created;
  return { supplier, item };
}

/** The route New PO uses; the server numbers the order (PO-DDMMYY-NNN). */
export async function placePo(ctx: ItemCtx, qty: number, { perVariant, notes = 'Uji e2e', by = 'rina' as Person } = {}): Promise<string> {
  const each = perVariant ?? Math.floor(qty / 4);
  const variants = ['BLACK', 'WHITE'].flatMap((c) => ['03', '04'].map((z) => ({ colour_code: c, size_code: z, quantity: each, base_price_minor: null })));
  const promised = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const receipt = await as('cloud', by).post('/api/v1/purchase-orders/catalog', {
    po_number: null,
    supplier_id: ctx.supplier.supplier_id,
    destination_site_id: null,
    notes,
    discount_minor: null,
    payment_terms_code: null,
    lines: [
      {
        supplier_item_id: ctx.item.supplier_item_id,
        quantity: qty,
        promised_date: promised,
        unit_price_minor: null,
        article_name: null,
        image_url: null,
        division_code: null,
        tags: null,
        base_price_minor: 99_000,
        markup_bps: null,
        variants,
      },
    ],
  });
  return receipt.po_number as string;
}

export async function poByNumber(poNumber: string): Promise<Json | undefined> {
  return rows(await as('cloud', 'rina').get('/api/v1/purchase-orders?limit=500')).find((p) => p.po_number === poNumber);
}

export async function poDetail(poNumber: string): Promise<Json> {
  const po = await poByNumber(poNumber);
  return po ? as('cloud', 'rina').get(`/api/v1/purchase-orders/${po.purchase_order_id}`) : {};
}

/** The PO list row's figures, in pieces. */
export async function poNumbers(poNumber: string) {
  const po = (await poByNumber(poNumber)) ?? {};
  const keys = ['order_status', 'lifecycle', 'expected_stock_units', 'received_stock_units', 'outstanding_stock_units', 'invoiced_stock_units', 'excess_stock_units'] as const;
  return Object.fromEntries(keys.map((k) => [k, po[k]])) as Record<(typeof keys)[number], Json>;
}

export async function firstLine(poNumber: string): Promise<Json> {
  return ((await poDetail(poNumber)).lines ?? [{}])[0];
}

/** Wait until the PO's figures equal `want` (sync takes a few seconds). */
export async function waitPo(poNumber: string, want: Partial<Record<string, Json>>, timeoutMs = 90_000) {
  return waitFor(`${poNumber} ${JSON.stringify(want)}`, async () => {
    const n = await poNumbers(poNumber);
    return Object.entries(want).every(([k, v]) => (n as Json)[k] === v) ? n : null;
  }, timeoutMs);
}

/** The PO's line as the DC sees it (it must have synced there first). */
export async function dcLine(poNumber: string): Promise<Json> {
  const dc = as('dc', 'nina');
  return waitFor(`${poNumber} at the DC`, async () => {
    await nudge('cloud', 'dc');
    return rows(await dc.get('/api/v1/dc/purchase-orders?limit=500')).find((l) => l.po_number === poNumber);
  }, 120_000);
}

/** A delivery arrives: the DC opens a goods receipt for the supplier. */
export async function openReceipt(ctx: ItemCtx, who: Person = 'nina') {
  return as('dc', who).post('/api/v1/dc/goods-receipts', { supplier_id: ctx.supplier.supplier_code, actor_id: who, idempotency_key: uid() });
}

/** The DC counts one PO line of a receipt blind; `wrong` = pieces Not as Ordered. */
export async function countLine(receiptId: string, poLineId: string, counted: number, { wrong = 0, who = 'nina' as Person } = {}) {
  return as('dc', who).post('/api/v1/dc/purchase-counts', {
    receipt_id: receiptId,
    po_line_id: poLineId,
    counted_quantity: counted,
    wrong_quantity: wrong,
    actor_id: who,
    idempotency_key: uid(),
  });
}

/**
 * The buyer's review of a count. Decisions the backend takes: Accept, Recount.
 * A count exactly as ordered is received on its own, so Accept on it answers
 * "already accepted" — returned, not thrown.
 */
export async function verifyCount(countId: string, decision: 'Accept' | 'Recount', price: number, note?: string) {
  return as('dc', 'rina').call(
    'POST',
    '/api/v1/dc/purchase-verifications',
    { count_id: countId, verifier_actor_id: 'rina', decision, invoiced_price_minor: price, idempotency_key: uid(), ...(note ? { note } : {}) },
    { ok: false },
  );
}

/** Delivery, count and (optionally) review in one go — the usual arrange step. */
export async function deliver(ctx: ItemCtx, poNumber: string, counted: number, { wrong = 0, review = 'Accept' as 'Accept' | 'Recount' | null } = {}) {
  const line = await dcLine(poNumber);
  const receipt = await openReceipt(ctx);
  const count = await countLine(receipt.receipt_id, line.po_line_id, counted, { wrong });
  const verified = review ? await verifyCount(count.count_id, review, ctx.item.unit_price_minor) : null;
  return { line, receipt, count, verified };
}

export async function closeShort(poNumber: string, reason = 'Supplier tidak bisa kirim sisa') {
  const line = await firstLine(poNumber);
  return as('cloud', 'rina').post(`/api/v1/purchase-order-lines/${line.po_line_id}/close-short`, { closed_by: 'rina', reason });
}

export async function cancelPo(poNumber: string, reason = 'Salah supplier') {
  const d = await poDetail(poNumber);
  return as('cloud', 'rina').post(`/api/v1/purchase-orders/${d.purchase_order_id}/cancel`, { reason });
}

export async function rejectDelivery(ctx: ItemCtx, reason = 'Kemasan rusak, dikembalikan ke supir') {
  const receipt = await openReceipt(ctx);
  return as('dc', 'nina').post(`/api/v1/dc/goods-receipts/${receipt.receipt_id}/reject`, { receipt_id: receipt.receipt_id, reason, actor_id: 'nina', idempotency_key: uid() });
}

// ── purchase returns (Return PO) ─────────────────────────────────────────────

/** The buyer raises a return for a line's excess / Not as Ordered pieces. */
export async function raiseReturn(poNumber: string, note = 'Kelebihan dikembalikan ke supplier') {
  const d = await poDetail(poNumber);
  const line = d.lines[0];
  return as('cloud', 'rina').post(`/api/v1/purchase-orders/${d.purchase_order_id}/returns`, { po_line_ids: [line.po_line_id], note });
}

export async function dcReturns(poNumber: string): Promise<Json[]> {
  return rows(await as('dc', 'nina').get('/api/v1/dc/purchase-returns')).filter((r) => r.po_number === poNumber);
}

export async function handOver(returnId: string, handedTo = 'Pak Joko') {
  return as('dc', 'nina').post(`/api/v1/dc/purchase-returns/${returnId}/hand-over`, { actor_id: 'nina', handed_to: handedTo, idempotency_key: uid() });
}

// ── stores ───────────────────────────────────────────────────────────────────

export async function stores(): Promise<Json[]> {
  return rows(await as('cloud', 'admin').get('/api/v1/stores'));
}
