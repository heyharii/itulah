// People › employee sheet › Exit (a leaver's interview and full & final statement), and API-only guards.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, addDays, asUser, hire, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

async function leaver() {
  const h = await hire(tag('XL'), { login: { role: 'CASHIER' } });
  await HR().post(`/api/v1/employees/${h.id}/employment`, { transition: 'TERMINATE', effective_on: today(), reason: 'Mengundurkan diri' });
  return h;
}

describe('People: leavers', { tags: ['people'] }, () => {
  test('HR-150 Exit tab of a leaver: the interview opened by the termination waits to be conducted, nothing is settled yet', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await leaver();
    await app.open(`/people?employee=${h.id}#exit`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('tab', 'Exit')).toHaveAttribute('aria-selected', 'true', LOAD);
    await expect(sheet.getByRole('heading', 'Exit interview')).toBeVisible(LOAD);
    await expect(sheet).toContainText('Waiting to be conducted');
    await expect(sheet).toContainText('Nothing settled with this leaver yet.');
  });

  test('HR-151 a recorded exit interview and a full & final statement show on the Exit tab', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await leaver();
    // Terminating opened the interview by itself.
    const exit = ((await HR().get(`/api/v1/exit-interviews?employee=${h.id}`)) as any[])[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(exit.state).toMatch(/PENDING|OPEN|WAITING/);
    await HR().post(`/api/v1/exit-interviews/${exit.exit_id}/completion`, { stance: 'EXIT_CONFIRMED', summary: 'Pindah kota ikut keluarga' });
    const fnf = await HR().post('/api/v1/full-and-final-statements', { employee_id: h.id, transaction_on: today(), final_pay_minor: 2_500_000 });
    expect(fnf).toMatchObject({ state: 'DRAFT', final_pay_minor: 2_500_000 });
    await app.open(`/people?employee=${h.id}#exit`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Confirmed the exit', LOAD);
    await expect(sheet).toContainText('Pindah kota ikut keluarga');
    await expect(sheet).toContainText('Rp 2.500.000');
  });

  test('HR-151b filing a second exit interview for the same leaver is refused with a sentence about the existing one', { session: 'rina', tags: ['people', 'bug'] }, async () => {
    // Answers 400 "stored interview does not hydrate: <uuid>" — an internal message, not "already has one".
    const h = await leaver();
    const again = await HR().call('POST', '/api/v1/exit-interviews', { employee_id: h.id }, { ok: false });
    expect(JSON.stringify(again)).not.toMatch(/hydrate/);
    expect(JSON.stringify(again)).toMatch(/already|exists|one interview/i);
  });

  test('HR-152 a terminated person cannot be terminated again or suspended', { session: 'rina', tags: ['people'] }, async () => {
    const h = await leaver();
    const again = await HR().call('POST', `/api/v1/employees/${h.id}/employment`, { transition: 'TERMINATE', effective_on: today(), reason: 'Dobel' }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/error/i);
    const suspended = await HR().call('POST', `/api/v1/employees/${h.id}/employment`, { transition: 'SUSPEND', effective_on: today(), reason: 'Tidak mungkin' }, { ok: false });
    expect(JSON.stringify(suspended)).toMatch(/error/i);
  });
});

describe('People: API guards behind the forms', { tags: ['people'] }, () => {
  test('HR-153 an assignment to a unit that does not exist is a 4xx with a sentence, not a database failure', { session: 'rina', tags: ['people', 'bug'] }, async () => {
    const rec = await HR().post('/api/v1/employees', { employee_code: `${tag('UQ')}-E` });
    const res = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'rina', password: 'Password01' }) });
    const { token } = (await res.json()) as { token: string };
    const post = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/employees/${rec.employee_id}/assignments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ unit_id: 'no-such-unit', valid_from: '2026-01-05', valid_to: null, reason: 'Uji unit palsu' }) });
    expect(post.status).toBeLessThan(500);
  });

  test('HR-154 a duplicate employee number is refused', { session: 'rina', tags: ['people'] }, async () => {
    const code = `${tag('DU')}-E`;
    await HR().post('/api/v1/employees', { employee_code: code });
    const again = await HR().call('POST', '/api/v1/employees', { employee_code: code }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/error/i);
  });

  test('HR-155 a PKWT cannot start before the previous one ended (overlap) and a second HIRE is refused', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('OV'), { kind: 'PKWT' });
    const overlap = await HR().call('POST', `/api/v1/employees/${h.id}/contracts`, { kind: 'PKWT', starts_on: addDays(today(), 1), ends_on: addDays(today(), 100), position: 'Staf', grade: 'G2', reason: 'Tumpang tindih' }, { ok: false });
    expect(JSON.stringify(overlap)).toMatch(/overlap|conflict/i);
    const hireAgain = await HR().call('POST', `/api/v1/employees/${h.id}/employment`, { transition: 'HIRE', effective_on: today(), reason: 'Dobel hire' }, { ok: false });
    expect(JSON.stringify(hireAgain)).toMatch(/error/i);
  });

  test('HR-156 only an Admin can create a job role; HR-level supervisors are refused', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('RR'), { login: { role: 'SUPERVISOR' } });
    const res = await asUser(h.username!).call('PUT', `/api/v1/roles/ZX${tag('')}`, { name: 'Tidak boleh', rung: 'CASHIER' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/forbidden|error/i);
  });

  test('HR-157 invitations can only be issued for an existing role and unit', { session: 'rina', tags: ['people'] }, async () => {
    const badRole = await HR().call('POST', '/api/v1/invitations', { people: [{ name: 'Salah Peran', role_code: 'NO_SUCH_ROLE', unit_id: 'store-01' }] }, { ok: false });
    expect(JSON.stringify(badRole)).toMatch(/error/i);
    const badUnit = await HR().call('POST', '/api/v1/invitations', { people: [{ name: 'Salah Unit', role_code: 'CASHIER', unit_id: 'no-such-unit' }] }, { ok: false });
    expect(JSON.stringify(badUnit)).toMatch(/error/i);
  });
});
