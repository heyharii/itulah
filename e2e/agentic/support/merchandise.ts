// Merchandise & master-data helpers: vocabulary, colours, units, name
// suggestions, suppliers, and the article that comes out of New Articles.
// Everything a test creates carries the run's `tag()`.
//
// rig.ts's Api cannot send If-Match (PATCH/DELETE on master data are guarded by
// the record's version), so this file keeps its own small client.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'e2e';
import { LABEL_SINK_PORT, type OwnStock } from './inventory.ts';
import { as, deliver, nudge, placePo, rows, tag, waitFor, supplier0001 } from './rig.ts';
import { PASSWORD, RIG, type Person } from './base.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { tag, rows, as };

const tokens = new Map<string, string>();

async function token(who: Person): Promise<string> {
  let t = tokens.get(who);
  if (!t) {
    const res = await fetch(`${RIG.cloud}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: who, password: PASSWORD }),
    });
    const body = await res.json();
    t = body.token as string;
    tokens.set(who, t);
  }
  return t;
}

/** A cloud call that can carry the record version (If-Match) and returns status + body. */
export async function cloudCall(
  method: string,
  path: string,
  body?: Json,
  { version, who = 'rina' as Person }: { version?: number; who?: Person } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${await token(who)}`,
  };
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();
  if (version !== undefined) headers['if-match'] = `"${version}"`;
  const res = await fetch(RIG.cloud + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

async function must(r: Promise<{ status: number; body: Json }>, where: string): Promise<Json> {
  const { status, body } = await r;
  if (status >= 300) throw new Error(`${where} -> ${status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

// ── vocabulary: divisions / tags / sizes ─────────────────────────────────────

export type Kind = 'divisions' | 'tags' | 'sizes';

export async function terms(kind: Kind): Promise<Json[]> {
  return (await must(cloudCall('GET', `/api/v1/vocabulary/${kind}`), `GET ${kind}`)).terms;
}

export async function termByLabel(kind: Kind, label: string): Promise<Json | undefined> {
  return (await terms(kind)).find((t) => t.label === label);
}

export async function termByCode(kind: Kind, code: string): Promise<Json | undefined> {
  return (await terms(kind)).find((t) => t.code === code);
}

export async function createTermApi(kind: Kind, label: string, code?: string): Promise<Json> {
  const c = code ?? label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return must(cloudCall('POST', `/api/v1/vocabulary/${kind}`, { code: c, label, display_order: 999 }), `create ${kind}`);
}

export async function deleteTermApi(kind: Kind, code: string) {
  const t = await termByCode(kind, code);
  if (t) await cloudCall('DELETE', `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}`, undefined, { version: t.version });
}

export async function patchTermApi(kind: Kind, code: string, change: Json): Promise<{ status: number; body: Json }> {
  const t = await termByCode(kind, code);
  return cloudCall('PATCH', `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}`, change, { version: t?.version });
}

export async function usage(kind: Kind, code: string): Promise<Json> {
  return must(cloudCall('GET', `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}/usage`), 'usage');
}

// ── colours ──────────────────────────────────────────────────────────────────

export async function colours(): Promise<Json[]> {
  return (await must(cloudCall('GET', '/api/v1/colours'), 'GET colours')).colours;
}

export async function colourByLabel(label: string): Promise<Json | undefined> {
  return (await colours()).find((c) => c.label === label);
}

export async function createColourApi(label: string, hex: string | null, code?: string): Promise<Json> {
  const c = code ?? label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return must(cloudCall('POST', '/api/v1/colours', { code: c, label, hex_code: hex, display_order: 999 }), 'create colour');
}

export async function deleteColourApi(code: string) {
  const all = await colours();
  const one = all.find((c) => c.code === code);
  if (one) await cloudCall('DELETE', `/api/v1/colours/${encodeURIComponent(code)}`, undefined, { version: one.version });
}

// ── units ────────────────────────────────────────────────────────────────────

export async function unitsBook(): Promise<{ units: Json[]; conversions: Json[] }> {
  const body = await must(cloudCall('GET', '/api/v1/units'), 'GET units');
  return { units: body.units ?? [], conversions: body.conversions ?? body.unit_conversions ?? [] };
}

export async function unitOf(code: string): Promise<Json | undefined> {
  return (await unitsBook()).units.find((u) => u.code === code);
}

export async function createUnitApi(code: string, label: string, extra: Json = {}): Promise<Json> {
  return must(
    cloudCall('POST', '/api/v1/units', { code, label, is_base: false, category: 'COUNT', whole_number: true, aliases: [], ...extra }),
    'create unit',
  );
}

export async function createConversionApi(from: string, to: string, factor: string, note: string | null = null): Promise<Json> {
  return must(cloudCall('POST', '/api/v1/unit-conversions', { from_unit: from, to_unit: to, factor, note }), 'create conversion');
}

/** Units and conversion codes are short and upper case; this makes a unique 8-char code from a tag. */
export const unitCode = (t: string) => t.replace(/[^A-Z0-9]/g, '').slice(0, 8);

// ── name suggestions ─────────────────────────────────────────────────────────

export async function nameSuggestions(): Promise<Json[]> {
  return (await must(cloudCall('GET', '/api/v1/name-suggestions?all=true'), 'name suggestions')) as Json[];
}

export async function createNameApi(name: string): Promise<Json> {
  return must(cloudCall('POST', '/api/v1/name-suggestions', { name }), 'create name');
}

export async function deleteNameApi(id: string) {
  await cloudCall('DELETE', `/api/v1/name-suggestions/${id}`);
}

// ── articles ─────────────────────────────────────────────────────────────────

export async function articleByName(name: string): Promise<Json | undefined> {
  const page = await must(cloudCall('GET', `/api/v1/articles?limit=50&q=${encodeURIComponent(name)}`), 'articles');
  return (page.items ?? []).find((a: Json) => a.name === name);
}

/** GET /articles/{code} answers { article, skus, created_by_session_id, supplier_items, units }; this flattens the article into the top level. */
export async function articleDetail(code: string): Promise<Json> {
  const body = await must(cloudCall('GET', `/api/v1/articles/${code}`), 'article');
  return { ...body.article, skus: body.skus, created_by_session_id: body.created_by_session_id, supplier_items: body.supplier_items, units: body.units };
}

export async function patchArticle(code: string, change: Json): Promise<{ status: number; body: Json }> {
  const a = await articleDetail(code);
  return cloudCall('PATCH', `/api/v1/articles/${code}`, change, { version: a.version });
}

/** The delivery line that waits in New Articles for this PO. */
export async function waitingLine(poNumber: string): Promise<Json> {
  return waitFor(`${poNumber} in New Articles`, async () => {
    await nudge('dc', 'cloud');
    return rows(await as('cloud', 'rina').get('/api/v1/article-setups/unidentified')).find((r) => r.po_number === poNumber);
  }, 180_000);
}

/**
 * A PO of `qty` pieces on supplier 0001 for a fresh item, delivered and accepted: the pieces sit "Unidentified" and the
 * line waits in New Articles. Same as support/inventory.ts unidentifiedStock, except the item comes from the POST's
 * answer: rig.makeItem looks it up again in the supplier's first 200 items, which Garmen Nusantara has outgrown.
 */
export async function ownStock(qty = 8, t = tag('MD')): Promise<OwnStock> {
  const supplier = await supplier0001();
  if (!supplier) throw new Error('supplier 0001 missing — run e2e/agentic/provision.sh');
  const item = await createItemApi(supplier.supplier_id, `${t}-KAO`, `Kaos Uji ${t}`, 40_000);
  const ctx = { supplier, item };
  const poNumber = await placePo(ctx, qty, { notes: `Uji merchandise ${t}` });
  await deliver(ctx, poNumber, qty, { review: 'Accept' });
  return { t, ctx, poNumber, qty, article: `Kaos Uji ${t}` };
}

export interface NewArticle {
  t: string;
  stock: OwnStock;
  receiptLineId: string;
  /** 8-digit code of the first (or only) article. */
  code: string;
  codes: string[];
  name: string;
  sessionIds: string[];
}

/** A delivered, accepted line set up and issued as one article of 2 colours x 2 sizes (or split in two). */
export async function newArticle(qty = 8, t = tag('MD'), { split = false } = {}): Promise<NewArticle> {
  const stock = await ownStock(qty, t);
  const cloud = as('cloud', 'rina');
  const row = await waitingLine(stock.poNumber);
  const colour = (d: number, c: string) => ({ colour_digit: String(d), colour_code: c });
  const header = {
    receipt_line_id: row.receipt_line_id,
    article_name: row.article_name,
    division_code: row.division_code,
    tags: row.tags ?? [],
    image_url: null,
    currency: 'IDR',
    created_by: 'rina',
  };
  const variant = (d: number, s: string, q: number) => ({ colour_digit: String(d), size_code: s, quantity: q, base_price_minor: 99_000 });
  let sessionIds: string[];
  if (split) {
    const res = await cloud.post('/api/v1/article-setups/split', {
      ...header,
      articles: [
        { colours: [colour(1, 'BLACK')], variants: [variant(1, '03', qty / 4), variant(1, '04', qty / 4)] },
        { colours: [colour(1, 'WHITE')], variants: [variant(1, '03', qty / 4), variant(1, '04', qty / 4)] },
      ],
    });
    sessionIds = (res.items ?? []).map((s: Json) => s.session_id);
  } else {
    const s = await cloud.post('/api/v1/article-setups', {
      ...header,
      colours: [colour(1, 'BLACK'), colour(2, 'WHITE')],
      variants: [variant(1, '03', qty / 4), variant(1, '04', qty / 4), variant(2, '03', qty / 4), variant(2, '04', qty / 4)],
    });
    sessionIds = [s.session_id];
  }
  for (const id of sessionIds) await cloud.post(`/api/v1/article-setups/${id}/issue`, { issued_by: 'rina' });
  const name = row.article_name as string;
  const found = await waitFor(`articles named ${name}`, async () => {
    const page = await cloudCall('GET', `/api/v1/articles?limit=50&q=${encodeURIComponent(name)}`);
    const list = ((page.body?.items ?? []) as Json[]).filter((a) => a.name === name && a.sku_count > 0);
    return list.length >= sessionIds.length ? list : null;
  }, 120_000, 3_000);
  const codes = found.map((a) => a.article_code as string).sort();
  return { t, stock, receiptLineId: row.receipt_line_id as string, code: codes[0]!, codes, name, sessionIds };
}

export { LABEL_SINK_PORT };

// ── suppliers ────────────────────────────────────────────────────────────────

export async function supplierByName(name: string): Promise<Json | undefined> {
  const page = await must(cloudCall('GET', `/api/v1/suppliers?limit=50&q=${encodeURIComponent(name)}`), 'suppliers');
  return (page.rows ?? []).find((s: Json) => s.name.toLowerCase() === name.toLowerCase());
}

export async function supplierDetail(id: string): Promise<Json> {
  return must(cloudCall('GET', `/api/v1/suppliers/${id}`), 'supplier');
}

export async function createSupplierApi(name: string, extra: Json = {}): Promise<Json> {
  return must(
    cloudCall('POST', '/api/v1/suppliers', {
      supplier_code: null,
      name,
      legal_form: 'PT',
      contact_name: null,
      phone: '0812-3456-7890',
      email: null,
      address: 'Jl. Uji No. 1',
      status: 'ACTIVE',
      npwp: null,
      is_pkp: false,
      notes: null,
      contacts: [],
      ...extra,
    }),
    'create supplier',
  );
}

export async function basket(who: Person = 'admin'): Promise<Json[]> {
  return (await must(cloudCall('GET', '/api/v1/sourcing-basket', undefined, { who }), 'basket')) as Json[];
}

export async function emptyBasket(who: Person = 'admin') {
  await cloudCall('POST', '/api/v1/sourcing-basket/clear', {}, { who });
}

// ── UI helpers ───────────────────────────────────────────────────────────────

export const SLOW = { timeout: 60_000 } as const;

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type App = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Open a master-data list and wait for its page header. */
export async function openList(app: App, screen: Screen, path: string, title: string) {
  await app.open(path);
  await expect(screen.getByRole('heading', title)).toBeVisible(SLOW);
}

/** The table row (or card) that mentions `text`. */
export const rowWith = (screen: Screen, text: string) => screen.getByRole('row').filter({ hasText: text });

export const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// ── debugging ────────────────────────────────────────────────────────────────

/** Write the visible text and the interactive elements (role | name) of the page to .e2e/out/merchandise/dumps/<name>.txt. */
export async function dump(browser: { evaluate: (fn: any, arg?: any) => Promise<any> }, name: string) {
  const text: string = await browser.evaluate(() => {
    const out: string[] = ['URL ' + location.href, '--- innerText ---', document.body.innerText.slice(0, 5000), '--- interactive ---'];
    document.querySelectorAll('button, a, [role], input, textarea, select, [aria-label]').forEach((el) => {
      const e = el as HTMLElement;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const role = e.getAttribute('role') || e.tagName.toLowerCase();
      const label = e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0, 60) || (e as HTMLInputElement).placeholder || '';
      out.push(`${role} | ${label.replace(/\n/g, ' / ')}${(e as HTMLButtonElement).disabled ? ' [disabled]' : ''}`);
    });
    return out.join('\n');
  });
  mkdirSync('.e2e/out/merchandise/dumps', { recursive: true });
  writeFileSync(`.e2e/out/merchandise/dumps/${name}.txt`, text);
}

// ── data shared by the tests of a run ────────────────────────────────────────

/**
 * Build something expensive once (a delivered, set-up article takes minutes: PO, count, sync, setup) and let the
 * next tests reuse it. The record lives in .e2e/shared/<key>.json on the machine running the tests; a test only gets
 * it back while `valid` still says it is usable, otherwise a new one is built. Tests that CONSUME the data
 * (submit a line, print labels) must ask for their own, or validate for the state they need.
 */
export async function shared<T>(key: string, make: () => Promise<T>, valid: (v: T) => Promise<boolean> = async () => true, maxAgeMs = 4 * 3600_000): Promise<T> {
  const file = `.e2e/shared/${key}.json`;
  if (existsSync(file)) {
    try {
      const got = JSON.parse(readFileSync(file, 'utf8')) as { at: number; value: T };
      if (Date.now() - got.at < maxAgeMs && (await valid(got.value))) return got.value;
    } catch {
      /* rebuild */
    }
  }
  const value = await make();
  mkdirSync('.e2e/shared', { recursive: true });
  writeFileSync(file, JSON.stringify({ at: Date.now(), value }));
  return value;
}

/** The article most tests read and edit: 2 colours x 2 sizes, Rp 99.000 over a Rp 40.000 cost, made through New Articles. */
export function sharedArticle(): Promise<NewArticle> {
  return shared('merch-article', () => newArticle(8, tag('AM')), async (a) => (await cloudCall('GET', `/api/v1/articles/${a.code}`)).status === 200);
}

/** A line still waiting in New Articles (never submitted by a test), for the tests that only read the sheet. */
export async function stillWaiting(receiptLineId: string): Promise<boolean> {
  return rows(await as('cloud', 'rina').get('/api/v1/article-setups/unidentified')).some((r) => r.receipt_line_id === receiptLineId);
}

/** A supplier item with a response in hand (rig.makeItem re-lists the supplier's first 200 items, which Garmen outgrew). */
export async function createItemApi(supplierId: string, code: string, name: string, price = 55_000): Promise<Json> {
  return must(
    cloudCall('POST', `/api/v1/suppliers/${supplierId}/items`, {
      supplier_item_code: code,
      name,
      unit_price_minor: price,
      currency: 'IDR',
      status: 'ACTIVE',
      division_code: 'PRIA',
      tags: ['KAOS'],
      colour_codes: ['BLACK', 'WHITE'],
      size_codes: ['03', '04'],
    }),
    'create supplier item',
  );
}
