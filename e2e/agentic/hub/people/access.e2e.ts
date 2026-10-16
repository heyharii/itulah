// People › Settings · Access: Job Roles, Invitations (link-only), and /join/{token}.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, asUser, employee, invitations, invite, tokenOf, tag } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BUILTIN = ['OWNER', 'ADMIN', 'FINANCE', 'MERCHANDISE', 'PROCUREMENT', 'OPERATIONS', 'INVENTORY', 'STORE_MANAGER', 'STORE_SUPERVISOR', 'CASHIER', 'STORE_STAFF', 'MARKETING', 'HR', 'GA', 'AUDITOR', 'IT'];

describe('People: job roles', { tags: ['people'] }, () => {
  test('HR-40 Job Roles lists the 16 built-in roles, each with its rung, holders and sections', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/people/job-roles');
    await expect(screen.getByRole('heading', 'Job Roles')).toBeVisible(LOAD);
    const api = (await HR().get('/api/v1/roles')).items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const code of BUILTIN) {
      const role = api.find((r) => r.code === code);
      expect(role?.builtin, code).toBe(true);
      await expect(screen.getByRole('button', { name: new RegExp(`^${esc(role.name)} ${code} Built in`) })).toBeVisible(LOAD);
    }
    // Sections are shown per role: HR sees People and Reports; a cashier sees none.
    await expect(screen.getByRole('button', { name: /^HR HR Built in/ })).toContainText('People');
    await expect(screen.getByRole('button', { name: /^Cashier CASHIER Built in/ })).toContainText('No sections');
    await expect(screen.getByRole('button', { name: /^Auditor \(read-only\) AUDITOR/ })).toContainText('Finance');
  });

  test('HR-41 a built-in role opened from the list has its sections ticked and cannot be deleted', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/job-roles');
    await screen.getByRole('button', { name: /^HR HR Built in/ }).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'HR — HR')).toBeVisible(LOAD);
    await expect(sheet.getByRole('checkbox', 'People')).toBeChecked();
    await expect(sheet.getByRole('checkbox', 'Reports')).toBeChecked();
    await expect(sheet.getByRole('checkbox', 'Finance')).not.toBeChecked();
    await expect(sheet.getByText('Built in — it can be edited but not deleted.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Delete')).toBeHidden();
  });

  test('HR-41b the same role opened from its link (?role=HR) shows its real name, rung and sections', { session: 'rina', tags: ['people', 'bug'] }, async ({ app, screen }) => {
    // RoleSheet seeds its form with useState(role?.name …) while the roles list is still loading, and
    // key={role.value} does not change when the list arrives: the form stays blank (Name empty, rung CASHIER,
    // no section ticked) and Submit would write that blank over the role.
    await app.open('/people/job-roles?role=HR');
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', 'HR — HR')).toBeVisible(LOAD);
    await expect(sheet.getByRole('textbox', /^Name/)).toHaveValue('HR');
    await expect(sheet.getByRole('checkbox', 'People')).toBeChecked();
  });

  test('HR-42 a role of our own: edit its sections from the sheet, then delete it', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const code = `ZT${tag('')}`.toUpperCase();
    await HR().call('PUT', `/api/v1/roles/${code}`, { name: `Uji ${code}`, rung: 'CASHIER', sections: [], description: 'Peran uji e2e' });
    await app.open(`/people/job-roles?role=${code}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', `Uji ${code} — ${code}`)).toBeVisible(LOAD);
    await sheet.getByRole('textbox', /^Name/).fill(`Uji peran ${code}`);
    await sheet.getByRole('checkbox', 'People').check();
    await sheet.getByRole('checkbox', 'GA').check();
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    const role = ((await HR().get('/api/v1/roles')).items as any[]).find((r) => r.code === code); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(role).toMatchObject({ name: `Uji peran ${code}`, builtin: false, holders: 0 });
    expect([...role.sections].sort()).toEqual(['ga', 'people']);
    await app.open(`/people/job-roles?role=${code}`);
    await screen.getByRole('dialog').getByRole('button', 'Delete').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    expect(((await HR().get('/api/v1/roles')).items as any[]).some((r) => r.code === code)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('People: invitations (link only)', { tags: ['people'] }, () => {
  test('HR-43 Invite people: the sheet issues one link per person and shows it once', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('V');
    await app.open('/people/invitations?invite=true');
    const sheet = screen.getByRole('dialog');
    await sheet.getByRole('textbox', 'Name (required)').fill(`Calon ${t}`);
    await sheet.getByRole('combobox', 'Role (required)').tap();
    await screen.getByRole('option', 'Cashier').first().tap();
    await sheet.getByRole('combobox', 'Unit (required)').tap();
    await screen.getByRole('option', /Cikupa/).first().tap();
    await sheet.getByRole('textbox', 'Position').fill('Kasir pagi');
    await sheet.getByRole('button', 'Submit').tap();
    await expect(sheet.getByRole('heading', 'Send these links')).toBeVisible(LOAD);
    await expect(sheet).toContainText(`Calon ${t}`);
    await expect(sheet).toContainText('/join/');
    await expect(sheet.getByRole('button', 'Copy')).toBeVisible();
    const pending = (await invitations('PENDING')).find((i) => i.name === `Calon ${t}`);
    expect(pending).toMatchObject({ role_code: 'CASHIER', unit_id: 'store-01', position: 'Kasir pagi', status: 'PENDING' });
    // Link-only: no password was set, and the person has no login until they accept.
    expect((await employee(pending!.employee_id)).account).toBeNull();
  });

  test('HR-44 Revoke on a pending row: it moves to Revoked and the link stops working', { session: 'rina', tags: ['people'] }, async ({ app, screen, browser }) => {
    const t = tag('K');
    const issued = await invite(`Cabut ${t}`);
    await app.open('/people/invitations');
    await expect(screen.getByText(`Cabut ${t}`)).toBeVisible(LOAD);
    await browser.locator(`xpath=//b[normalize-space()='Cabut ${t}']/ancestor::div[contains(@class,'flex-wrap')][1]//button[normalize-space()='Revoke']`).tap();
    await expect.poll(async () => (await invitations('REVOKED')).some((i) => i.invitation_id === issued.invitation_id), { timeout: 20_000 }).toBe(true);
    await screen.getByRole('tab', 'Revoked').tap();
    await expect(screen.getByText(`Cabut ${t}`)).toBeVisible(LOAD);
    const res = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/invitations/accept/${tokenOf(issued.link)}`);
    expect(res.ok).toBe(false);
  });

  test('HR-45 Renew issues a fresh link and the old one stops working', { session: 'rina', tags: ['people'] }, async ({ app, screen, browser }) => {
    const t = tag('E');
    const issued = await invite(`Perbarui ${t}`);
    const base = process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580';
    expect((await fetch(`${base}/api/v1/invitations/accept/${tokenOf(issued.link)}`)).ok).toBe(true);
    await app.open('/people/invitations');
    await expect(screen.getByText(`Perbarui ${t}`)).toBeVisible(LOAD);
    await browser.locator(`xpath=//b[normalize-space()='Perbarui ${t}']/ancestor::div[contains(@class,'flex-wrap')][1]//button[normalize-space()='Renew']`).tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('heading', `Renew Perbarui ${t}’s link`)).toBeVisible();
    await sheet.getByRole('button', 'Renew link').tap();
    await expect(sheet).toContainText('This link is shown once.', LOAD);
    await expect(sheet).toContainText('/join/');
    expect((await fetch(`${base}/api/v1/invitations/accept/${tokenOf(issued.link)}`)).ok).toBe(false);
  });

  test('HR-46 the Pending list shows who was invited as what, and where', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const t = tag('J');
    await invite(`Daftar ${t}`, { role: 'STORE_MANAGER', unit: 'store-01', position: 'Calon kepala toko' });
    await app.open('/people/invitations');
    await expect(screen.getByRole('tab', 'Pending')).toHaveAttribute('aria-selected', 'true', LOAD);
    await expect(screen.getByText(`Daftar ${t}`)).toBeVisible(LOAD);
    await expect(screen.getByText(/Store manager · Cikupa · Calon kepala toko/).first()).toBeVisible();
  });
});

describe('People: accepting an invitation (/join/{token})', { tags: ['people'] }, () => {
  test('HR-47 the join page greets the invitee, takes a username and password and signs them in', { tags: ['people', 'smoke'] }, async ({ app, screen, browser }) => {
    const t = tag('G');
    const issued = await invite(`Gabung ${t}`, { role: 'CASHIER', unit: 'store-01', position: 'Kasir baru' });
    const token = tokenOf(issued.link); // minted by the app, read from the API response
    await app.open(`/join/${token}`);
    await expect(screen.getByText(/^Welcome to /)).toBeVisible(LOAD);
    await expect(screen.getByText(`Gabung ${t}`)).toBeVisible();
    await expect(screen.getByText('Cashier')).toBeVisible();
    await expect(screen.getByText('Cikupa')).toBeVisible();
    const username = `gb${t.toLowerCase()}`;
    await screen.getByRole('textbox', /^Username/).fill(username);
    await screen.getByLabel(/^Password/).fill('Password01');
    await screen.getByLabel(/^Confirm password/).fill('Password01');
    await screen.getByRole('button', 'Set password and sign in').tap();
    await expect(browser).not.toHaveURL(/\/join\//, LOAD);
    const accepted = (await invitations('ACCEPTED')).find((i) => i.invitation_id === issued.invitation_id);
    expect(accepted).toMatchObject({ status: 'ACCEPTED', username });
    const me = await asUser(username).get('/api/v1/auth/me');
    expect(me).toMatchObject({ username, role_code: 'CASHIER' });
    // A used link cannot be used twice.
    const again = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/invitations/accept/${token}`);
    expect(again.ok).toBe(false);
  });

  test('HR-48 two passwords that differ keep the button disabled and say so', { tags: ['people'] }, async ({ app, screen }) => {
    const issued = await invite(`Beda ${tag('D')}`);
    await app.open(`/join/${tokenOf(issued.link)}`);
    await expect(screen.getByText(/^Welcome to /)).toBeVisible(LOAD);
    await screen.getByLabel(/^Password/).fill('Password01');
    await screen.getByLabel(/^Confirm password/).fill('Password02');
    await expect(screen.getByText('The two do not match.')).toBeVisible();
    await expect(screen.getByRole('button', 'Set password and sign in')).toBeDisabled();
  });

  test('HR-49 a revoked or unknown link shows the server\'s sentence and asks for a new one', { tags: ['people'] }, async ({ app, screen }) => {
    const issued = await invite(`Salah ${tag('S')}`);
    await HR().post(`/api/v1/invitations/${issued.invitation_id}/revoke`, {});
    await app.open(`/join/${tokenOf(issued.link)}`);
    await expect(screen.getByRole('heading', 'You’ve been invited')).toBeVisible(LOAD);
    await expect(screen.getByText('Ask your admin for a new link.')).toBeVisible(LOAD);
    await app.open('/join/not-a-real-token-0000000000000000000000000');
    await expect(screen.getByText('Ask your admin for a new link.')).toBeVisible(LOAD);
  });
});
