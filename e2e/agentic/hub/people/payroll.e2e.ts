// People › Payroll: a run per unit and month — the place sends it, head office approves it — and the tax report.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, HR2, freeRunSlot, hire, tag } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };
const run = async (id: string) => ((await HR().get('/api/v1/payroll/runs')) as any[]).find((r) => r.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any

async function slotWithPeople() {
  const { unit, period, name } = await freeRunSlot();
  const a = await hire(tag('PY'), { unit, joined: `${period.slice(0, 4)}-01-05`, identity: true, base: 6_000_000 });
  return { unit, period, name, a };
}

describe('People: payroll runs', { tags: ['people'] }, () => {
  test('HR-100 Open run builds a draft for a unit and month, with one slip per person on it', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const { unit, period, name, a } = await slotWithPeople();
    await app.open('/people/payroll');
    await screen.getByRole('button', 'Open run').first().tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('combobox', 'Unit').tap();
    await sheet.getByRole('combobox', 'Unit').fill(name);
    await screen.getByRole('option', { name, exact: false }).first().tap();
    await sheet.getByRole('textbox', /^Month/).fill(period);
    await sheet.getByRole('textbox', /^Why/).fill('Gaji bulanan, uji e2e');
    await sheet.getByRole('button', 'Open run').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const opened = ((await HR().get('/api/v1/payroll/runs')) as any[]).find((r) => r.unit_id === unit && r.period === period); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(opened).toMatchObject({ state: 'DRAFT', attendance_from: `${period}-01` });
    const slips = (await HR().get(`/api/v1/payroll/runs/${opened.id}/slips`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(slips.find((s) => s.employee_id === a.id)?.base_minor).toBe(6_000_000);
  });

  test('HR-101 the draft sheet shows the run\'s summary and the slip of each person; Send needs a reason', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const { unit, period, a } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await app.open(`/people/payroll?payrollRun=${r.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', `${unit} · ${period}`)).toBeVisible(LOAD);
    await expect(sheet).toContainText('Being built by the place');
    await expect(sheet.getByRole('row', { name: new RegExp(a.name) })).toContainText('Rp 6.000.000');
    await expect(sheet.getByRole('button', 'Send to head office')).toBeDisabled();
    await sheet.getByRole('textbox', /^Why/).fill('Data sudah lengkap');
    await sheet.getByRole('button', 'Send to head office').tap();
    await expect.poll(async () => (await run(r.id)).state, { timeout: 20_000 }).toBe('SUBMITTED');
    expect((await run(r.id)).submitted_by).toBe('rina');
  });

  test('HR-102 head office approves a submitted run (a different person from the sender)', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { unit, period } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await HR().post(`/api/v1/payroll/runs/${r.id}/submission`, { reason: 'Kirim' });
    await app.open(`/people/payroll?payrollRun=${r.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Waiting on head office', LOAD);
    await expect(sheet.getByRole('button', 'Approve')).toBeDisabled();
    await sheet.getByRole('textbox', /^Why/).fill('Sudah dicek');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => (await run(r.id)).state, { timeout: 20_000 }).toBe('APPROVED');
    expect((await run(r.id)).approved_by).toBe('admin');
  });

  test('HR-103 the sender cannot approve their own run', { session: 'rina', tags: ['people'] }, async () => {
    const { unit, period } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await HR().post(`/api/v1/payroll/runs/${r.id}/submission`, { reason: 'Kirim' });
    const res = await HR().call('POST', `/api/v1/payroll/runs/${r.id}/approve`, { reason: 'Setuju sendiri' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/error/i);
    expect((await run(r.id)).state).toBe('SUBMITTED');
  });

  test('HR-104 Send back returns a submitted run to the place', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { unit, period } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await HR().post(`/api/v1/payroll/runs/${r.id}/submission`, { reason: 'Kirim' });
    await app.open(`/people/payroll?payrollRun=${r.id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).fill('Ada karyawan yang belum masuk');
    await sheet.getByRole('button', 'Send back').tap();
    await expect.poll(async () => (await run(r.id)).state, { timeout: 20_000 }).toBe('DRAFT');
  });

  test('HR-105 a second run for the same unit and month is refused', { session: 'rina', tags: ['people'] }, async () => {
    const { unit, period } = await slotWithPeople();
    await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    const again = await HR().call('POST', '/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Dobel' }, { ok: false });
    expect(JSON.stringify(again)).toMatch(/error/i);
  });

  test('HR-106 the payslip of a person on the run: gross, PPh 21 under TER, take-home', { session: 'rina', tags: ['people'] }, async () => {
    const { unit, period, a } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    const slip = ((await HR().get(`/api/v1/payroll/runs/${r.id}/slips`)) as any[]).find((s) => s.employee_id === a.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(slip).toMatchObject({ base_minor: 6_000_000, ptkp: 'TK/0', days_paid: slip.days_in_month });
    const pph = slip.deductions.find((d: any) => d.component_code === 'PPH21'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pph.amount_minor).toBe(Math.floor((6_000_000 * pph.rate_bp) / 10_000));
  });
});

describe('People: tax & BPJS report and annual tax', { tags: ['people'] }, () => {
  test('HR-107 the report lists a month\'s people as soon as their run exists, draft or not (the screen says so)', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // The empty state promises "A run built for the month shows here as soon as it exists, draft or not", but
    // /payroll/tax-report only answers for approved runs.
    const { unit, period, a } = await slotWithPeople();
    await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await app.open('/people/tax-report');
    await screen.getByRole('textbox', 'Month').fill(period);
    await expect(screen.getByRole('row', { name: new RegExp(a.name) })).toBeVisible(LOAD);
    await expect(screen.getByRole('row', { name: new RegExp(a.name) })).toContainText('Rp 45.000', LOAD);
  });

  test('HR-107b once head office approves the run, each person shows with PPh 21 and BPJS and Export CSV turns on', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const { unit, period, a } = await slotWithPeople();
    const r = await HR().post('/api/v1/payroll/runs', { unit_id: unit, period, reason: 'Uji e2e' });
    await HR().post(`/api/v1/payroll/runs/${r.id}/submission`, { reason: 'Kirim' });
    await HR2().post(`/api/v1/payroll/runs/${r.id}/approve`, { reason: 'Setuju' });
    await app.open('/people/tax-report');
    await screen.getByRole('textbox', 'Month').fill(period);
    await expect(screen.getByRole('row', { name: new RegExp(a.name) })).toBeVisible(LOAD);
    await expect(screen.getByRole('row', { name: new RegExp(a.name) })).toContainText('Rp 45.000', LOAD);
    await expect(screen.getByText('People paid')).toBeVisible();
    await expect(screen.getByRole('button', 'Export CSV')).toBeEnabled();
  });

  test('HR-108 the report of a month nobody ran says so and keeps Export CSV off', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/tax-report');
    await screen.getByRole('textbox', 'Month').fill('2019-03');
    await expect(screen.getByText(/No payroll for 2019-03 has been worked out with tax yet/)).toBeVisible(LOAD);
    await expect(screen.getByRole('button', 'Export CSV')).toBeDisabled();
  });

  test('HR-109 1721-A1 for a year says a year is settled once its last month is paid', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/annual-tax');
    await expect(screen.getByRole('heading', 'Annual Tax')).toBeVisible(LOAD);
    await expect(screen.getByRole('spinbutton', 'Tax year')).toHaveValue(String(new Date().getUTCFullYear()));
    await expect(screen.getByText(/A year is settled once its last month has been paid/)).toBeVisible();
  });
});
