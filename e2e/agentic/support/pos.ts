// POS helpers: the shop node's API (units on the floor, quotes, shifts, sales, void, return) and the
// web till's screens (sign in, scan, pay). Two rules the tests live by:
//  - the node is the referee: a total on screen must equal `/api/v1/store/quote`, a completed sale must
//    be in the node's sales window, a unit must have left (or come back to) `store-01.floor`;
//  - stock on the rig is scarce (~17 units on the floor), so every test that sells puts its units back
//    afterwards (`restoreSale` = a supervisor void by API) and picks units from the END of the EPC list,
//    leaving the first ones to the Sales (hub) agent.
import type { App, Locator, Screen } from 'e2e';
import { expect } from 'e2e';
import type { Browser } from '@e2e-dev/web';
import { PASSWORD } from './base.ts';
import { as, nudge, rows, uid, waitFor } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const TERMINAL = 'KASIR-1';
export const SEAT = 'Kasir 1';
export const FLOOR = 'store-01.floor:on_hand';
/** Seeded by the commercial stage (scripts/demo_stages/commercial.py). */
export const MEMBER = { id: '081311110001', name: 'Sari Wulandari' };
export const COUPON = 'HEMAT50';

/** "Rp 159.000" as the apps print it (Intl id-ID puts a no-break space after Rp). */
export const rp = (minor: number) => `Rp ${minor.toLocaleString('id-ID')}`;
/** 159000 from "Rp 159.000" / "−Rp 15.900" / "Bayar Rp 159.000"; NaN when there is no figure. */
export function moneyIn(text: string): number {
  const m = text.replace(/ | /g, ' ').match(/Rp\s*([\d.]+)/);
  return m ? Number(m[1].replace(/\./g, '')) : NaN;
}

// ── the node's own view ──────────────────────────────────────────────────────

const maya = () => as('store', 'maya');
const dian = () => as('store', 'dian');

export interface Unit {
  epc: string;
  sku: string;
  name: string;
  price: number; // sticker price
  base: number; // price before a markdown
  quoted: number; // what the node quotes alone, no member
  promo: string | null; // the applied promotion's name
  kind: 'plain' | 'shoe' | 'wanita' | 'markdown';
}

export async function catalogue(): Promise<Record<string, Json>> {
  const cat = await dian().get('/api/v1/store/catalog');
  return Object.fromEntries((cat.items as Json[]).map((i) => [i.sku_code, i]));
}

/** Where every unit stands now, from the node's movement ledger. */
export async function places(): Promise<Record<string, string>> {
  const moves = rows(await maya().get('/api/v1/inventory/movements?limit=5000')).sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
  const at: Record<string, string> = {};
  for (const m of moves) at[m.epc] = m.to;
  return at;
}

export const placeOf = async (epc: string) => (await places())[epc];

export async function quote(epcs: string[], { coupons = [] as string[], member = null as string | null, charges = [] as Json[] } = {}): Promise<Json> {
  return dian().post('/api/v1/store/quote', { epcs, coupon_codes: coupons, customer_id: member, charges });
}
/** The amount a customer pays: what the till puts on its Bayar button. */
export const dueOf = (q: Json): number => (q.amount_due_minor ?? q.total_minor) as number;

/** Units standing on the floor right now, classified by what the node quotes for them. */
export async function floorUnits(): Promise<Unit[]> {
  const [at, cat] = await Promise.all([places(), catalogue()]);
  const epcs = Object.entries(at).filter(([, p]) => p === FLOOR).map(([e]) => e).sort().reverse();
  const out: Unit[] = [];
  for (const epc of epcs) {
    const row = cat[epc.slice(2, 13)];
    if (!row) continue;
    const q = await quote([epc]);
    const applied = ((q.promotions ?? []) as Json[]).filter((p) => p.applied).map((p) => p.name as string);
    const promo = applied[0] ?? null;
    out.push({
      epc,
      sku: row.sku_code,
      name: row.name,
      price: row.unit_price_minor,
      base: row.base_unit_price_minor,
      quoted: dueOf(q),
      promo,
      kind: row.base_unit_price_minor > row.unit_price_minor ? 'markdown' : promo?.includes('Sepatu') ? 'shoe' : promo?.includes('Wanita') ? 'wanita' : 'plain',
    });
  }
  return out;
}

const taken = new Set<string>();

/** One unit of a kind, not used by another test of this process. Throws (with the floor's state) when none is left. */
export async function pickUnit(kind: Unit['kind'], { not = [] as string[] } = {}): Promise<Unit> {
  const units = await floorUnits();
  const unit = units.find((u) => u.kind === kind && !taken.has(u.epc) && !not.includes(u.epc));
  if (!unit) throw new Error(`no ${kind} unit left on store-01's floor (${units.map((u) => `${u.kind}:${u.name}`).join(', ') || 'floor is empty'})`);
  taken.add(unit.epc);
  return unit;
}
/** Like pickUnit, but skips the test (with the reason) when the floor has none of that kind. */
export async function pickUnitOrSkip(skip: (reason: string) => void, kind: Unit['kind']): Promise<Unit> {
  try {
    return await pickUnit(kind);
  } catch (e) {
    skip(`stock: ${(e as Error).message.split('(')[0]}`);
    throw e;
  }
}
export const release = (...epcs: string[]) => epcs.forEach((e) => taken.delete(e));

// ── shifts ───────────────────────────────────────────────────────────────────

export const myShifts = () => dian().get('/api/v1/store/shifts/mine');

/** dian holds an open shift on KASIR-1 (taking the seat over when somebody else has it). Idempotent. */
export async function ensureShift(float = 500_000): Promise<Json> {
  const mine = await myShifts();
  if (mine.open?.terminal_id === TERMINAL) return mine.open;
  const out = await dian().post('/api/v1/store/shifts/take-over', {
    terminal_id: TERMINAL,
    opening_float_minor: float,
    actor_id: 'dian',
    idempotency_key: uid(),
  });
  return out.shift;
}

/** Close dian's open shift by API (counted blind; the till's own close screen is covered by a UI test). */
export async function closeMyShift(declared = 0): Promise<Json | null> {
  const mine = await myShifts();
  if (!mine.open) return null;
  return dian().post(`/api/v1/store/shifts/${mine.open.shift_id}/close`, {
    declared_cash_minor: declared,
    counted: [],
    note: 'e2e',
    actor_id: 'dian',
    idempotency_key: uid(),
  });
}

/** Count the drawer of a shift somebody took over (the gate asks for it before anything else). */
export async function countUncounted(): Promise<void> {
  const mine = await myShifts();
  for (const owed of mine.uncounted ?? []) {
    await dian().post(`/api/v1/store/shifts/${owed.shift_id}/count`, {
      declared_cash_minor: 0,
      counted: [],
      note: 'e2e',
      actor_id: 'dian',
      idempotency_key: uid(),
    });
  }
}

// ── sales ────────────────────────────────────────────────────────────────────

export interface SaleOpts {
  tenders?: Json[];
  coupons?: string[];
  member?: string | null;
  charges?: Json[];
}

/** Ring a sale through the node's API (the arrange step for void/return tests). Cash exact by default. */
export async function sellByApi(epcs: string[], opts: SaleOpts = {}): Promise<Json> {
  await ensureShift();
  const q = await quote(epcs, { coupons: opts.coupons, member: opts.member, charges: opts.charges });
  const tenders = opts.tenders ?? [{ method: 'CASH', amount_minor: dueOf(q), reference: null }];
  return dian().post('/api/v1/store/sales', {
    epcs,
    tenders,
    actor_id: 'dian',
    idempotency_key: uid(),
    coupon_codes: opts.coupons ?? [],
    customer_id: opts.member ?? null,
    charges: opts.charges ?? [],
  });
}

export const receipt = (saleId: string) => maya().get(`/api/v1/store/sales/${saleId}/receipt`);

/** A completed sale as the node lists it for today (Money › Sales reads the same window). */
export async function saleInWindow(saleId: string): Promise<Json | undefined> {
  const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // WIB
  const w = await maya().get(`/api/v1/store/reports/sales/window?from=${day}&to=${day}`);
  return (w.receipts as Json[]).find((r) => r.id === saleId);
}

/** Supervisor void by API: puts the sale's units back on the floor. Safe to call twice. */
export async function voidByApi(saleId: string, reason = 'e2e: unit goes back to the floor'): Promise<Json> {
  return maya().call(
    'POST',
    `/api/v1/store/sales/${saleId}/void`,
    { reason, supervisor: { username: 'maya', password: PASSWORD }, actor_id: 'dian', idempotency_key: uid() },
    { ok: false },
  );
}

/** Every test that sold something calls this in `finally`: the units are back on the floor. */
export async function restoreSale(saleId: string | null | undefined, ...epcs: string[]) {
  try {
    if (saleId) await voidByApi(saleId);
  } finally {
    release(...epcs);
  }
}

export async function waitOnFloor(epc: string, on = true) {
  return waitFor(`${epc} ${on ? 'on' : 'off'} the floor`, async () => ((await placeOf(epc)) === FLOOR) === on, 30_000, 1_000);
}

// ── the web till ─────────────────────────────────────────────────────────────

export interface Till {
  app: App;
  screen: Screen;
  browser: Browser;
}

export const scanField = (s: Screen) => s.getByRole('textbox', 'Pindai tag atau cari barang');
const payButton = (s: Screen) => s.getByRole('button', /^Bayar Rp/);

/** Sign in on the till's form. Ends on whatever follows: the shift gate or the counter. */
export async function signInTill({ app, screen }: Till, who: 'dian' | 'maya' = 'dian', password = PASSWORD) {
  await app.open('/');
  await screen.getByLabel('Nama pengguna').fill(who);
  await screen.getByLabel('Kata sandi').fill(password);
  await screen.getByRole('button', 'Masuk').tap();
}

/** Signed in with a shift already open: the scan field is on screen. */
export async function openCounter(t: Till, { float = 500_000 } = {}) {
  await countUncounted();
  await ensureShift(float);
  await signInTill(t);
  await expect(scanField(t.screen)).toBeVisible({ timeout: 30_000 });
}

export async function scan(t: Till, text: string) {
  const field = scanField(t.screen);
  await field.fill(text);
  await field.press('Enter');
}

/** Scan units and wait until the basket says how many are in. */
export async function scanUnits(t: Till, ...epcs: string[]) {
  for (const [i, epc] of epcs.entries()) {
    await scan(t, epc);
    await expect(t.screen.getByText(`${i + 1} unit`, { exact: true })).toBeVisible();
  }
}

/** The figure on the Bayar button once the quote has settled (stale quotes say "Menghitung…"). */
export async function payTotal(t: Till, expected?: number): Promise<number> {
  const button = payButton(t.screen);
  if (expected !== undefined) await expect(button).toHaveText(new RegExp(`^Bayar ${rp(expected).replace('Rp ', 'Rp\\s')}`), { timeout: 15_000 });
  await expect(t.screen.getByText('Menghitung…')).toBeHidden({ timeout: 15_000 });
  return moneyIn((await button.textContent()) ?? '');
}

export async function goToPayment(t: Till) {
  await payButton(t.screen).tap();
  await expect(t.screen.getByText('Metode pembayaran', { exact: true })).toBeVisible();
}

/** The sale id the "Transaksi selesai" card prints. */
export async function saleIdOnCard(s: Screen): Promise<string> {
  const text = await s.getByRole('dialog', 'Transaksi selesai').textContent();
  const m = (text ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (!m) throw new Error(`no sale id on the card: ${text}`);
  return m[0];
}

/** "Selesaikan transaksi" → the node books the sale → the "Transaksi selesai" card. Returns the sale id. */
export async function finishSale(t: Till): Promise<string> {
  await t.screen.getByRole('button', 'Selesaikan transaksi').tap();
  await expect(t.screen.getByRole('dialog', 'Transaksi selesai')).toBeVisible({ timeout: 30_000 });
  return saleIdOnCard(t.screen);
}

export async function nextSale(t: Till) {
  await t.screen.getByRole('button', 'Transaksi berikutnya').tap();
  await expect(t.screen.getByText('Siap untuk transaksi baru', { exact: true })).toBeVisible();
}

/** Pay the whole basket in cash, exact (no typing: the field's placeholder is the amount due). */
export async function payCashExact(t: Till) {
  await goToPayment(t);
  await payButton(t.screen).tap();
  await expect(t.screen.getByText('Lunas', { exact: true })).toBeVisible();
}
export type { Locator };
export { rows };

/** The "Persetujuan kepala toko" sheet: a supervisor types a code and a password (web has no PIN/finger). */
export async function approve(t: Till, who = 'maya', password = PASSWORD) {
  const sheet = t.screen.getByRole('dialog', 'Persetujuan kepala toko');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Kode supervisor').fill(who);
  await sheet.getByLabel('Kata sandi').fill(password);
  await sheet.getByRole('button', 'Setujui').tap();
}

/** The shopper side of "Tukar poin": pair the member app with a staff code and ask for `points` as a voucher. */
export async function requestRedeem(memberId: string, points: number): Promise<{ request_id: string; code: string }> {
  const base = (await import('./base.ts')).RIG.cloud;
  const pairing = await as('cloud', 'dian').post(`/api/v1/members/${memberId}/pairing-code`, {});
  const session = await fetch(`${base}/api/v1/member/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ member_id: memberId, code: pairing.code }) });
  if (!session.ok) throw new Error(`member pairing answered ${session.status}`);
  const cookies = session.headers.getSetCookie().map((c) => c.split(';')[0]);
  const csrf = cookies.find((c) => c.startsWith('member_csrf='))?.split('=')[1] ?? '';
  const res = await fetch(`${base}/api/v1/member/points/redeem-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.join('; '), 'x-csrf-token': csrf, 'idempotency-key': uid() },
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`redeem request answered ${res.status}: ${await res.text()}`);
  return res.json();
}

/** The newest receipt of today's window with this total, after `sinceMs`. */
export async function newestSale(total: number, sinceMs: number): Promise<Json | undefined> {
  const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const w = await as('store', 'maya').get(`/api/v1/store/reports/sales/window?from=${day}&to=${day}`);
  return (w.receipts as Json[]).filter((r) => r.total_minor === total && Date.parse(r.completed_at) >= sinceMs).sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];
}

// ── a delivery from the DC on its way to store-01 ───────────────────────────
// Ported from scripts/demo_stages/outbound.py (allot → pick → pack → ship → depart). It spends units that
// sit on the DC racks (dc.warehouse: ~23 colour-2 SKUs after provisioning), so ask for few.

const dcRows = (x: Json) => rows(x);

/** SKUs with at least one piece on the DC racks right now (head office's view), newest codes first. */
export async function dcSkus(n: number): Promise<string[]> {
  const avail = dcRows(await as('cloud', 'rina').get('/api/v1/inventory/availability?limit=500'));
  const codes = avail.filter((a) => (a.on_hand_qty ?? 0) >= 1).map((a) => a.sku_code as string).sort().reverse();
  if (codes.length < n) throw new Error(`the DC racks hold only ${codes.length} SKU(s) with stock; need ${n} (each store-receive test spends DC pieces for good)`);
  return codes.slice(0, n);
}

/** An allotment of `want` (sku_code → pieces) to store-01, picked, packed in one sealed carton and sent: IN_TRANSIT at the shop. */
export async function sendDelivery(want: Record<string, number>, note = `e2e ${Date.now().toString(36)}`): Promise<{ shipment: string; deliveryId: string; note: string }> {
  const rina = as('cloud', 'rina');
  const nina = as('dc', 'nina');
  const yusuf = as('dc', 'yusuf');
  const avail = dcRows(await rina.get('/api/v1/inventory/availability?limit=500'));
  const sku = (code: string) => {
    const r = avail.find((a) => a.sku_code === code);
    if (!r) throw new Error(`SKU ${code} is not in the centre's availability`);
    return r.sku_id as string;
  };
  await waitFor('DC stock at head office', async () => {
    const now = dcRows(await rina.get('/api/v1/inventory/availability?limit=500'));
    return Object.entries(want).every(([code, q]) => (now.find((a) => a.sku_code === code)?.on_hand_qty ?? 0) >= q);
  }, 60_000, 2_000);
  const made = await rina.post('/api/v1/inventory/allotments', {
    type: 'TO_STORE',
    lines: Object.entries(want).map(([code, quantity]) => ({
      source_site_id: 'dc', source_pool_id: 'dc.warehouse', destination_type: 'STORE', destination_id: 'store-01', sku_id: sku(code), quantity,
    })),
    notes: note,
    actor_id: 'rina',
    idempotency_key: uid(),
  });
  // The allotment reaches the DC as a command.
  await waitFor('the allotment at the DC', async () => {
    await nudge('cloud', 'dc');
    const lines = dcRows(await nina.get('/api/v1/dc/picklist'));
    return Object.entries(want).every(([code, q]) => (lines.find((l) => l.sku_code === code)?.outstanding ?? 0) >= q);
  }, 120_000, 3_000);
  const lines = Object.entries(want).map(([sku_code, quantity]) => ({ sku_code, quantity }));
  await nina.post('/api/v1/dc/picklists', { source_pool_id: 'dc.warehouse', lines, actor_id: 'nina', note, idempotency_key: uid() });
  const manifest = await nina.post('/api/v1/dc/packs', { destination_store_id: 'store-01', lines, actor_id: 'nina', idempotency_key: uid(), seal: true });
  const koli = manifest.koli.koli_id as string;
  const shipment = await yusuf.post('/api/v1/dc/shipments', { koli_ids: [koli], actor_id: 'yusuf' });
  await yusuf.post(`/api/v1/dc/koli/${koli}/shipment`, { shipment_reference: shipment.shipment_number, actor_id: 'yusuf', idempotency_key: uid() });
  const truck = await yusuf.post('/api/v1/dc/dispatches', { shipment_ids: [shipment.shipment_id], carrier: 'Armada DC', vehicle_plate: 'B 9123 KXA', driver_name: 'Pak Joko', actor_id: 'yusuf' });
  await yusuf.post(`/api/v1/dc/koli/${koli}/dispatch`, { actor_id: 'yusuf', idempotency_key: uid() });
  await yusuf.post(`/api/v1/dc/dispatches/${truck.dispatch_id}/depart`, {});
  await yusuf.post(`/api/v1/dc/koli/${koli}/in-transit`, { actor_id: 'yusuf', idempotency_key: uid() });
  void made;
  const inbound = await waitFor(`${shipment.shipment_number} in transit at the shop`, async () => {
    await nudge('dc', 'cloud', 'store');
    const list = await maya().get('/api/v1/store/inbound?status=IN_TRANSIT');
    return (list.deliveries as Json[]).find((d) => d.shipment_reference === shipment.shipment_number);
  }, 180_000, 3_000);
  return { shipment: shipment.shipment_number as string, deliveryId: inbound.delivery_id as string, note };
}

/** Head office asks store-01 to send one piece of `skuCode` back to the DC (RETURN_TO_WAREHOUSE, from the floor). A shop never starts a return. */
export async function askReturn(skuCode: string): Promise<{ id: string; number: string }> {
  const rina = as('cloud', 'rina');
  const avail = rows(await rina.get('/api/v1/inventory/availability?limit=500'));
  const sku = avail.find((a) => a.sku_code === skuCode);
  if (!sku) throw new Error(`SKU ${skuCode} unknown at head office`);
  const made = await rina.post('/api/v1/inventory/allotments', {
    type: 'RETURN_TO_WAREHOUSE',
    lines: [{ source_site_id: 'store-01', source_pool_id: 'store-01.floor', destination_type: 'WAREHOUSE', destination_id: 'dc', sku_id: sku.sku_id, quantity: 1 }],
    notes: `e2e return ${Date.now().toString(36)}`,
    actor_id: 'rina',
    idempotency_key: uid(),
  });
  await waitFor('the return request at the shop', async () => {
    await nudge('cloud', 'store');
    return ((await maya().get('/api/v1/store/return-requests')).items as Json[]).find((a) => a.allotment_id === made.id);
  }, 90_000, 3_000);
  return { id: made.id as string, number: made.allotment_number as string };
}

/** Head office opens a cycle count of a store pool (the shop only submits what its handheld swept). */
export async function askCount(pool = 'store-01.warehouse'): Promise<{ id: string; reason: string }> {
  const rina = as('cloud', 'rina');
  const reason = `e2e opname ${Date.now().toString(36)}`;
  const count = await rina.post('/api/v1/inventory/counts', { site_id: 'store-01', pool_id: pool, kind: 'CYCLE', reason, actor_id: 'rina', idempotency_key: uid() });
  await rina.post(`/api/v1/inventory/counts/${count.id}/activate`, { actor_id: 'rina', idempotency_key: uid() });
  await waitFor('the count at the shop', async () => {
    await nudge('cloud', 'store');
    return ((await maya().get('/api/v1/store/counts')).items as Json[]).find((c) => c.count_id === count.id);
  }, 90_000, 3_000);
  return { id: count.id as string, reason };
}
