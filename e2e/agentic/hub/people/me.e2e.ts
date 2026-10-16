// /me — self-service for an employee signed in with their own login (a CASHIER: no hub sections).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, adjustBenefit, asUser, fileClaim, fileLeave, hire, issueLetter, leaveRequests, nextWeekday, orderOvertime, overtimeOrders, pickDay, selectOne, signInAs, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

async function asEmployee(browser: any, app: any, opts: Parameters<typeof hire>[1] = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = await hire(tag('M'), { login: { role: 'CASHIER' }, identity: true, ...opts });
  await app.open('/');
  await signInAs(browser, h.username!);
  return h;
}

describe('Self-service (/me)', { tags: ['people'] }, () => {
  test('HR-110 Profile: greeting, job and unit, what waits on them, leave balance and account', { tags: ['people', 'smoke'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await orderOvertime(h.id, { on: nextWeekday(today(), 2) });
    await fileLeave(h.id, { from: nextWeekday(today(), 4) });
    await app.open('/me');
    await expect(screen.getByText(`Hello, ${h.name}`)).toBeVisible(LOAD);
    await expect(screen.getByText('Staf uji · Cikupa')).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Waiting on you')).toBeVisible(LOAD);
    await expect(screen.getByRole('link', 'Answer')).toBeVisible(LOAD);
    await expect(screen.getByText(/^12 days/)).toBeVisible(LOAD);
    await expect(screen.getByText('Cuti tahunan · 1 day awaiting a decision')).toBeVisible(LOAD);
    await expect(screen.getByText(`${h.username} · Cashier`)).toBeVisible(LOAD);
  });

  test('HR-111 a cashier sees no hub department and is refused the People data', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await app.open('/me');
    await expect(screen.getByText(`Hello, ${h.name}`)).toBeVisible(LOAD);
    await expect(screen.getByRole('link', { name: /^HR$/ })).toBeHidden();
    const res = await asUser(h.username!).call('GET', '/api/v1/employees', undefined, { ok: false });
    expect(JSON.stringify(res)).toMatch(/forbidden|error/i);
    const pay = await asUser(h.username!).call('POST', '/api/v1/payroll/runs', { unit_id: 'store-01', period: '2026-01', reason: 'x' }, { ok: false });
    expect(JSON.stringify(pay)).toMatch(/forbidden|error/i);
  });

  test('HR-112 Request leave: the request is filed under their own name and waits for a manager', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    const on = nextWeekday(today(), 5);
    await app.open('/me/leave/new');
    await selectOne(screen, 'Kind of leave', /^Cuti tahunan/);
    await pickDay(screen, 'First day', on);
    await pickDay(screen, 'Last day', on);
    await screen.getByRole('textbox', /^Why/).fill('Menghadiri pernikahan saudara');
    await screen.getByRole('button', 'Send request').tap();
    await expect.poll(async () => (await leaveRequests(h.id)).length, { timeout: 20_000 }).toBe(1);
    const req = (await leaveRequests(h.id))[0];
    expect(req).toMatchObject({ state: 'PENDING', requested_by: h.username, from_date: on, reason: 'Menghadiri pernikahan saudara' });
    await app.open('/me/leave');
    await expect(screen.getByText('Cuti tahunan · 1 day')).toBeVisible(LOAD);
    await expect(screen.getByText('Menghadiri pernikahan saudara')).toBeVisible();
  });

  test('HR-113 Withdraw takes the employee\'s own waiting request back', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    const own = await asUser(h.username!).post('/api/v1/employees/me/leave-requests', { request_id: `lr_${tag('W')}`, leave_type: 'CUTI_TAHUNAN', from_date: nextWeekday(today(), 6), to_date: nextWeekday(today(), 6), reason: 'Urusan pribadi' });
    expect(own.requested_by).toBe(h.username);
    await app.open('/me/leave');
    await screen.getByRole('button', 'Withdraw').tap();
    await expect.poll(async () => (await leaveRequests(h.id))[0].state, { timeout: 20_000 }).toBe('WITHDRAWN');
  });

  test('HR-113b a request HR filed for them is not offered a Withdraw the server will always refuse', { tags: ['people', 'bug'] }, async ({ app, screen, browser }) => {
    // Only the person who filed a request may withdraw it (409), yet /me/leave shows Withdraw on every waiting
    // request and answers "Could not withdraw that request. Try again."
    const h = await asEmployee(browser, app);
    await fileLeave(h.id, { from: nextWeekday(today(), 6) }); // filed by rina
    await app.open('/me/leave');
    await expect(screen.getByText('Uji e2e: keperluan keluarga')).toBeVisible(LOAD);
    await expect(screen.getByRole('button', 'Withdraw')).toBeHidden();
  });

  test('HR-114 Overtime: Agree authorizes the ordered minutes', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await orderOvertime(h.id, { on: nextWeekday(today(), 2), minutes: 90 });
    await app.open('/me/overtime');
    await expect(screen.getByText('Needs your reply')).toBeVisible(LOAD);
    await screen.getByRole('button', 'Agree').tap();
    await expect.poll(async () => (await overtimeOrders(h.id))[0].state, { timeout: 20_000 }).not.toBe('AWAITING_CONSENT');
    expect((await overtimeOrders(h.id))[0]).toMatchObject({ authorized_minutes: 90 });
    await expect(screen.getByText(/1h 30m authorized|1h30 authorized|90m authorized|1.5h authorized/)).toBeVisible(LOAD);
  });

  test('HR-115 Overtime: Decline is final and authorizes nothing', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await orderOvertime(h.id, { on: nextWeekday(today(), 3), minutes: 60 });
    await app.open('/me/overtime');
    await screen.getByRole('button', 'Decline').tap();
    await expect.poll(async () => (await overtimeOrders(h.id))[0].state, { timeout: 20_000 }).not.toBe('AWAITING_CONSENT');
    expect((await overtimeOrders(h.id))[0].authorized_minutes ?? 0).toBe(0);
  });

  test('HR-116 My Details: payroll identity is part-masked and the contract is shown', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app, { kind: 'PKWT', position: 'Kasir pagi' });
    await app.open('/me/details');
    await expect(screen.getByRole('heading', 'You')).toBeVisible(LOAD);
    await expect(screen.getByText(h.code)).toBeVisible(LOAD);
    await expect(screen.getByText('Cikupa').first()).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Payroll details')).toBeVisible(LOAD);
    await expect(screen.getByText(/^••••••\d{4}$/)).toBeVisible(LOAD);
    await expect(screen.getByText('Shown part-masked. To change where you are paid, ask HR in person.')).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Contract')).toBeVisible(LOAD);
    await expect(screen.getByText(/^Kasir pagi/).first()).toBeVisible(LOAD);
  });

  test('HR-117 a warning letter is acknowledged by its own employee, and HR sees the date', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await issueLetter(h.id, { violation: 'Selisih kas shift sore' });
    await app.open('/me/details');
    await expect(screen.getByRole('heading', 'Warning letters')).toBeVisible(LOAD);
    await expect(screen.getByText('Selisih kas shift sore')).toBeVisible();
    await screen.getByRole('button', 'I have received this letter').tap();
    await expect(screen.getByText('You acknowledged it.')).toBeVisible(LOAD);
    const letters = (await HR().get(`/api/v1/employees/${h.id}/warning-letters`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(letters[0].acknowledged_at).not.toBeNull();
  });

  test('HR-118 New claim: filed and sent in one step, then listed under My claims', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await app.open('/me/pay/claims');
    await screen.getByRole('button', 'New claim').tap();
    await selectOne(screen, 'Kind of expense', 'Transport dinas');
    await screen.getByRole('textbox', /^What it was/).fill('Ojek ke gudang');
    await screen.getByRole('textbox', /^Amount, whole rupiah/).fill('35000');
    await screen.getByRole('textbox', /^Why/).fill('Antar dokumen');
    await screen.getByRole('button', { name: /^(Send|File)/ }).last().tap();
    await expect.poll(async () => ((await HR().get(`/api/v1/employees/${h.id}/expense-claims`)) as any[])[0]?.state, { timeout: 20_000 }).toBe('SUBMITTED'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(((await HR().get(`/api/v1/employees/${h.id}/expense-claims`)) as any[])[0].claimed_minor).toBe(35_000); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-119 Pay: the benefit balance HR filled is shown as a rupiah figure', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await adjustBenefit([h.id], 'ADD', 65_000);
    await app.open('/me/pay');
    await expect(screen.getByRole('heading', 'Your pay')).toBeVisible(LOAD);
    await expect(screen.getByText('Rp 65.000')).toBeVisible();
  });

  test('HR-120 Attendance: Clock in records their own day from the app', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await app.open('/me/attendance');
    await expect(screen.getByRole('heading', 'Clock')).toBeVisible(LOAD);
    await screen.getByRole('button', 'Clock in').tap();
    await expect(screen.getByText(/^Recorded in at/)).toBeVisible(LOAD);
    const days = await HR().get(`/api/v1/employees/${h.id}/attendance?from=${today()}&to=${today()}`);
    expect(JSON.stringify(days)).toContain(today());
  });

  test('HR-121 Change your password: the new password signs in, the old one no longer does', { tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await asEmployee(browser, app);
    await app.open('/me');
    await screen.getByRole('button', 'Change password').tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Current password/).fill('Password01');
    await sheet.getByRole('textbox', /^New password \(required\)/).fill('Baru12345');
    await sheet.getByRole('textbox', /^New password again/).fill('Baru12345');
    await sheet.getByRole('button', 'Change password').tap();
    await expect.poll(async () => {
      const r = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: h.username, password: 'Baru12345' }) });
      return r.status;
    }, { timeout: 20_000 }).toBe(200);
    const old = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: h.username, password: 'Password01' }) });
    expect(old.status).toBe(401);
  });
});
