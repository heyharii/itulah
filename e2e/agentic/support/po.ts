// PO / Receiving / Return PO helpers (domain-local; shared API helpers live in rig.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'e2e';

type Evaluator = { evaluate: (fn: any, arg?: any) => Promise<any> };

/** Debug aid: write the visible text + interactive elements (role/name) of the page to .e2e/out/po/dumps/<name>.txt. */
export async function dump(browser: Evaluator, name: string) {
  const text: string = await browser.evaluate(() => {
    const out: string[] = [];
    out.push('URL ' + location.href);
    out.push('--- innerText ---');
    out.push(document.body.innerText.slice(0, 6000));
    out.push('--- interactive ---');
    const sel = 'button, a, [role], input, textarea, select, [aria-label]';
    document.querySelectorAll(sel).forEach((el) => {
      const e = el as HTMLElement;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const role = e.getAttribute('role') || e.tagName.toLowerCase();
      const name = e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0, 60) || (e as HTMLInputElement).placeholder || '';
      out.push(`${role} | ${name.replace(/\n/g, ' / ')}${(e as HTMLButtonElement).disabled ? ' [disabled]' : ''}`);
    });
    return out.join('\n');
  });
  mkdirSync('.e2e/out/po/dumps', { recursive: true });
  writeFileSync(`.e2e/out/po/dumps/${name}.txt`, text);
}

// ── hub UI drivers ──────────────────────────────────────────────────────────
import type { ItemCtx } from './rig.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Screen = any;
type App = any;

export const money = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

/** Open the New PO composer and wait for it. */
export async function openComposer(app: App, screen: Screen) {
  await app.open('/procurement/orders?new-order=true');
  await expectVisible(screen.getByText('Choose a supplier, then add what is being ordered.'), 60_000);
}

async function expectVisible(locator: any, timeout = 15_000) {
  await expect(locator).toBeVisible({ timeout });
}

export async function pickSupplier(screen: Screen, name = 'Garmen Nusantara, PT') {
  await screen.getByRole('combobox', 'Supplier').fill(name.split(',')[0]!);
  await screen.getByRole('option', name).tap();
}

/** Type a day into the Delivery Date calendar ("besok" = tomorrow, "15/10", …). */
export async function pickDay(screen: Screen, phrase = 'besok') {
  await screen.getByRole('dialog', 'New PO').getByRole('button', 'Delivery Date').tap();
  await screen.getByRole('textbox', 'Type Delivery Date').fill(phrase);
  await screen.getByRole('textbox', 'Type Delivery Date').press('Enter');
}

export async function pickMethod(screen: Screen, method: 'Giro' | 'Transfer' | 'Cash' = 'Transfer') {
  await screen.getByRole('combobox', 'Payment method').tap();
  await screen.getByRole('option', method).tap();
}

/** Supplier, delivery date and payment method — the three header answers. */
export async function fillHeader(screen: Screen, opts: { supplier?: string; day?: string; method?: 'Giro' | 'Transfer' | 'Cash' } = {}) {
  await pickSupplier(screen, opts.supplier);
  await pickDay(screen, opts.day);
  await pickMethod(screen, opts.method);
}

/** Fill the Add item sheet (it must be open) for a brand-new line. */
export async function fillItem(screen: Screen, o: { name: string; qty: string; price: string; division?: string; tag?: string }) {
  await screen.getByRole('textbox', { name: /^Name/ }).fill(o.name);
  await screen.getByRole('combobox', 'Division').fill(o.division ?? 'Pria');
  await screen.getByRole('option').first().tap();
  await screen.getByRole('combobox', 'Tags').fill(o.tag ?? 'Kaos');
  await screen.getByRole('option', o.tag ?? 'Kaos').tap();
  await screen.getByRole('combobox', 'Tags').press('Escape');
  await screen.getByRole('textbox', 'Quantity to order').fill(o.qty);
  await screen.getByRole('textbox', 'Price').fill(o.price);
}

export type { ItemCtx };

// ── API scenarios (arrange steps) ────────────────────────────────────────────
import { as, countLine, dcLine, openReceipt, placePo, poDetail, rows, tag, uid, waitFor, nudge, supplier0001 } from './rig.ts';

/**
 * rig.ts makeItem re-reads the supplier's first 200 items to find the new one; the rig now holds
 * more than that, so the item comes from the POST's own answer here.
 */
export async function makeItemFast(t: string, { price = 40_000 } = {}): Promise<ItemCtx> {
  const cloud = as('cloud', 'rina');
  const supplier = await supplier0001();
  if (!supplier) throw new Error('supplier 0001 missing');
  const item = await cloud.post(`/api/v1/suppliers/${supplier.supplier_id}/items`, {
    supplier_item_code: `${t}-KAO`, name: `Kaos Uji ${t}`, unit_price_minor: price, currency: 'IDR', status: 'ACTIVE',
    division_code: 'PRIA', tags: ['KAOS'], colour_codes: ['BLACK', 'WHITE'], size_codes: ['03', '04'],
  });
  return { supplier, item };
}

/** A fresh PO (supplier 0001, own item) of `qty` pieces. */
export async function newPo(qty = 8, opts: { price?: number; notes?: string } = {}) {
  const t = tag();
  const ctx = await makeItemFast(t, { price: opts.price });
  const po = await placePo(ctx, qty, { notes: opts.notes ?? `Uji e2e ${t}` });
  return { t, ctx, po };
}

/** The DC counts the PO's first line in one go. Returns ids. */
export async function countPo(ctx: ItemCtx, po: string, counted: number, wrong = 0) {
  const line = await dcLine(po);
  const receipt = await openReceipt(ctx);
  const count = await countLine(receipt.receipt_id, line.po_line_id, counted, { wrong });
  return { line, receipt, count };
}

/** Review decision as the buyer. Uses the field the backend reads (invoiced_price_minor). */
export async function review(countId: string, decision: 'Accept' | 'Recount', price = 40_000, note?: string) {
  return as('dc', 'rina').call(
    'POST',
    '/api/v1/dc/purchase-verifications',
    { count_id: countId, verifier_actor_id: 'rina', decision, invoiced_price_minor: price, idempotency_key: uid(), ...(note ? { note } : {}) },
    { ok: false },
  );
}

/** Wait until the PO shows `n` pieces received at head office. */
export const waitReceived = (po: string, n: number) =>
  waitFor(`${po} received ${n}`, async () => {
    await nudge('dc', 'cloud');
    const { poNumbers } = await import('./rig.ts');
    return (await poNumbers(po)).received_stock_units === n ? true : null;
  }, 90_000, 2_000);

/** A row of the PO list by PO number. */
export const poRow = (screen: Screen, po: string) => screen.getByRole('row', { name: new RegExp(po) });

export { poDetail, rows };

/** Open a PO's sheet by deep link and wait for it. */
export async function openSheet(app: App, screen: Screen, po: string) {
  const d = await poDetail(po);
  await app.open(`/procurement/orders?order=${d.purchase_order_id}`);
  // The sheet's title is the supplier (the PO number stands on the line under it since 11 Oct), so the
  // dialog is found by the supplier and then checked to be THIS order's.
  const sheet = screen.getByRole('dialog', /Garmen Nusantara/);
  await expect(sheet).toBeVisible({ timeout: 45_000 });
  await expect(sheet).toContainText(po, { timeout: 30_000 });
  await expect(screen.getByText('Items (1)')).toBeVisible({ timeout: 30_000 });
  return sheet;
}

// ── Ops › Receiving (nina) ───────────────────────────────────────────────────
/** Open the Receiving list, find the PO and open its blind-count sheet. */
export async function openCount(app: App, screen: Screen, po: string) {
  await app.open('/operations/intake');
  const row = screen.getByRole('row', { name: new RegExp(po) });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.tap();
  await expect(screen.getByRole('button', 'Submit count')).toBeVisible({ timeout: 30_000 });
}

/** Type a count (in the line's current unit) for a supplier-item code. */
export async function typeCount(screen: Screen, code: string, qty: string, unit = 'PCS') {
  await screen.getByLabel(`Counted ${unit} of ${code}`).fill(qty);
}

/** The DC's count rows for a PO. */
export async function dcCounts(po: string) {
  return rows(await as('dc', 'nina').get('/api/v1/dc/purchase-counts')).filter((c) => c.po_number === po);
}

// ── multi-line POs ───────────────────────────────────────────────────────────

/** A PO with one line per quantity (each its own item; quantities multiple of 4). */
export async function newMultiPo(qtys: number[]) {
  const t = tag();
  const items: ItemCtx[] = [];
  for (let i = 0; i < qtys.length; i++) items.push(await makeItemFast(`${t}${i}`));
  const promised = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const receipt = await as('cloud', 'rina').post('/api/v1/purchase-orders/catalog', {
    po_number: null,
    supplier_id: items[0]!.supplier.supplier_id,
    destination_site_id: null,
    notes: `Uji multi ${t}`,
    discount_minor: null,
    payment_terms_code: null,
    lines: items.map((ctx, i) => ({
      supplier_item_id: ctx.item.supplier_item_id,
      quantity: qtys[i],
      promised_date: promised,
      unit_price_minor: null,
      article_name: null,
      image_url: null,
      division_code: null,
      tags: null,
      base_price_minor: 99_000,
      markup_bps: null,
      variants: ['BLACK', 'WHITE'].flatMap((c) => ['03', '04'].map((z) => ({ colour_code: c, size_code: z, quantity: qtys[i]! / 4, base_price_minor: null }))),
    })),
  });
  return { t, items, po: receipt.po_number as string };
}

/** Count every line of a multi-line PO (one receipt); `counted[i]` for line i (null = skip). */
export async function countMulti(items: ItemCtx[], po: string, counted: (number | null)[], wrong: number[] = []) {
  const lines = await waitFor(`${po} lines at DC`, async () => {
    await nudge('cloud', 'dc');
    const l = rows(await as('dc', 'nina').get('/api/v1/dc/purchase-orders?limit=500')).filter((x) => x.po_number === po);
    return l.length >= items.length ? l.sort((a, b) => a.line_number - b.line_number) : null;
  }, 90_000, 2_000);
  const receipt = await openReceipt(items[0]!);
  const counts = [];
  for (let i = 0; i < lines.length; i++) {
    if (counted[i] == null) continue;
    counts.push(await countLine(receipt.receipt_id, lines[i].po_line_id, counted[i]!, { wrong: wrong[i] ?? 0 }));
  }
  return { lines, receipt, counts };
}

/** Open the Review Count dialog by deep link. */
export async function openReview(app: App, screen: Screen, po: string) {
  await app.open(`/procurement/orders?verify=${po}`);
  await expect(screen.getByText('Review Count').first()).toBeVisible({ timeout: 60_000 });
  // the dialog opens at once, then signs in to the warehouse and reads the count
  await expect(screen.getByText('Counted', { exact: true }).first()).toBeVisible({ timeout: 120_000 });
}

// ── Return PO ────────────────────────────────────────────────────────────────
/** A PO with excess (`counted` of 8, `wrong` not as ordered) accepted by the buyer through the API; the return is NOT raised yet. */
export async function acceptedWithExcess(counted: number, wrong = 0, qty = 8) {
  const p = await newPo(qty);
  const { count } = await countPo(p.ctx, p.po, counted, wrong);
  await review(count.count_id, 'Accept');
  await waitFor(`${p.po} excess pending`, async () => {
    await nudge('dc', 'cloud');
    const d = rows(await as('cloud', 'rina').get('/api/v1/purchase-orders?limit=500')).find((x) => x.po_number === p.po);
    return d && d.excess_pending_stock_units > 0 ? d : null;
  }, 90_000, 2_000);
  return p;
}

/** Same, with the return already raised. Returns the cloud's return record. */
export async function raisedReturn(counted: number, wrong = 0) {
  const p = await acceptedWithExcess(counted, wrong);
  const { raiseReturn } = await import('./rig.ts');
  const ret = await raiseReturn(p.po);
  await waitFor(`${p.po} return at DC`, async () => { await nudge('cloud', 'dc'); const r = await dcReturns(p.po); return r.length ? r : null; }, 90_000, 2_000);
  return { ...p, ret };
}
import { dcReturns } from './rig.ts';

/** Remember that text matching `re` was ever on screen (receipt popups vanish after 3 s). Call before app.open. */
export async function watchText(browser: any, re: RegExp, key = '__seen') {
  await browser.addInitScript(`(() => { const re = ${re.toString()}; window.${key} = false;
    new MutationObserver(() => { if (!window.${key} && re.test(document.body.innerText)) window.${key} = true; })
      .observe(document, { subtree: true, childList: true, characterData: true }); })()`);
}
export const seen = (browser: any, key = '__seen') => browser.evaluate(`window.${key} === true`);
