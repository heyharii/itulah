// Stores / Setup / System / GA helpers: the 16 stores and what a new one needs,
// plus small GA records made through the routes the screens use. Everything a
// test creates carries its run-unique `tag()` in a name, so a test only ever
// reads its own rows.
import { RIG, type Person } from './base.ts';
import { Api, ApiError, as, rows, tag } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Generous: the rig is shared by ten suites and the hub reads it live. */
export const SLOW = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A client that waits out the rig's cloud being restarted under it (ten suites
 * share it): a refused connection or a 502/503 is retried, an answer is not.
 */
class Steady extends Api {
  async call(method: string, path: string, body?: Json, opts?: { ok?: boolean }): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await super.call(method, path, body, opts);
      } catch (error) {
        const text = String(error);
        const transient = /fetch failed|ECONNREFUSED|ECONNRESET| → 50[234]/.test(text);
        if (!transient || attempt >= 8) throw error;
        await sleep(10_000);
      }
    }
  }
}

export const steady = (node: 'cloud' | 'dc' | 'store', who: Person) => new Steady(node, who);
export const admin = () => steady('cloud', 'admin');
export const rina = () => steady('cloud', 'rina');

export interface StoreRow {
  unit_id: string;
  code: string;
  name: string;
  status: string;
  site_id: string | null;
  city: string | null;
  readiness: { done: number; total: number };
  server: { state: string; last_seen_at: string | null; enrolment_id: string | null };
  tills: { active: number; online: number; waiting: number; seats: number };
}

/** GET /api/v1/stores — what the Stores list draws. */
export async function storeList(): Promise<{ items: StoreRow[]; can_manage: boolean }> {
  return admin().get('/api/v1/stores');
}

export async function storeDetailOf(unit: string): Promise<Json> {
  return admin().get(`/api/v1/stores/${encodeURIComponent(unit)}`);
}

/**
 * A store of this run's own: unit + shop site + pools, a manager invitation.
 * It stays GETTING_READY (its server is never installed), so changing it
 * touches none of the 16 stores other suites use.
 */
export async function openTestStore(t: string, city = 'Bandung'): Promise<{ unit: StoreRow; created: Json }> {
  const name = `Uji ${t}`;
  const created = await admin().post('/api/v1/setup/stores', { stores: [{ name, city, manager: { name: `Manajer ${t}` } }] });
  const unit = (await storeList()).items.find((s) => s.name === name);
  if (!unit) throw new Error(`store ${name} not in the list after opening`);
  return { unit, created };
}

let sharedStore: Promise<StoreRow> | undefined;
/**
 * The one getting-ready store every read-mostly branch uses, made once and found
 * again on later runs by its name, so the rig does not grow a store per test.
 */
export function sharedTestStore(): Promise<StoreRow> {
  return (sharedStore ??= (async () => {
    const name = 'Uji Bersama E2E';
    const found = (await storeList()).items.find((s) => s.name === name);
    return found ?? (await openTestStore('Bersama E2E')).unit;
  })());
}

/** A site to hang GA records on that no other suite looks at. */
export const GA_SITE = 'store-c016';

export async function registerAsset(t: string, over: Json = {}): Promise<Json> {
  return admin().post('/api/v1/ga/assets', {
    asset_number: `AST-${t}`,
    name: `Rak Uji ${t}`,
    class_code: 'OE_RAK_1',
    site_id: GA_SITE,
    sub_location: null,
    holder: null,
    condition: 'BAIK',
    serial_number: null,
    acquired_on: '2026-01-10',
    specs: { material: 'Besi', dim: '120x180', area: 'Depan', repl: 'ya' },
    notes: null,
    quantity: null,
    ...over,
  });
}

export async function requestSupply(t: string, over: Json = {}): Promise<Json> {
  return admin().post('/api/v1/ga/supplies', {
    site_id: GA_SITE,
    requested_by: 'Rina',
    category_code: 'ATK',
    item: `Kertas Uji ${t}`,
    quantity: '3 rim',
    needed_by: '2026-10-20',
    estimated_cost_minor: 150_000,
    ...over,
  });
}

export { as, ApiError, rows, tag };

/** A vendor in the EXPENSE book (repairs and tasks are assigned to one). */
export async function expenseVendor(t: string): Promise<Json> {
  return rina().post('/api/v1/suppliers', {
    supplier_code: `GA${t}`,
    name: `Bengkel Uji ${t}`,
    contact_name: 'Pak Uji',
    phone: '0812-0000-0000',
    email: null,
    address: 'Jl. Uji 1',
    status: 'ACTIVE',
    category: 'EXPENSE',
    expense_account_code: '6041',
  });
}

export async function recordRepair(t: string, vendorId: string, assetId: string | null = null, over: Json = {}, by: Api = admin()): Promise<Json> {
  return by.post('/api/v1/ga/repairs', {
    site_id: GA_SITE,
    asset_id: assetId,
    objek: assetId ? null : 'BANGUNAN',
    title: `Bocor Uji ${t}`,
    supplier_id: vendorId,
    contract_id: null,
    task_id: null,
    inspection_id: null,
    estimated_cost_minor: 500_000,
    failure_at: '2026-10-08',
    notes: null,
    ...over,
  });
}

/** `{ timeout: SLOW }` for the assertions that wait on the hub reading the rig. */
export const T = { timeout: SLOW };

/**
 * The hub's own Select is not a native <select>: a trigger (role combobox on a
 * desk) and a popup of role=option rows. Open it by its label, take the row.
 */
/**
 * Field labels carry "(required)" and a hint after the name ("Item name (required)",
 * "Area building · floor · area"): match the label's start, as a whole word.
 */
export const L = (label: string): RegExp => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`);

export async function choose(
  screen: { getByLabel: (t: string | RegExp) => { tap(): Promise<void> }; getByRole: (r: string, n?: string | RegExp) => { tap(): Promise<void> } },
  label: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  await screen.getByLabel(typeof label === 'string' ? L(label) : label).tap();
  await screen.getByRole('option', option).tap();
}

/** The n-th row (0 = the placeholder "Select…") of a Select opened by its label. */
export async function chooseNth(
  screen: { getByLabel: (t: string | RegExp) => { tap(): Promise<void> }; getByRole: (r: string, n?: string | RegExp) => { nth(i: number): { tap(): Promise<void> } } },
  label: string | RegExp,
  n: number,
): Promise<void> {
  await screen.getByLabel(typeof label === 'string' ? L(label) : label).tap();
  await screen.getByRole('option').nth(n).tap();
}

/**
 * What a store's back-office PC does: take the install code the Install server
 * button issued and claim it with a key of its own. The store then waits for
 * head office to read the verification number and approve or reject.
 */
export async function installAndClaim(unit: string, t: string): Promise<{ code: string; answer: Json; hostname: string }> {
  const install = await admin().post(`/api/v1/stores/${unit}/server/install`, {});
  const hostname = `e2e-box-${t.toLowerCase()}`;
  const res = await fetch(`${RIG.cloud}/api/v1/sync/enroll/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: install.code,
      key_sha256: [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join(''),
      machine: { hostname, os: 'Windows 11', arch: 'x86_64', version: '0.1.4' },
    }),
  });
  const answer = await res.json();
  if (!res.ok) throw new Error(`claim ${install.code} → ${res.status} ${JSON.stringify(answer)}`);
  return { code: install.code as string, answer, hostname };
}

/**
 * Put a store's server back to "not installed": revoke the code or the claim an
 * earlier run left on it. The shared test store lives across runs.
 */
export async function resetServer(unit: string): Promise<void> {
  const detail = await storeDetailOf(unit);
  const id = detail.store.server.enrolment_id as string | null;
  if (detail.store.server.state !== 'NOT_INSTALLED' && id) {
    await admin().call('POST', `/api/v1/sync/enrollments/${id}/refuse`, {}, { ok: false });
  }
}
