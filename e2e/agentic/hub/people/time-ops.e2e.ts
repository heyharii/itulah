// People › Overtime, Roster, Attendance, Org Chart, Onboarding/Offboarding, Overview.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, asUser, hire, nextWeekday, orderOvertime, overtimeOrders, pickDay, prevWeekday, rosterDay, selectOne, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

describe('People: overtime', { tags: ['people'] }, () => {
  test('HR-90 Order overtime: the order waits for the person to agree on their own app', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const h = await hire(tag('OA'));
    const on = nextWeekday(today(), 2);
    await app.open('/people/overtime');
    await screen.getByRole('button', 'Order overtime').first().tap();
    const sheet = screen.getByRole('dialog');
    await selectOne(screen, /^Who/, h.name);
    await pickDay(screen, /^Date/, on);
    await sheet.getByRole('spinbutton', /^Minutes/).fill('90');
    await sheet.getByRole('textbox', /^Why/).fill('Bongkar muat barang masuk');
    await sheet.getByRole('button', 'Order it').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const orders = await overtimeOrders(h.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ state: 'AWAITING_CONSENT', planned_minutes: 90, on_date: on, day_kind: 'WORKING', authorized_minutes: null });
    await expect(screen.getByRole('row', { name: new RegExp(h.name) })).toContainText('Waiting on their answer', LOAD);
  });

  test('HR-91 the order sheet says only the employee can answer it, and the orderer can take it back with a reason', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('OW'));
    const order = await orderOvertime(h.id, { on: nextWeekday(today(), 2), minutes: 120 });
    await app.open(`/people/overtime?overtimeOrder=${order.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(`Only ${h.name} can answer this`, LOAD);
    await expect(sheet.getByRole('button', 'Take the order back')).toBeDisabled();
    await sheet.getByRole('textbox', /^Why/).fill('Pekerjaan dibatalkan');
    await sheet.getByRole('button', 'Take the order back').tap();
    await expect.poll(async () => (await overtimeOrders(h.id))[0].state, { timeout: 20_000 }).toMatch(/WITHDRAWN|CANCELL/);
    expect((await overtimeOrders(h.id))[0].withdrawn_reason).toBe('Pekerjaan dibatalkan');
  });

  test('HR-92 the employee agrees from their own login: authorized minutes appear on the order', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // Agreed orders drop out of Overtime: the screen lists /overtime-orders/awaiting only, so the Authorized column and
    // the sheet's answered facts can never show an answered order.
    const h = await hire(tag('OG'), { login: { role: 'CASHIER' } });
    const order = await orderOvertime(h.id, { on: nextWeekday(today(), 3), minutes: 60 });
    const res = await asUser(h.username!).call('POST', `/api/v1/employees/me/overtime-orders/${order.id}/consent`, { agreed: true, reason: 'Siap' }, { ok: false });
    expect(JSON.stringify(res)).not.toMatch(/"error"/);
    expect((await overtimeOrders(h.id))[0].state).not.toBe('AWAITING_CONSENT');
    await app.open(`/people/overtime?overtimeOrder=${order.id}`);
    await expect(screen.getByRole('dialog')).toContainText('1h', LOAD);
    await expect(screen.getByRole('dialog')).not.toContainText('Waiting on their answer');
  });

  test('HR-93 an overtime order past the day cap is refused', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('OC'));
    const res = await HR().call('POST', `/api/v1/employees/${h.id}/overtime-orders`, { order_id: `ot_cap_${tag('')}`, on_date: nextWeekday(today(), 2), day_kind: 'WORKING', planned_minutes: 600, reason: 'Terlalu lama' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/error/i); // 4h a day cap (PP 35)
    expect(await overtimeOrders(h.id)).toHaveLength(0);
  });
});

describe('People: roster and attendance', { tags: ['people'] }, () => {
  test('HR-94 Roster renders a week and shows the shift planned for someone', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // Roster crashes on open: "Something went wrong! day is not defined" (roster.tsx uses day() without importing it).
    const h = await hire(tag('RO'));
    const on = nextWeekday(today(), 1);
    await rosterDay(h.id, on, 'PAGI');
    await app.open('/people/roster');
    await expect(screen.getByText('Something went wrong!')).toBeHidden(LOAD);
    await expect(screen.getByRole('heading', 'Roster')).toBeVisible(LOAD);
  });

  test('HR-95 a planned day is stored with its shift hours and a revision trail', { session: 'rina', tags: ['people'] }, async () => {
    const h = await hire(tag('RP'));
    const on = nextWeekday(today(), 1);
    const first = await rosterDay(h.id, on, 'PAGI');
    expect(first).toMatchObject({ plan: 'SCHEDULED', shift_id: 'PAGI', revision_count: 1, planned_by: 'rina' });
    const second = await rosterDay(h.id, on, 'SIANG');
    expect(second).toMatchObject({ shift_id: 'SIANG', revision_count: 2 });
    expect(second.revisions.map((r: any) => r.shift_id)).toEqual(['PAGI', 'SIANG']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-96 Attendance for a day names the unit and its stations; File correction opens its sheet', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/attendance-days');
    await expect(screen.getByRole('heading', 'Attendance')).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Stations')).toBeVisible(LOAD);
    await screen.getByRole('button', 'File correction').first().tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'File a correction')).toBeVisible();
    await expect(sheet).toContainText('Waits for a second person to approve it.');
    await expect(sheet.getByRole('button', 'File correction')).toBeDisabled();
  });

  test('HR-97 Org Chart lists people not yet placed; Place someone sets department, level and manager', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('OR'));
    await app.open('/people/org-chart');
    await expect(screen.getByRole('heading', 'Org Chart')).toBeVisible(LOAD);
    const item = screen.getByRole('listitem').filter({ hasText: h.name });
    await expect(item).toBeVisible(LOAD);
    await expect(item).toContainText('Not placed', LOAD);
    await expect(screen.getByRole('button', 'Place someone')).toBeVisible();
  });

  test('HR-98 Onboarding and Offboarding open with an In progress / Completed switch', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/onboarding');
    await expect(screen.getByRole('heading', 'Onboarding')).toBeVisible(LOAD);
    await expect(screen.getByRole('button', 'In progress')).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByRole('button', 'Start onboarding')).toBeVisible();
    await app.open('/people/offboarding');
    await expect(screen.getByRole('heading', 'Offboarding')).toBeVisible(LOAD);
    await screen.getByRole('button', 'Completed').tap();
    await expect(screen.getByRole('button', 'Completed')).toHaveAttribute('aria-pressed', 'true');
  });

  test('HR-99 Overview & Requests lists what waits on the caller: an unanswered overtime order shows up', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('OV'));
    await orderOvertime(h.id, { on: nextWeekday(today(), 2) });
    await app.open('/people/overview');
    await expect(screen.getByRole('heading', 'Needs attention')).toBeVisible(LOAD);
    await expect(screen.getByRole('button', { name: new RegExp(`${h.name} has not answered an overtime order`) })).toBeVisible(LOAD);
  });
});
