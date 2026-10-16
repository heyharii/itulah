// People › Employee List: the module's menu, the directory, the employee sheet and its tabs.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, directoryRow, employee, fileClaim, fileLeave, hire, issueLetter, nextWeekday, submitClaim, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

describe('People: the module and the directory', { tags: ['people'] }, () => {
  test('HR-01 the HR rail opens People on Overview & Requests and lists its screens in groups', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('link', { name: /^HR$/ }).tap();
    await expect(browser).toHaveURL(/\/people\/overview$/, LOAD);
    await expect(screen.getByRole('heading', 'Overview')).toBeVisible(LOAD);
    const nav = screen.getByRole('navigation', 'HR');
    for (const item of ['Employee List', 'Org Chart', 'Transfers & Changes', 'Reprimands', 'Invitations', 'Time Off Requests', 'Time Off Balances', 'Attendance', 'Overtime', 'Roster', 'Team Calendar', 'Claims', 'Loans', 'Balances', 'Payroll Runs', 'Tax & BPJS Report', 'Job Roles']) {
      await expect(nav.getByRole('link', { name: item })).toBeVisible(LOAD);
    }
  });

  test('HR-02 the directory lists a new hire with name, unit, job, contract and login state', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('D'), { kind: 'PKWT', position: 'Kasir uji' });
    await app.open('/people');
    await expect(screen.getByRole('heading', 'Employees')).toBeVisible(LOAD);
    await screen.getByRole('textbox').first().fill(h.code);
    const row = screen.getByRole('row', { name: new RegExp(h.code) });
    await expect(row).toBeVisible(LOAD);
    await expect(row).toContainText(h.name);
    await expect(row).toContainText('Working');
    await expect(row).toContainText('Cikupa');
    await expect(row).toContainText('Kasir uji');
    await expect(row).toContainText('PKWT');
    await expect(row).toContainText('None');
    expect((await directoryRow(h.code))?.status).toBe('ACTIVE');
  });

  test('HR-03 a registered person nobody has hired yet shows as "Accepted, not started" with no job', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const t = tag('C');
    const rec = await HR().post('/api/v1/employees', { employee_code: `${t}-E` });
    await app.open('/people');
    await screen.getByRole('textbox').first().fill(`${t}-E`);
    const row = screen.getByRole('row', { name: new RegExp(`${t}-E`) });
    await expect(row).toBeVisible(LOAD);
    await expect(row).toContainText('Accepted, not started');
    await expect(row).toContainText('Not enrolled yet');
    expect((await employee(rec.employee_id)).status).toBe('CANDIDATE');
  });

  test('HR-04 clicking a row opens the employee sheet: facts, the tabs, the employment history and postings', { session: 'rina', tags: ['people'] }, async ({ app, screen, browser }) => {
    const h = await hire(tag('S'), { login: { role: 'CASHIER' } });
    await app.open('/people');
    await screen.getByRole('textbox').first().fill(h.code);
    await screen.getByRole('row', { name: new RegExp(h.code) }).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', h.name)).toBeVisible(LOAD);
    await expect(browser).toHaveURL(new RegExp(`employee=${h.id}`));
    await expect(sheet).toContainText('Working');
    await expect(sheet).toContainText(h.username!);
    for (const tab of ['Record', 'Leave', 'Claims', 'Contracts', 'Position', 'Checklist', 'Discipline', 'Pay', 'Loans', 'Change']) {
      await expect(sheet.getByRole('tab', tab)).toBeVisible();
    }
    await expect(sheet).toContainText('HIRE — CANDIDATE → ACTIVE');
    await expect(sheet).toContainText('uji e2e: first day');
    await expect(sheet.getByRole('row', { name: /^Cikupa/ })).toContainText('open');
  });

  test('HR-05 Contracts tab: the PKWT in force, its window, and the run of fixed terms', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('K'), { kind: 'PKWT', position: 'Staf kontrak' });
    await app.open(`/people?employee=${h.id}#contracts`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('tab', 'Contracts')).toHaveAttribute('aria-selected', 'true', LOAD);
    await expect(sheet.getByRole('row', { name: /PKWT/ })).toContainText('In force');
    await expect(sheet.getByRole('row', { name: /PKWT/ })).toContainText('Staf kontrak · G2');
    await expect(sheet.getByRole('heading', 'Run of fixed terms')).toBeVisible();
    await expect(sheet).toContainText('361');
  });

  test('HR-06 Leave and Claims tabs show the person\'s own requests and claims', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('T'));
    const from = nextWeekday(today(), 4);
    await fileLeave(h.id, { from });
    const claim = await fileClaim(h.id, { amount: 87_000 });
    await submitClaim(claim.claim_id);
    await app.open(`/people?employee=${h.id}#claims`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('row', { name: new RegExp(claim.claim_number) })).toContainText('Rp 87.000', LOAD);
    await sheet.getByRole('tab', 'Leave').tap();
    await expect(sheet).toContainText('Cuti tahunan', LOAD);
  });

  test('HR-07 Discipline tab lists an issued letter and Position tab says nobody placed them yet', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('V'));
    await issueLetter(h.id, { violation: 'Datang terlambat tiga kali' });
    await app.open(`/people?employee=${h.id}#discipline`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('SP 1', LOAD);
    await expect(sheet).toContainText('Datang terlambat tiga kali');
    await expect(sheet).toContainText('Not yet acknowledged by them.');
    await sheet.getByRole('tab', 'Position').tap();
    await expect(sheet).toContainText('Not placed yet: no department, level or manager.');
  });

  test('HR-08 the search finds a person by name as well as by number, and says so when nobody matches', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('N'));
    await app.open('/people');
    const search = screen.getByRole('textbox').first();
    await search.fill(h.name);
    await expect(screen.getByRole('row', { name: new RegExp(h.code) })).toBeVisible(LOAD);
    await search.fill('zzzz-nobody-has-this-name');
    await expect(screen.getByRole('row', { name: new RegExp(h.code) })).toBeHidden(LOAD);
    await expect(screen.getByText('Nobody matches this search and the filters in force.')).toBeVisible();
  });
});
