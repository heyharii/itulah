// People › Employee List › the employee sheet's Change tab, Pay tab and the Add employee sheet.
// Every write is made through the sheet; the API proves what was stored.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, addDays, asUser, directoryRow, employee, hire, nik, pickDay, pickOne, selectOne, tag, today } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };
const change = (id: string) => `/people?employee=${id}#change`;

async function chooseChange(screen: any, what: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await selectOne(screen, 'What are you changing?', what);
}

describe('People: employee records', { tags: ['people'] }, () => {
  test('HR-20 Add employee: the whole form creates an active person with contract, posting and pay', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen, browser }) => {
    const t = tag('A');
    const joined = addDays(today(), -30);
    await app.open('/people?addEmployee=true');
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', 'Employee number (required)').fill(`${t}-E`);
    await sheet.getByRole('textbox', 'Full name (required)').fill(`Uji ${t}`);
    await sheet.getByRole('textbox', 'NIK (required)').fill(nik());
    await pickDay(screen, /^Date of birth/, '1994-03-21');
    await sheet.getByRole('textbox', 'Address (required)').fill('Jl. Merdeka No. 9, Bandung');
    await pickDay(screen, /^Join date/, joined);
    await selectOne(screen, /^Unit/, /Cikupa/);
    await selectOne(screen, /^Employment status/, /PKWTT|permanent/i);
    await sheet.getByRole('textbox', 'Job position (required)').fill('Kasir senior');
    await sheet.getByRole('textbox', 'Grade').fill('G3');
    await sheet.getByRole('textbox', /^Base salary/).fill('6500000');
    await sheet.getByRole('button', 'Add employee').tap();
    // The form closes into the new person's own sheet.
    await expect(screen.getByRole('dialog')).toContainText(`${t}-E`, LOAD);
    await expect(browser).toHaveURL(/employee=emp_/);
    const row = await directoryRow(`${t}-E`);
    expect(row).toMatchObject({ status: 'ACTIVE', full_name: `Uji ${t}`, unit_id: 'store-01', contract_kind: 'PKWTT', position: 'Kasir senior' });
    const pay = await HR().get(`/api/v1/employees/${row!.employee_id}/pay`);
    expect(pay[0].base_minor).toBe(6_500_000);
  });

  test('HR-21 Suspend then Reinstate: status follows and the login closes with the suspension', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('U'), { login: { role: 'CASHIER' } });
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Employment status');
    await selectOne(screen, 'Transition', 'SUSPEND');
    await sheet.getByRole('textbox', /^Reason/).fill('Pemeriksaan internal');
    await sheet.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await employee(h.id)).status, { timeout: 20_000 }).toBe('SUSPENDED');
    expect((await employee(h.id)).account?.active).toBe(false);
    // The login is shut: the account cannot sign in any more.
    let signedIn = true;
    try {
      await asUser(h.username!).get('/api/v1/auth/me');
    } catch {
      signedIn = false;
    }
    expect(signedIn).toBe(false);
    await selectOne(screen, 'Transition', 'REINSTATE');
    await sheet.getByRole('textbox', /^Reason/).fill('Pemeriksaan selesai, tidak terbukti');
    await sheet.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await employee(h.id)).status, { timeout: 20_000 }).toBe('ACTIVE');
  });

  test('HR-22 Terminate: the person is Terminated, the Exit tab appears, and the login stays closed', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('X'), { login: { role: 'CASHIER' } });
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Employment status');
    await selectOne(screen, 'Transition', 'TERMINATE');
    await sheet.getByRole('textbox', /^Reason/).fill('Mengundurkan diri');
    await sheet.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await employee(h.id)).status, { timeout: 20_000 }).toBe('TERMINATED');
    await expect(sheet.getByRole('tab', 'Exit')).toBeVisible(LOAD);
    expect((await employee(h.id)).account?.active).toBe(false);
    expect((await employee(h.id)).selectable).toBe(false);
  });

  test('HR-23 Amend personal data: one field per amendment, with its trail', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('P'));
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Amend personal data');
    await selectOne(screen, 'Field', 'address');
    await sheet.getByRole('textbox', /^New value/).fill('Jl. Pindah No. 77, Jakarta');
    await sheet.getByRole('textbox', /^Reason/).fill('Pindah rumah, surat keterangan domisili');
    await sheet.getByRole('button', 'Amend').tap();
    await expect(sheet.getByRole('heading', 'Amendments')).toBeVisible(LOAD);
    const data = await HR().get(`/api/v1/employees/${h.id}/personal-data`);
    expect(data.address).toBe('Jl. Pindah No. 77, Jakarta');
    expect(data.amendments.at(-1)).toMatchObject({ field: 'ADDRESS', reason: 'Pindah rumah, surat keterangan domisili' });
  });

  test('HR-24 Add a contract: a renewal as PKWTT becomes the one in force', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    // The first fixed term ended 40 days ago, so a renewal can start today without overlapping it.
    const h = await hire(tag('R'), { kind: 'PKWT', joined: addDays(today(), -400) });
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Add a contract');
    await selectOne(screen, 'Kind', /PKWTT/);
    await pickDay(screen, /^Starts on/, today());
    await sheet.getByRole('textbox', /^Position/).fill('Kepala shift');
    await sheet.getByRole('textbox', /^Grade/).fill('G4');
    await sheet.getByRole('textbox', /^Reason/).fill('Diangkat tetap');
    await sheet.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await HR().get(`/api/v1/employees/${h.id}/contracts`)).contracts.length, { timeout: 20_000 }).toBe(2);
    const contracts = (await HR().get(`/api/v1/employees/${h.id}/contracts`)).contracts;
    expect(contracts.map((c: any) => c.kind)).toContain('PKWTT'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(contracts.find((c: any) => c.kind === 'PKWTT')).toMatchObject({ position: 'Kepala shift', grade: 'G4', ends_on: null }); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-25 a PKWT contract without an end date is refused by the form', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('Z'));
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Add a contract');
    await selectOne(screen, 'Kind', /PKWT —/);
    await sheet.getByRole('textbox', /^Position/).fill('Staf');
    await sheet.getByRole('textbox', /^Grade/).fill('G1');
    await sheet.getByRole('textbox', /^Reason/).fill('Uji');
    await expect(sheet.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('HR-26 Correct the employee number: the old one is kept in the number corrections', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('W'));
    const fresh = `${h.t}-FIX`;
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Correct the employee number');
    await sheet.getByRole('textbox', /^New employee number/).fill(fresh);
    await sheet.getByRole('textbox', /^Reason/).fill('Salah ketik saat mendaftar');
    await sheet.getByRole('button', 'Correct the number').tap();
    await expect.poll(async () => (await employee(h.id)).employee_code, { timeout: 20_000 }).toBe(fresh);
    expect((await employee(h.id)).code_history[0]).toMatchObject({ from: h.code, to: fresh });
  });

  test('HR-27 The login: issue one from the sheet, then release it', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('G'));
    const username = `g${h.t.toLowerCase()}`;
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'The login');
    await sheet.getByText('Issue a new one').tap();
    await sheet.getByRole('textbox', /^Username/).fill(username);
    await sheet.getByRole('textbox', /^Display name/).fill(h.name);
    await sheet.getByLabel(/^Password/).fill('Password01');
    await sheet.getByRole('textbox', /^Reason/).fill('Karyawan baru butuh akun');
    await sheet.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await employee(h.id)).account?.username, { timeout: 20_000 }).toBe(username);
    expect((await asUser(username).get('/api/v1/auth/me')).username).toBe(username);
    await expect(sheet.getByText('Release the login')).toBeVisible(LOAD);
    await sheet.getByRole('textbox', /^Reason/).fill('Akun dipindahkan');
    await sheet.getByRole('button', 'Release the login').tap();
    await expect.poll(async () => (await employee(h.id)).account, { timeout: 20_000 }).toBeNull();
  });

  test('HR-28 Where they are posted: a second, open posting is recorded from a date', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    // A posting with no other open one: start from a person whose only posting ended.
    const h = await hire(tag('O'), { postedUntil: addDays(today(), -1) });
    await app.open(change(h.id));
    const sheet = screen.getByRole('dialog');
    await chooseChange(screen, 'Where they are posted');
    await selectOne(screen, /^Place/, /Head Office/);
    await pickDay(screen, /^From/, today());
    await sheet.getByRole('textbox', /^Reason/).fill('Dipindah ke kantor pusat');
    await sheet.getByRole('button', 'Post them there').tap();
    await expect.poll(async () => (await employee(h.id)).assignments.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    expect((await employee(h.id)).assignments.some((a: any) => a.unit_id === 'ho')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('People: pay and payroll identity (employee sheet › Pay)', { tags: ['people'] }, () => {
  test('HR-30 Agree new pay: a raise supersedes the old agreement from its own date', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('Q'), { base: 5_000_000 });
    await app.open(`/people?employee=${h.id}#pay`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Agreements')).toBeVisible(LOAD);
    await expect(sheet).toContainText('Rp 5.000.000 base');
    await pickDay(screen, /^Effective from/, addDays(today(), 10));
    await sheet.getByRole('spinbutton', /^Base/).fill('5750000');
    await sheet.getByRole('textbox', /^Why/).first().fill('Kenaikan tahunan');
    await sheet.getByRole('button', 'Agree it').tap();
    await expect.poll(async () => (await HR().get(`/api/v1/employees/${h.id}/pay`)).length, { timeout: 20_000 }).toBe(2);
    await expect(sheet).toContainText('Rp 5.750.000 base');
  });

  test('HR-31 Tax and BPJS: PTKP status is changed with a reason', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('I'), { identity: true });
    await app.open(`/people?employee=${h.id}#pay`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Tax and BPJS')).toBeVisible(LOAD);
    await selectOne(screen, /^Value/, 'K/1');
    await sheet.getByRole('textbox', /^Why/).nth(1).fill('Menikah, satu tanggungan');
    await sheet.getByRole('button', 'Save').tap();
    await expect(sheet).toContainText('K/1', LOAD);
    const ident = await HR().get(`/api/v1/employees/${h.id}/payroll-identity`);
    expect(JSON.stringify(ident)).toContain('K/1');
  });

  test('HR-32 Where the money goes: bank, account number and holder are recorded, the number shown masked', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('M'));
    await app.open(`/people?employee=${h.id}#pay`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'Where the money goes')).toBeVisible(LOAD);
    await sheet.getByRole('textbox', /^Bank/).fill('Mandiri');
    await sheet.getByRole('textbox', /^Account number/).fill('1234567890');
    await sheet.getByRole('textbox', /^Account holder/).fill(h.name);
    await sheet.getByRole('textbox', /^Why/).last().fill('Rekening gaji baru');
    await sheet.getByRole('button', 'Record it').tap();
    await expect(sheet).toContainText('••••••7890', LOAD);
    await expect(sheet).toContainText('Mandiri');
  });
});
