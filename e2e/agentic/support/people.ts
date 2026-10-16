// People / HR helpers: build employees and their records through the routes the
// hub uses (the same chain scripts/demo-seed.sh walks), prove numbers again
// through the API. Every employee a test creates is its own — never the seeded
// people (rina, nina, yusuf, maya, dian, admin).
import { PASSWORD, RIG, type Person } from './base.ts';
import { as, tag, type Api } from './rig.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const HR = () => as('cloud', 'rina');
/** A second approver: filing and deciding are different people. */
export const HR2 = () => as('cloud', 'admin');

/** A client for a login the test minted (a new employee's own account). */
export const asUser = (username: string): Api => as('cloud', username as unknown as Person);

/** The hub runs on Jakarta time: its "today" is UTC+7. */
export const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
/** Next Monday .. Friday after `from` (an ISO date), skipping weekends. */
export function nextWeekday(from = today(), skip = 1): string {
  let d = addDays(from, skip);
  while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = addDays(d, 1);
  return d;
}
/** The weekday `skip` weekdays before `from`. */
export function prevWeekday(from = today(), skip = 1): string {
  let d = from;
  for (let i = 0; i < skip; i++) {
    d = addDays(d, -1);
    while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = addDays(d, -1);
  }
  return d;
}
export const thisMonth = () => today().slice(0, 7);

/** A 16-digit NIK that is unique per call. */
export function nik(): string {
  const digits = '32' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return digits.slice(0, 16);
}

export interface Hire {
  id: string;
  code: string;
  name: string;
  t: string;
  unit: string;
  username?: string;
}

export interface HireOpts {
  unit?: string;
  kind?: 'PKWT' | 'PKWTT';
  position?: string;
  grade?: string;
  base?: number;
  joined?: string;
  /** CUTI_TAHUNAN days granted on 1 January (0 = none). */
  leaveDays?: number;
  /** Mint a login: { role: 'CASHIER' | 'SUPERVISOR' | 'ADMIN' ... }. */
  login?: { role: string };
  pay?: boolean;
  identity?: boolean;
  /** End the posting on this day (default: open-ended). */
  postedUntil?: string;
}

/** One complete employee: record, hire day, personal data, contract, posting, pay, payroll identity, leave grant, optional login. */
export async function hire(t = tag('H'), o: HireOpts = {}): Promise<Hire> {
  const hr = HR();
  const unit = o.unit ?? 'store-01';
  const joined = o.joined ?? `${new Date().getUTCFullYear()}-01-05`;
  const code = `${t}-E`;
  const name = `Uji ${t}`;
  const rec = await hr.post('/api/v1/employees', { employee_code: code });
  const id = rec.employee_id as string;
  await hr.post(`/api/v1/employees/${id}/employment`, { transition: 'HIRE', effective_on: joined, reason: 'uji e2e: first day' });
  await hr.post(`/api/v1/employees/${id}/personal-data`, { full_name: name, nik: nik(), birth_date: '1995-05-15', address: `Jl. Uji ${t} No. 1, Bandung` });
  const kind = o.kind ?? 'PKWTT';
  await hr.post(`/api/v1/employees/${id}/contracts`, {
    kind,
    starts_on: joined,
    ends_on: kind === 'PKWT' ? addDays(joined, 360) : null,
    position: o.position ?? 'Staf uji',
    grade: o.grade ?? 'G2',
    reason: 'uji e2e: first contract',
  });
  await hr.post(`/api/v1/employees/${id}/assignments`, { unit_id: unit, valid_from: joined, valid_to: o.postedUntil ?? null, reason: 'uji e2e: posting' });
  if (o.pay !== false) await hr.post(`/api/v1/employees/${id}/pay`, { effective_from: joined, base_minor: o.base ?? 5_000_000, reason: 'uji e2e: agreed pay' });
  if (o.identity) {
    await hr.post(`/api/v1/employees/${id}/payroll-identity`, { field: 'bank_account', bank_name: 'BCA', bank_account: `88${Date.now().toString().slice(-8)}`, bank_holder: name, effective_from: joined, reason: 'uji e2e' });
    await hr.post(`/api/v1/employees/${id}/payroll-identity`, { field: 'ptkp', value: 'TK/0', effective_from: joined, reason: 'uji e2e' });
  }
  const leaveDays = o.leaveDays ?? 12;
  if (leaveDays > 0) {
    const year = new Date().getUTCFullYear();
    await hr.post(`/api/v1/employees/${id}/leave-balances`, { entry_id: `grant-${id}`, leave_type: 'CUTI_TAHUNAN', on: `${year}-01-01`, event: 'ACCRUAL', days: leaveDays, expires_on: `${year + 1}-03-31` });
  }
  let username: string | undefined;
  if (o.login) {
    username = `u${t.toLowerCase()}`;
    await hr.post(`/api/v1/employees/${id}/account/provision`, { username, display_name: name, password: PASSWORD, role: o.login.role, reason: 'uji e2e: login' });
  }
  return { id, code, name, t, unit, username };
}

export const employee = (id: string): Promise<Json> => HR().get(`/api/v1/employees/${id}`);

/** The directory row for an employee (searched by its code). */
export async function directoryRow(code: string): Promise<Json | undefined> {
  const page = await HR().get(`/api/v1/employees?q=${encodeURIComponent(code)}`);
  return (page.rows ?? []).find((r: Json) => r.employee_code === code);
}

// ── time off ─────────────────────────────────────────────────────────────────

export async function fileLeave(empId: string, { type = 'CUTI_TAHUNAN', from, to, reason = 'Uji e2e: keperluan keluarga' }: { type?: string; from: string; to?: string; reason?: string }) {
  return HR().post(`/api/v1/employees/${empId}/leave-requests`, { request_id: `lr_${tag('R')}${Date.now()}`, leave_type: type, from_date: from, to_date: to ?? from, reason });
}
export const leaveBalance = async (empId: string, type = 'CUTI_TAHUNAN') =>
  ((await HR().get(`/api/v1/employees/${empId}/leave-balances`)) as Json[]).find((b) => b.leave_type === type);
export const leaveRequests = (empId: string): Promise<Json[]> => HR().get(`/api/v1/employees/${empId}/leave-requests`);

// ── overtime / claims / benefit / discipline ────────────────────────────────

export const orderOvertime = (empId: string, { on, minutes = 120, reason = 'Uji e2e: stock opname' }: { on: string; minutes?: number; reason?: string }) =>
  HR().post(`/api/v1/employees/${empId}/overtime-orders`, { order_id: `ot_${tag('O')}${Date.now()}`, on_date: on, day_kind: 'WORKING', planned_minutes: minutes, reason });
export const overtimeOrders = (empId: string): Promise<Json[]> => HR().get(`/api/v1/employees/${empId}/overtime-orders`);

export const fileClaim = (empId: string, { amount = 120_000, type = 'TRANSPORT', what = 'Taksi uji', reason = 'Uji e2e: perjalanan dinas' } = {}) =>
  HR().post('/api/v1/expense-claims', { employee_id: empId, lines: [{ type_code: type, description: what, spent_on: today(), claimed_minor: amount }], reason });
export const submitClaim = (claimId: string, reason = 'Uji e2e: selesai dinas') => HR().post(`/api/v1/expense-claims/${claimId}/submission`, { reason });
export const claimOf = async (empId: string, claimId: string) => ((await HR().get(`/api/v1/employees/${empId}/expense-claims`)) as Json[]).find((c) => c.claim_id === claimId);

export const benefit = (empId: string): Promise<Json> => HR().get(`/api/v1/employees/${empId}/benefit`);
export const adjustBenefit = (empIds: string[], action: 'ADD' | 'REMOVE' | 'RESET', amount: number, reason = 'Uji e2e') =>
  HR().call('POST', '/api/v1/benefit/adjustments', { action, amount_minor: amount, employee_ids: empIds, reason }, { ok: false });

/** `on` defaults to yesterday: the server judges "in force" against the UTC date, the hub works on Jakarta's. */
export const issueLetter = (empId: string, { level = 'SP1', months = 6, violation = 'Terlambat berulang', reason = 'Uji e2e', on = addDays(today(), -1) } = {}) =>
  HR().post(`/api/v1/employees/${empId}/warning-letters`, { level, issued_on: on, valid_months: months, violation, reason });
export const lettersOf = async (code: string): Promise<Json[]> => ((await HR().get('/api/v1/warning-letters?all=true')) as Json[]).filter((l) => l.employee_code === code);

export const proposeChange = (empId: string, body: { kind: string; props: Json[]; effective_on: string; reason?: string }) =>
  HR().post(`/api/v1/employees/${empId}/change-proposals`, { reason: 'Uji e2e', ...body });

export const rosterDay = (empId: string, on: string, shift = 'PAGI') =>
  HR().post(`/api/v1/employees/${empId}/roster`, { on_date: on, plan: 'SCHEDULED', shift_id: shift, reason: 'Uji e2e: roster' });

// ── invitations ──────────────────────────────────────────────────────────────

export async function invite(name: string, { role = 'CASHIER', unit = 'store-01', position = 'Kasir uji' } = {}): Promise<Json> {
  const issued = await HR().post('/api/v1/invitations', { people: [{ name, role_code: role, unit_id: unit, position }] });
  return issued.items[0];
}
/** The token is minted by the app; the link is `{origin}/join/{token}`. */
export const tokenOf = (link: string) => link.split('/join/')[1];
export const invitations = async (status: string): Promise<Json[]> => {
  const r = await HR().get(`/api/v1/invitations?status=${status}`);
  return Array.isArray(r) ? r : (r.items ?? []);
};

// ── browser sign-in as a minted login ───────────────────────────────────────

/** Sign in as any login (not only the four saved sessions), by API, so screenshots stay available. */
export async function signInAs(
  browser: { evaluate: (fn: (arg: [string, string]) => Promise<number>, arg: [string, string]) => Promise<number> },
  username: string,
) {
  const status = await browser.evaluate(async ([u, p]) => {
    const res = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username: u, password: p }) });
    return res.status;
  }, [username, PASSWORD]);
  if (status !== 200) throw new Error(`${username} sign-in answered ${status}`);
}

export { RIG, tag };

// ── form controls (the hub draws its own; none is a native element) ─────────

type ScreenLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `<Day>`: open the calendar, type the day into its box, Enter. `iso` is yyyy-mm-dd. */
export async function pickDay(screen: ScreenLike, trigger: string | RegExp, iso: string) {
  await screen.getByRole('button', trigger).tap();
  const box = screen.getByRole('textbox', /^Type /);
  await box.fill(iso);
  await box.press('Enter');
}

/** `<PickOne>`: a searchable combobox; type, then take the option. */
export async function pickOne(screen: ScreenLike, label: string, text: string) {
  const input = screen.getByRole('combobox', label);
  await input.tap();
  await input.fill(text);
  await screen.getByRole('option', { name: text, exact: false }).first().tap();
}

/** `<Select>`: open the box, take the option by its label. */
export async function selectOne(screen: ScreenLike, label: string | RegExp, option: string | RegExp) {
  await screen.getByRole('combobox', label).tap();
  await screen.getByRole('option', option).first().tap();
}

// ── payroll slots ────────────────────────────────────────────────────────────

/**
 * A (unit, month) that has no payroll run yet. Runs are unique per unit and
 * month, so each test takes its own slot among stores that carry none of the
 * seeded people (never store-01), in months long past.
 */
export async function freeRunSlot(): Promise<{ unit: string; period: string; name: string }> {
  const runs: Json[] = await HR().get('/api/v1/payroll/runs');
  const taken = new Set(runs.map((r) => `${r.unit_id}|${r.period}`));
  const year = new Date().getUTCFullYear();
  const slots: { unit: string; period: string }[] = [];
  for (let m = 2; m <= 8; m++) for (const n of ['05', '06', '07', '08', '09', '10', '11', '12', '13']) slots.push({ unit: `store-${n}`, period: `${year}-${String(m).padStart(2, '0')}` });
  const free = slots.filter((s) => !taken.has(`${s.unit}|${s.period}`));
  if (!free.length) throw new Error('no free payroll slot left on the rig');
  const pick = free[Math.floor(Math.random() * free.length)];
  const units: Json[] = await HR().get('/api/v1/organisation/units');
  const name = units.find((u) => u.id === pick.unit)?.name ?? pick.unit;
  return { ...pick, name };
}
