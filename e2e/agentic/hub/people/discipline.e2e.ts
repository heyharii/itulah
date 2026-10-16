// People › Reprimands and Transfers & Changes.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, addDays, asUser, hire, issueLetter, lettersOf, pickDay, pickOne, proposeChange, selectOne, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

describe('People: reprimands', { tags: ['people'] }, () => {
  test('HR-70 Issue a letter from the Reprimands screen: SP 1 for six months', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const h = await hire(tag('RP'));
    await app.open('/people/reprimands');
    await screen.getByRole('button', 'Issue letter').first().tap();
    const sheet = screen.getByRole('dialog');
    await pickOne(screen, 'Employee', h.name);
    await pickOne(screen, 'Level', 'SP 1');
    await sheet.getByRole('textbox', /^What was done/).fill('Terlambat tiga kali dalam seminggu');
    await sheet.getByRole('textbox', /^Why/).fill('Pembinaan pertama');
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const letters = await lettersOf(h.code);
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({ level: 'SP1', violation: 'Terlambat tiga kali dalam seminggu', revoked: false, acknowledged_at: null });
    await expect(screen.getByRole('row', { name: new RegExp(h.name) })).toContainText('SP 1', LOAD);
  });

  test('HR-71 Revoke letter needs a reason, then the letter drops out of "In force"', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('RV'));
    await issueLetter(h.id, { violation: 'Salah prosedur kas' });
    await app.open('/people/reprimands');
    // "All": the "In force" list hangs on the server's idea of today (see HR-73), which is not what this test is about.
    await screen.getByRole('button', 'All').tap();
    await screen.getByRole('button', h.name).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Salah prosedur kas', LOAD);
    await expect(sheet.getByRole('button', 'Revoke letter')).toBeDisabled();
    await sheet.getByRole('textbox', /^Why revoke it/).fill('Diterbitkan keliru');
    await sheet.getByRole('button', 'Revoke letter').tap();
    await expect.poll(async () => (await lettersOf(h.code))[0].revoked, { timeout: 20_000 }).toBe(true);
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
  });

  test('HR-72 the In force / All switch: a revoked letter shows under All only', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('RA'));
    const letter = (await issueLetter(h.id))[0];
    await HR().post(`/api/v1/warning-letters/${letter.id}/revocation`, { reason: 'Uji e2e' });
    await app.open('/people/reprimands');
    await expect(screen.getByRole('button', 'In force')).toHaveAttribute('aria-pressed', 'true', LOAD);
    await screen.getByRole('button', 'All').tap();
    await expect(screen.getByRole('row', { name: new RegExp(h.name) })).toBeVisible(LOAD);
  });

  test('HR-73 a letter issued today is in force: the employee\'s own record does not say Lapsed', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // The hub's "today" is Jakarta's; the server judges a letter's start against the UTC date. Between 00:00 and
    // 07:00 WIB a letter dated today is "not active" for hours, and the employee's page reads "Lapsed".
    const h = await hire(tag('RL'), { login: { role: 'CASHIER' } });
    await issueLetter(h.id, { on: today() });
    const own = (await asUser(h.username!).get('/api/v1/employees/me/warning-letters')) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(own[0].active).toBe(true);
  });
});

describe('People: transfers & changes', { tags: ['people'] }, () => {
  test('HR-74 New change proposes a promotion, which then waits for someone else', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('CP'));
    await app.open('/people/changes');
    await screen.getByRole('button', 'New change').first().tap();
    const sheet = screen.getByRole('dialog');
    await pickOne(screen, 'Employee', h.name);
    await selectOne(screen, /^Change/, /Promotion/);
    await sheet.getByRole('textbox', /^New grade/).fill('G4');
    await pickDay(screen, /^Effective on/, addDays(today(), 20));
    await sheet.getByRole('textbox', /^Why/).fill('Kinerja baik tiga bulan berturut-turut');
    await sheet.getByRole('button', 'Propose it').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const list = (await HR().get(`/api/v1/employees/${h.id}/change-proposals`)) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'PROMOTION', state: 'PENDING', filed_by: 'rina' });
    expect(list[0].props[0]).toMatchObject({ field: 'grade', to: 'G4' });
  });

  test('HR-75 approving a change needs a decision note and applies it', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('CA'));
    const c = await proposeChange(h.id, { kind: 'PROMOTION', props: [{ field: 'grade', to_text: 'G3' }], effective_on: today() });
    await app.open('/people/changes');
    await screen.getByRole('button', h.name).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', `Promotion · ${h.name}`)).toBeVisible(LOAD);
    await expect(sheet.getByRole('button', 'Approve')).toBeDisabled();
    await sheet.getByRole('textbox', /^Reason for the decision/).fill('Sesuai penilaian kinerja');
    await sheet.getByRole('button', 'Approve').tap();
    await expect.poll(async () => ((await HR().get(`/api/v1/employees/${h.id}/change-proposals`)) as any[]).find((p) => p.id === c.id)?.state, { timeout: 20_000 }).not.toBe('PENDING'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const done = ((await HR().get(`/api/v1/employees/${h.id}/change-proposals`)) as any[]).find((p) => p.id === c.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(done.decided_by).toBe('admin');
  });

  test('HR-76 rejecting a change leaves the record as it was', { session: 'admin', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('CR'));
    const c = await proposeChange(h.id, { kind: 'PROMOTION', props: [{ field: 'grade', to_text: 'G5' }], effective_on: today() });
    await app.open('/people/changes');
    await screen.getByRole('button', h.name).tap();
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', /^Reason for the decision/).fill('Belum waktunya');
    await sheet.getByRole('button', 'Reject').tap();
    await expect.poll(async () => ((await HR().get(`/api/v1/employees/${h.id}/change-proposals`)) as any[]).find((p) => p.id === c.id)?.state, { timeout: 20_000 }).toBe('REJECTED'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const contracts = (await HR().get(`/api/v1/employees/${h.id}/contracts`)).contracts;
    expect(contracts[0].grade).toBe('G2');
  });

  test('HR-77 the filer of a change cannot decide it', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('CF'));
    const c = await proposeChange(h.id, { kind: 'PROMOTION', props: [{ field: 'grade', to_text: 'G3' }], effective_on: today() });
    const res = await HR().call('POST', `/api/v1/change-proposals/${c.id}/decision`, { approved: true, reason: 'Sendiri' }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/error/i);
    expect(((await HR().get(`/api/v1/employees/${h.id}/change-proposals`)) as any[])[0].state).toBe('PENDING'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
