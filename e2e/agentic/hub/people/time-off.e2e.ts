// People › Time Off Requests / Balances / Team Calendar: a filer never decides their own filing.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, fileLeave, hire, leaveBalance, leaveRequests, nextWeekday, pickDay, pickOne, prevWeekday, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

describe('People: time off', { tags: ['people'] }, () => {
  test('HR-10 approving a request charges the days to the balance (decided by someone other than the filer)', { session: 'admin', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const h = await hire(tag('L'));
    // The balance is as of today: leave already taken is charged, leave still to come is not (yet).
    const to = prevWeekday(today(), 1);
    const from = prevWeekday(to, 1);
    const req = await fileLeave(h.id, { from, to });
    expect(req.chargeable_days).toBe(2);
    expect((await leaveBalance(h.id)).centidays).toBe(1200);
    await app.open('/people/leave');
    await screen.getByRole('textbox', 'Search requests').fill(h.name);
    const row = screen.getByRole('row', { name: new RegExp(h.name) });
    await expect(row).toContainText('Cuti tahunan', LOAD);
    await row.tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', `${h.name} · Cuti tahunan`)).toBeVisible();
    await expect(sheet).toContainText('Uji e2e: keperluan keluarga');
    await sheet.getByRole('textbox', /^Why/).fill('Disetujui, tim cukup');
    await sheet.getByRole('button', 'Approve').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    await expect.poll(async () => (await leaveRequests(h.id))[0].state, { timeout: 20_000 }).toBe('APPROVED');
    const after = await leaveBalance(h.id);
    expect(after.centidays).toBe(1000);
    expect(after.pending_centidays).toBe(0);
    expect((await leaveRequests(h.id))[0].decided_by).toBe('admin');
  });

  test('HR-11 rejecting a request leaves the balance whole and records the reason', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('J'));
    await fileLeave(h.id, { from: nextWeekday(today(), 6) });
    await app.open('/people/leave');
    await screen.getByRole('textbox', 'Search requests').fill(h.name);
    await screen.getByRole('row', { name: new RegExp(h.name) }).tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).fill('Bertepatan dengan stock opname');
    await sheet.getByRole('button', 'Reject').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    await expect.poll(async () => (await leaveRequests(h.id))[0].state, { timeout: 20_000 }).toBe('REJECTED');
    expect((await leaveRequests(h.id))[0].decision_reason).toBe('Bertepatan dengan stock opname');
    const b = await leaveBalance(h.id);
    expect(b.centidays).toBe(1200);
    expect(b.pending_centidays).toBe(0);
  });

  test('HR-16 approving more days than the balance holds is refused in the sheet, with the figures', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('OB'), { leaveDays: 1 });
    const to = prevWeekday(today(), 1);
    const req = await fileLeave(h.id, { from: prevWeekday(to, 4), to });
    await app.open('/people/leave');
    await screen.getByRole('textbox', 'Search requests').fill(h.name);
    await screen.getByRole('row', { name: new RegExp(h.name) }).tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Why/).fill('Coba setuju');
    await sheet.getByRole('button', 'Approve').tap();
    await expect(sheet).toContainText('500 centidays against 100 available', LOAD);
    expect((await leaveRequests(h.id))[0].state).toBe('PENDING');
    expect(req.chargeable_days).toBe(5);
  });

  test('HR-12 the filer cannot decide their own filing: it is not in their Waiting list', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('M'));
    await fileLeave(h.id, { from: nextWeekday(today(), 7) });
    await app.open('/people/leave');
    await screen.getByRole('textbox', 'Search requests').fill(h.name);
    await expect(screen.getByText(/Nothing matches that search\./)).toBeVisible(LOAD);
    const asRina = await HR().get('/api/v1/leave-requests/pending');
    expect(asRina.some((r: any) => r.employee_id === h.id)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-13 Request leave sheet files a request for someone, which then waits for another person', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('Q'));
    const from = nextWeekday(today(), 8);
    await app.open('/people/leave');
    await screen.getByRole('button', 'Request leave').first().tap();
    const sheet = screen.getByRole('dialog');
    await pickOne(screen, 'Employee', h.name);
    await pickOne(screen, 'Kind of leave', 'Cuti tahunan');
    await pickDay(screen, /^From/, from);
    await sheet.getByRole('textbox', /^Why/).fill('Urusan keluarga di luar kota');
    await sheet.getByRole('button', 'File request').tap();
    await expect(screen.getByText(/Leave filed for/)).toBeVisible(LOAD);
    const reqs = await leaveRequests(h.id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ state: 'PENDING', from_date: from, leave_type: 'CUTI_TAHUNAN', reason: 'Urusan keluarga di luar kota' });
  });

  test('HR-14 Time Off Balances lists the person; their sheet shows the 12-day grant', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('B'));
    await app.open('/people/leave-balances');
    await screen.getByRole('textbox', 'Search people').fill(h.name);
    const row = screen.getByRole('row', { name: new RegExp(h.code) });
    await expect(row).toBeVisible(LOAD);
    await row.tap();
    await expect(screen.getByRole('dialog')).toContainText('Cuti tahunan', LOAD);
    await expect(screen.getByRole('dialog')).toContainText('12');
  });

  test('HR-15 Team Calendar shows a waiting request on its day for the person', { session: 'rina', tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await hire(tag('Y'));
    const from = nextWeekday(today(), 2);
    await fileLeave(h.id, { from });
    await app.open(`/people/calendar`);
    await expect(screen.getByRole('heading', 'Team Calendar')).toBeVisible(LOAD);
    await expect(screen.getByRole('row', { name: new RegExp(h.name) })).toBeVisible(LOAD);
    // The bar is a titled box inside the row, not text.
    await expect.poll(() => browser.evaluate(`[...document.querySelectorAll('tr')].some((r) => r.innerText.includes(${JSON.stringify(h.name)}) && r.querySelector('[title="Cuti tahunan · waiting"]'))`), { timeout: 20_000 }).toBe(true);
  });
});
