// People › Overview & Requests: leave, attendance corrections and roster swaps are decided where they are queued;
// grievances (no hub screen) are an API-only branch.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, HR2, addDays, asUser, fileLeave, hire, leaveRequests, nextWeekday, prevWeekday, rosterDay, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };
const shiftOf = async (empId: string, on: string) => ((await HR().get(`/api/v1/roster?from=${on}&to=${on}&unit=store-01`)) as any[]).find((r) => r.employee_id === empId)?.shift_id; // eslint-disable-line @typescript-eslint/no-explicit-any

async function swapSetup() {
  const a = await hire(tag('SA'), { login: { role: 'CASHIER' } });
  const b = await hire(tag('SB'), { login: { role: 'CASHIER' } });
  const day = nextWeekday(today(), 2);
  await rosterDay(a.id, day, 'PAGI');
  await rosterDay(b.id, day, 'SIANG');
  const swap = await asUser(a.username!).post('/api/v1/roster-swaps', { with_employee_id: b.id, on_date: day, reason: 'Kuliah pagi' });
  return { a, b, day, swap };
}

describe('People: requests on the Overview', { tags: ['people'] }, () => {
  test('HR-140 Leave is decided from the Overview queue: Approve with a reason', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('RQ'));
    const req = await fileLeave(h.id, { from: prevWeekday(today(), 3) });
    await app.open(`/people/overview?request=${req.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Waiting on a decision', LOAD);
    await expect(sheet).toContainText('Uji e2e: keperluan keluarga');
    await expect(sheet.getByRole('button', 'Approve')).toBeDisabled();
    await sheet.getByRole('textbox', /^Why/).fill('Boleh, sudah ada pengganti');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => (await leaveRequests(h.id))[0].state, { timeout: 20_000 }).toBe('APPROVED');
  });

  test('HR-141 a roster swap, approved: the two people exchange the day\'s shift', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { a, b, day, swap } = await swapSetup();
    expect(swap.state).toBe('PENDING');
    await app.open(`/people/overview?request=${swap.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Roster swap')).toBeVisible(LOAD);
    await expect(sheet).toContainText('Kuliah pagi');
    await sheet.getByRole('textbox', /^Why/).fill('Disetujui kepala toko');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(() => shiftOf(a.id, day), { timeout: 20_000 }).toBe('SIANG');
    expect(await shiftOf(b.id, day)).toBe('PAGI');
  });

  test('HR-142 a roster swap, refused: the plan stays as it was', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const { a, b, day, swap } = await swapSetup();
    await app.open(`/people/overview?request=${swap.id}`);
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).fill('Kekurangan orang di shift sore');
    await sheet.getByRole('button', 'Refuse').tap();
    await expect.poll(async () => ((await HR().get(`/api/v1/employees/${a.id}/roster-swaps`)) as any[])[0]?.state, { timeout: 20_000 }).toBe('REJECTED'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await shiftOf(a.id, day)).toBe('PAGI');
    expect(await shiftOf(b.id, day)).toBe('SIANG');
  });

  test('HR-143 an attendance correction is approved by someone other than whoever filed it', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('AC'));
    const past = prevWeekday(today(), 2);
    await rosterDay(h.id, past, 'PAGI');
    const [corr] = await HR().post(`/api/v1/employees/${h.id}/attendance-corrections`, { business_date: past, effect: 'ARRIVAL_AND_DEPARTURE', arrival: '08:00', departure: '17:00', arrival_day_offset: 0, departure_day_offset: 0, reason: 'Lupa absen karena sistem mati' });
    await app.open(`/people/overview?request=${corr.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Lupa absen karena sistem mati', LOAD);
    await sheet.getByRole('textbox', /^Why/).fill('Sesuai catatan keamanan');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => ((await HR().get(`/api/v1/attendance-corrections?unit=store-01&pending=false`)) as any[]).find((c) => c.id === corr.id)?.state, { timeout: 20_000 }).toBe('APPROVED'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-144 the filer of a correction cannot approve it', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('AD'));
    const past = prevWeekday(today(), 2);
    await rosterDay(h.id, past, 'PAGI');
    const [corr] = await HR().post(`/api/v1/employees/${h.id}/attendance-corrections`, { business_date: past, effect: 'ARRIVAL_AND_DEPARTURE', arrival: '08:00', departure: '17:00', arrival_day_offset: 0, departure_day_offset: 0, reason: 'Uji dua orang' });
    const res = await HR().call('POST', `/api/v1/attendance-corrections/${corr.id}/decision`, { approve: true, reason: 'Sendiri' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/error/i);
  });

  test('HR-145 leave over the balance is accepted at filing but refused at approval, with the figures in the sentence', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('RB'), { leaveDays: 1 });
    const to = prevWeekday(today(), 1);
    const req = await fileLeave(h.id, { from: prevWeekday(to, 4), to });
    expect(req.chargeable_days).toBe(5);
    const res = await HR2().call('POST', `/api/v1/employees/${h.id}/leave-requests/${req.id}/approve`, { reason: 'Coba setuju' }, { ok: false });
    expect(JSON.stringify(res)).toContain('requested 500 centidays against 100 available');
    expect((await leaveRequests(h.id))[0].state).toBe('PENDING');
  });
});

describe('People: grievances (API only — the hub has no screen for them)', { tags: ['people'] }, () => {
  test('HR-146 an employee files a grievance in confidence; HR investigates and resolves it', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('GR'), { login: { role: 'CASHIER' } });
    const other = await hire(tag('GS'), { login: { role: 'CASHIER' } });
    const filed = await asUser(h.username!).post('/api/v1/grievances', { type_code: 'JADWAL', subject: 'Pembagian shift', description: 'Lembur tiga hari berturut-turut' });
    expect(filed).toMatchObject({ state: 'OPEN', raised_by: h.id, type_code: 'JADWAL' });
    const mine = (await asUser(h.username!).get('/api/v1/grievances')) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(mine.some((g) => g.grievance_id === filed.grievance_id)).toBe(true);
    const theirs = (await asUser(other.username!).get('/api/v1/grievances').catch(() => [])) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(theirs.some((g) => g.grievance_id === filed.grievance_id)).toBe(false);
    const inv = await HR().post(`/api/v1/grievances/${filed.grievance_id}/investigation`, { note: 'Kepala toko dipanggil' });
    expect(inv.state).toBe('INVESTIGATED');
    const res = await HR().post(`/api/v1/grievances/${filed.grievance_id}/resolution`, { valid: true, detail: 'Jadwal diperbaiki mulai pekan depan' });
    expect(res).toMatchObject({ state: 'RESOLVED', resolved_by: 'rina' });
  });
});
