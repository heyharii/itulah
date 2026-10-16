// Finance (hub › Finance) helpers: documents built through the cloud API so a
// test can drive the screen on something it owns, and readers that prove the
// books afterwards (journal lines balance, balances move by exactly the amount).
//
// Isolation on the shared rig: other suites keep posting to the BCA bank (1005),
// the drawer (1002) and supplier 0001, so everything here money-wise runs on
//   * the DANAMON giro bank  (`bank_giro` / DANAMON → account 1009, nobody else's), and
//   * a supplier created for the run (its payable sub-ledger moves only by us).
import { expect } from 'e2e';
import { as, tag, uid, type Api } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const cloud = (): Api => as('cloud', 'rina');
export const BANK = { key: 'bank_giro', qualifier: 'DANAMON', account: '1009', label: 'Danamon' } as const;
export const UNIT = 'ho';

/** "Rp 1.234.567" / "−Rp 5.000" → number (null for "—"). */
export function rp(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (digits === '') return null;
  return (/[−-]/.test(text.split(/\d/)[0] ?? '') ? -1 : 1) * Number(digits);
}

/** The way the hub writes a rupiah amount: "Rp 1.250.000". */
export const money = (n: number) => (n < 0 ? '−' : '') + 'Rp ' + Math.abs(n).toLocaleString('id-ID');

/** The hub runs on Asia/Jakarta time (hub.config.ts), a day ahead of UTC from 17:00 UTC; every date a test types or posts uses the same clock as the screens. */
export const dayOf = (offsetDays = 0) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
export const today = () => dayOf(0);

/** The DANAMON bank account described against its ledger account 1009 (idempotent: a second call corrects). */
export async function ensureBank(): Promise<void> {
  await cloud().post('/api/v1/finance/bank-accounts', {
    ledger_account_code: BANK.account,
    unit_id: UNIT,
    bank_code: 'DANAMON',
    bank_name: 'Bank Danamon',
    account_no: '9900112233',
    account_holder: 'PT Itulah Demo',
    branch: 'KCP Uji',
    kind: 'GIRO',
    is_primary: false,
    note: 'Rekening uji e2e finance',
  });
}

// ── suppliers and bills ──────────────────────────────────────────────────────

/**
 * A supplier of our own for one purpose ("bkk", "bills", …), found by its name or created once and then reused by every run,
 * so the shared supplier master does not fill up with test suppliers. Its payable moves only by what a test posts:
 * assert deltas (`owed`, ledger closing), never absolutes.
 */
export async function makeSupplier(kind: string): Promise<{ id: string; code: string; name: string }> {
  const name = `Finance e2e ${kind}`;
  const found = ((await cloud().get(`/api/v1/suppliers?q=${encodeURIComponent(name)}&limit=50`)).rows as Json[]).find((s) => s.name === name);
  if (found) return { id: found.supplier_id, code: found.supplier_code, name: found.name };
  const s = await cloud().post('/api/v1/suppliers', {
    name,
    contact_name: 'Uji Finance',
    phone: null,
    email: null,
    address: 'Jl. Uji',
    status: 'ACTIVE',
    category: 'MERCHANDISE',
    legal_form: 'PT',
  });
  return { id: s.supplier_id, code: s.supplier_code, name: s.name };
}

/** Choose a supplier in a picker: open it, type the name, take the option (typing before the list is open does not filter). */
export async function pickSupplier(screen: Screen, name: string, combo: RegExp = /^Supplier/) {
  await screen.getByRole('combobox', { name: combo }).tap();
  const open = screen.getByRole('combobox', { expanded: true }); // an open picker is renamed "Dismiss"
  await open.fill(name);
  await screen.getByRole('option', { name: new RegExp(name) }).first().tap();
}

/** A merchandise bill recorded (a DRAFT); `post: true` also puts it in the books. */
export async function recordBill(
  supplier: { code: string; name: string },
  amount: number,
  { invoice = `INV-Z${tag('F')}`, post = false, tax = 0, discount = 0, note = 'Uji finance', receiptIds }: { invoice?: string; post?: boolean; tax?: number; discount?: number; note?: string; receiptIds?: string[] } = {},
): Promise<Json> {
  const bill = await cloud().post('/api/v1/finance/bills', {
    invoice_number: invoice,
    supplier_id: supplier.code,
    supplier_name: supplier.name,
    site_id: 'dc',
    invoice_date: today(),
    due_date: dayOf(14),
    subtotal_minor: amount,
    tax_minor: tax,
    discount_minor: discount,
    note,
    kind: 'MERCHANDISE',
    ...(receiptIds ? { receipt_ids: receiptIds } : {}),
  });
  return post ? cloud().post(`/api/v1/finance/bills/${bill.invoice_id}/post`, {}) : bill;
}

export const bill = (id: string): Promise<Json> => cloud().get(`/api/v1/finance/bills/${id}`);

// ── the books ────────────────────────────────────────────────────────────────

export interface Line {
  account_code: string;
  unit_id: string;
  debit_minor: number;
  credit_minor: number;
  party_id?: string | null;
  category_code?: string | null;
  memo?: string | null;
}

export async function entry(entryId: string): Promise<{ entry: Json; lines: Line[] }> {
  return cloud().get(`/api/v1/finance/journal/${entryId}`);
}

export const sum = (lines: Line[], side: 'debit_minor' | 'credit_minor') => lines.reduce((s, l) => s + (l[side] ?? 0), 0);

/** Debit = credit, and non-zero: the one invariant every posting keeps. */
export function expectBalanced(lines: Line[]) {
  expect(lines.length, 'an entry has at least two lines').toBeGreaterThanOrEqual(2);
  expect(sum(lines, 'debit_minor'), 'debits equal credits').toBe(sum(lines, 'credit_minor'));
  expect(sum(lines, 'debit_minor')).toBeGreaterThan(0);
}

/** An account's net (debit − credit) in one unit, from the trial balance. */
export async function balance(account: string, unit = UNIT): Promise<number> {
  const tb = await cloud().get(`/api/v1/finance/trial-balance?unit=${unit}&q=${account}&as_of=2099-12-31&limit=200`);
  return (tb.rows as Json[])
    .filter((r) => r.account_code === account && r.unit_id === unit)
    .reduce((s, r) => s + r.debit_minor - r.credit_minor, 0);
}

/** One supplier's open payable, from the bills that are posted. */
export async function owed(supplierCode: string): Promise<number> {
  const page = await cloud().get(`/api/v1/finance/bills?supplier=${encodeURIComponent(supplierCode)}&limit=200`);
  return (page.rows as Json[]).filter((b) => b.status === 'POSTED').reduce((s, b) => s + b.outstanding_minor, 0);
}

// ── cash documents (BKK / BKM) ───────────────────────────────────────────────

export interface VoucherOpts {
  direction: 'OUT' | 'IN';
  lines: Json[];
  party?: string;
  supplierCode?: string | null;
  memo?: string;
  reference?: string;
  method?: 'CASH' | 'TRANSFER' | 'GIRO';
  date?: string;
  giro?: { number: string; due: string; bank?: string };
}

/** The voucher request body (what the form sends) on the DANAMON bank. */
export function voucherBody(o: VoucherOpts): Json {
  return {
    doc_date: o.date ?? today(),
    direction: o.direction,
    money: { semantic_key: BANK.key, qualifier: BANK.qualifier, account_code: null, category_code: null, unit_id: UNIT },
    method: o.method ?? 'TRANSFER',
    reference: o.reference ?? null,
    giro_number: o.giro?.number ?? null,
    giro_due_date: o.giro?.due ?? null,
    giro_bank: o.giro?.bank ?? null,
    party_type: o.supplierCode ? 'SUPPLIER' : 'OTHER',
    supplier_id: o.supplierCode ?? null,
    employee_id: null,
    party_name: o.party ?? 'Uji Finance',
    memo: o.memo ?? 'Uji finance',
    lines: o.lines,
  };
}

/** Key a voucher (a DRAFT) on the DANAMON bank, the way the form does. */
export const voucher = (o: VoucherOpts): Promise<Json> => cloud().post('/api/v1/finance/cash-documents/voucher', voucherBody(o));

/** An "Other line" naming a ledger account directly. */
export const otherLine = (account: string, amount: number, note = 'Uji', category: string | null = null) => ({
  kind: 'OTHER',
  account: { semantic_key: null, qualifier: '', account_code: account, category_code: category, unit_id: UNIT },
  amount_minor: amount,
  note,
});

export const settleLine = (invoiceId: string, amount: number, discount = 0) => ({ kind: 'SETTLE', invoice_id: invoiceId, amount_minor: amount, discount_minor: discount });

export const approveDoc = (id: string): Promise<Json> => cloud().post(`/api/v1/finance/cash-documents/${id}/approve`, {});
export const postDoc = (id: string, date?: string): Promise<Json> => cloud().post(`/api/v1/finance/cash-documents/${id}/post`, { posting_date: date });
export const cashDoc = (id: string): Promise<Json> => cloud().get(`/api/v1/finance/cash-documents/${id}`);

// ── journals ─────────────────────────────────────────────────────────────────

/** A manual two-line entry between two accounts of one unit. */
export async function manualEntry(debit: string, credit: string, amount: number, memo: string, date = today()): Promise<Json> {
  return cloud().call('POST', '/api/v1/finance/journal', {
    posting_date: date,
    currency: 'IDR',
    memo,
    lines: [
      { account: { kind: 'account', account_code: debit }, unit_id: UNIT, debit_minor: amount, credit_minor: 0, memo },
      { account: { kind: 'account', account_code: credit }, unit_id: UNIT, debit_minor: 0, credit_minor: amount, memo },
    ],
  }, { ok: false });
}

// ── UI helpers ───────────────────────────────────────────────────────────────

type Screen = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Wait for the page's main heading (the PageHeader title, an h1). */
export async function onScreen(screen: Screen, title: string, timeout = 45_000) {
  await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout });
}

export { tag, uid };

// ── credit notes ─────────────────────────────────────────────────────────────

export const creditNote = (invoiceId: string, amount: number, o: { reason?: string; their?: string; note?: string } = {}): Promise<Json> =>
  cloud().post('/api/v1/finance/credit-notes', {
    invoice_id: invoiceId,
    credit_date: today(),
    reason: o.reason ?? 'RETURN',
    subtotal_minor: amount,
    tax_minor: 0,
    ...(o.their ? { their_number: o.their } : {}),
    ...(o.note ? { note: o.note } : {}),
  });
export const postCreditNote = (id: string): Promise<Json> => cloud().post(`/api/v1/finance/credit-notes/${id}/post`, {});

// ── bank statements ──────────────────────────────────────────────────────────

/** A statement of the DANAMON account; debit = money out, credit = money in (as the bank reports). */
export async function importStatement(lines: { date: string; description: string; reference?: string; debit?: number; credit?: number }[], o: { opening?: number; closing?: number } = {}): Promise<Json> {
  const opening = o.opening ?? 0;
  const closing = o.closing ?? opening + lines.reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0);
  const dates = lines.map((l) => l.date).sort();
  return cloud().post('/api/v1/finance/bank-statements', {
    account_code: BANK.account,
    unit_id: UNIT,
    period_start: dates[0],
    period_end: dates[dates.length - 1],
    opening_minor: opening,
    closing_minor: closing,
    source_name: 'e2e',
    lines: lines.map((l) => ({ value_date: l.date, description: l.description, reference: l.reference ?? null, debit_minor: l.debit ?? 0, credit_minor: l.credit ?? 0 })),
  });
}

/** Open a select/combobox by its label and choose an option. */
export async function pick(screen: Screen, combo: RegExp | string, option: RegExp | string) {
  await screen.getByRole('combobox', typeof combo === 'string' ? combo : { name: combo }).tap();
  await screen.getByRole('option', typeof option === 'string' ? option : { name: option }).tap();
}

/** The register row holding `text`. */
export const rowOf = (screen: Screen, text: string) => screen.getByRole('row').filter({ hasText: text });

/** A random whole-rupiah amount, so two runs never share a figure (multiples of 1.000). */
export const amountOf = (min = 100, spread = 800) => (min + Math.floor(Math.random() * spread)) * 1000;

/** Open a Day control by its trigger's name and type a day ("besok", "15/10") into its box. */
export async function pickDay(screen: Screen, trigger: RegExp | string, phrase: string) {
  await screen.getByRole('button', typeof trigger === 'string' ? trigger : { name: trigger }).tap();
  const box = screen.getByRole('textbox', { name: /^Type / });
  const [, mm, dd] = dayOf(0).split('-');
  await box.fill(phrase === 'hari ini' ? `${dd}/${mm}` : phrase); // the day box reads "besok", "15/10"…
  const take = screen.getByRole('button', 'Take this day'); // a phone's day sheet has a button of its own; Enter takes the day on a desk
  try {
    await take.tap({ timeout: 2_500 });
    await new Promise((r) => setTimeout(r, 2_000)); // the phone's sheet slides away; a tap while it does goes to its veil
  } catch {
    await box.press('Enter');
  }
}

/** A journal-template line (the PostingLine the server keeps), on one ledger account of HO. */
export const templateLine = (account: string, debit: number, credit: number, memo = 'rutin') => ({
  account: { kind: 'account', account_code: account },
  unit_id: UNIT,
  debit_minor: debit,
  credit_minor: credit,
  memo,
});

export const makeTemplate = (name: string, memo: string, lines: Json[]): Promise<Json> =>
  cloud().post('/api/v1/finance/journal-templates', { template_id: null, name, memo, lines, is_active: true });

export const scheduleTemplate = (templateId: string, next = today(), autoPost = true): Promise<Json> =>
  cloud().post('/api/v1/finance/journal-repeats', { repeat_id: null, template_id: templateId, frequency: 'MONTHLY', next_date: next, end_date: null, auto_post: autoPost, is_active: true });

/** A supplier bill paid by a posted giro BKK on the Danamon bank; `dueInDays` can be negative (a giro already past its date). */
export async function paidByGiro(prefix: string, amount: number, dueInDays: number) {
  await ensureBank();
  const t = tag(prefix);
  const supplier = await makeSupplier('giro');
  const b = await recordBill(supplier, amount, { post: true });
  // a past due date needs an earlier document date in the same open month
  const docDate = dueInDays < 0 ? dayOf(Math.min(dueInDays, -1)) : today();
  const giroNo = `BG${t}`;
  const d = await voucher({ direction: 'OUT', supplierCode: supplier.code, party: supplier.name, method: 'GIRO', giro: { number: giroNo, due: dayOf(dueInDays) }, lines: [settleLine(b.invoice_id, amount)], date: docDate });
  await approveDoc(d.document_id);
  await postDoc(d.document_id);
  const giro = ((await cloud().get('/api/v1/finance/giros?limit=500')) as Json[]).find((g) => g.number === giroNo);
  return { t, supplier, bill: b, giroNo, doc: d, giro };
}

/** The first table's column headers are all there (a screen may carry a second table below it). */
export async function expectHeads(screen: Screen, heads: string[], timeout = 45_000) {
  const table = screen.getByRole('table').first();
  for (const h of heads) await expect(table.getByRole('columnheader', h)).toBeVisible({ timeout });
}

/** A fresh supplier item on supplier 0001 for one delivery (the shared `makeItem` re-reads a list capped at 200 and misses new items once 0001 has many). */
export async function deliveryItem(t: string, price = 40_000): Promise<{ supplier: Json; item: Json }> {
  const supplier = ((await cloud().get('/api/v1/suppliers?q=0001&limit=5')).rows as Json[]).find((s) => s.supplier_code === '0001');
  const item = await cloud().post(`/api/v1/suppliers/${supplier.supplier_id}/items`, {
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
  return { supplier, item };
}

/** Open a screen and wait for its title; one reload if the dev server served a blank page. */
export async function openScreen(app: any, screen: Screen, path: string, title: string) {
  await app.open(path);
  try {
    await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 40_000 });
  } catch {
    await app.open(path);
    await expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  }
}


/** Every unbilled delivery, paged (the plain list answers only the oldest 200). */
export async function unbilledAll(): Promise<{ rows: Json[]; total: number; total_minor: number }> {
  const rows: Json[] = [];
  let cursor: string | null = null;
  let total = 0;
  let total_minor = 0;
  do {
    const page: Json = await cloud().get(`/api/v1/finance/unbilled?paged=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    rows.push(...page.rows);
    total = page.total;
    total_minor = page.total_minor;
    cursor = page.next_cursor;
  } while (cursor);
  return { rows, total, total_minor };
}

/**
 * Press a button with the keyboard. On a touch-emulated phone a tap on the small inline form buttons of the Giro Board (Bounce, Clear Rp N,
 * Undo clearing) sends no request while Enter on the focused button does — the form tests drive them this way.
 */
export async function activate(button: any) {
  await button.focus();
  await button.press('Enter');
}
