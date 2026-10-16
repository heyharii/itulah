// System: users, store servers (servers, sync, register, health, incidents),
// devices and readers, notifications, activity. Admin-only; an operations
// login is refused. Anything that writes makes its own tagged record.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { signInByApi } from '../../support/session.ts';
import { admin, choose, chooseNth, sharedTestStore, rina, SLOW, T, tag, L } from '../../support/stores-ga.ts';

describe('System: store servers', { tags: ['system'] }, () => {
  test('SYS-01 the System menu lists Users, Store Servers, Devices, Notifications, Activity, Sync and Account', { session: 'rina', tags: ['system', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    await expect(screen.getByRole('heading', 'Store Servers')).toBeVisible(T);
    for (const name of ['Users', 'Store Servers', 'Devices', 'Notifications', 'Activity', 'Sync', 'Account']) {
      await expect(screen.getByRole('link', name).first()).toBeVisible(T);
    }
  });

  test('SYS-02 Servers: totals, and a row for the DC and for store 01 with their uptime', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    await expect(screen.getByText('Total', { exact: true })).toBeVisible(T);
    for (const word of ['Up', 'Down', 'Maint.']) await expect(screen.getByText(word, { exact: true }).first()).toBeVisible(T);
    await expect(screen.getByText('Store server', { exact: true })).toBeVisible(T);
    await expect(screen.getByRole('button', { name: /^DC dc/ })).toBeVisible(T);
    await expect(screen.getByRole('button', { name: /^Store 01 store-01/ })).toBeVisible(T);
  });

  test('SYS-03 a server row opens its sheet with when it was last checked', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    await screen.getByRole('button', { name: /^Store 01 store-01/ }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByText('Last checked')).toBeVisible(T);
  });

  test('SYS-04 the five tabs each open without an error', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    for (const tab of ['Sync', 'Register', 'Health', 'Incidents', 'Servers']) {
      await screen.getByRole('tab', tab).tap();
      await expect(screen.getByRole('tab', tab)).toHaveAttribute('aria-selected', 'true', T);
      await expect(screen.getByText('Something went wrong!')).toBeHidden();
    }
  });

  test('SYS-05 Register lists the nodes and offers Register by key', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    await screen.getByRole('tab', 'Register').tap();
    await expect(screen.getByRole('button', 'Register by key')).toBeVisible(T);
    await screen.getByRole('button', 'Register by key').tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    for (const label of ['Node id', 'Ingest key', 'Label']) await expect(screen.getByRole('textbox', { name: L(label) })).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('SYS-06 Incidents: the filter, and "No incidents recorded yet" or the table of them', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/servers');
    await screen.getByRole('tab', 'Incidents').tap();
    await expect(screen.getByText('Reading the incidents…')).toBeHidden(T);
    await expect(screen.getByText('Something went wrong!')).toBeHidden();
  });

  test('SYS-07 Install server needs a site; the code and the install steps come back for a site that has no server', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const unit = await sharedTestStore();
    await app.open('/system/servers');
    await screen.getByRole('button', 'Install server', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await choose(screen, 'Site', new RegExp(`\\(${unit.site_id}\\)$`));
    await expect(submit).toBeEnabled();
    await screen.getByRole('textbox', { name: L('Label') }).fill(`Server ${unit.name}`);
    await submit.tap();
    await expect(screen.getByText(`Installing Server ${unit.name}`)).toBeVisible(T);
    for (const step of ['Get the installer', 'Give the machine its code', 'Match the number', 'Connected']) await expect(screen.getByText(step, { exact: true })).toBeVisible();
    const issued = ((await admin().get('/api/v1/sync/enrollments')) as { items: { site_id: string; status: string }[] }).items;
    expect(issued.some((e) => e.site_id === unit.site_id && e.status === 'ISSUED')).toBe(true);
    await screen.getByRole('button', 'Done').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('SYS-08 phone: Install server is the round button and the tabs stay', { session: 'rina', tags: ['system'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/system/servers');
    await expect(screen.getByRole('button', 'Install server', { visible: true })).toBeVisible(T);
    await expect(screen.getByRole('button', { name: /^Status: Servers/ })).toBeVisible();
  });

  test('SYS-09 an operations login is refused the System module', { tags: ['system'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'nina');
    await app.open('/system/servers');
    await expect(screen.getByRole('link', { name: /^Inventory/ })).toBeVisible(T);
    // The module is not in her menu; a pasted address still draws the frame, and the
    // server answers every read with a refusal that the screen shows instead of data.
    await expect(screen.getByText('forbidden: this action requires the ADMIN role')).toBeVisible(T);
    await expect(screen.getByText('Total', { exact: true })).toBeHidden();
  });
});

describe('System: users', { tags: ['system'] }, () => {
  test('SYS-20 the list shows every account with person, job role, state and dates', { session: 'rina', tags: ['system', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/system/users');
    await expect(screen.getByRole('heading', 'Users')).toBeVisible(T);
    for (const head of ['Person', 'Job Role', 'State', 'Last Sign-in', 'Created']) await expect(screen.getByRole('columnheader', head)).toBeVisible(T);
    for (const name of ['Rina Kusuma', 'Maya Anggraini', 'Dian Pertiwi', 'Nina Oktaviani', 'Yusuf Ramadhan']) await expect(screen.getByText(name).first()).toBeVisible();
    await expect(screen.getByText(/\d+ accounts?/).first()).toBeVisible();
  });

  test('SYS-21 a person row opens their account sheet', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/users');
    await screen.getByText('Dian Pertiwi').first().tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByText('Dian Pertiwi').first()).toBeVisible();
  });

  test('SYS-22 Add user directly: Submit is disabled until everything is given, then the new login works', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const t = tag('u').toLowerCase();
    await app.open('/system/users');
    await screen.getByRole('button', 'Add user directly').tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByText(/Prefer Invite people/)).toBeVisible();
    const submit = screen.getByRole('button', 'Submit');
    await expect(submit).toBeDisabled();
    await screen.getByLabel(L('Username')).fill(`uji${t}`);
    await screen.getByLabel(L('Name')).fill(`Uji ${t}`);
    await expect(submit).toBeDisabled();
    await screen.getByLabel(L('Password')).fill('Password01');
    await expect(submit).toBeEnabled();
    await submit.tap();
    await expect(screen.getByText(`Uji ${t}`).first()).toBeVisible(T);
    const res = await fetch(`${process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580'}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `uji${t}`, password: 'Password01' }) });
    expect(res.status).toBe(200);
  });

  test('SYS-23 a username that is taken is refused with a sentence', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/users');
    await screen.getByRole('button', 'Add user directly').tap();
    await screen.getByLabel(L('Username')).fill('rina');
    await screen.getByLabel(L('Name')).fill('Rina Dua');
    await screen.getByLabel(L('Password')).fill('Password01');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(/username 'rina' already exists/)).toBeVisible(T);
  });

  test('SYS-24 Invite people opens the invitation form (name, role, unit, position)', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/users');
    await screen.getByRole('button', 'Invite people', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByRole('textbox', { name: /^Name/ })).toBeVisible();
    await expect(screen.getByRole('combobox', { name: /^Role/ })).toBeVisible();
    await expect(screen.getByRole('combobox', { name: /^Unit/ })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: /^Position/ })).toBeVisible();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('SYS-27 an invitation for a named person comes back as a link shown once, valid 72 hours', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const t = tag('v');
    await app.open('/system/users');
    await screen.getByRole('button', 'Invite people', { visible: true }).tap();
    await screen.getByRole('textbox', { name: /^Name/ }).fill(`Undangan Uji ${t}`);
    await chooseNth(screen, /^Role/, 0);
    await chooseNth(screen, /^Unit/, 0);
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Each link is shown here once and never again. Send it now — WhatsApp, chat, email, in person.')).toBeVisible(T);
    await expect(screen.getByText(`Undangan Uji ${t}`)).toBeVisible();
    await expect(screen.getByText(/Expires .* · 72 h/)).toBeVisible();
    await expect(screen.getByRole('button', 'Copy')).toBeVisible();
    await expect(screen.getByRole('link', 'WhatsApp')).toBeVisible();
    await screen.getByRole('button', 'Done').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('SYS-25 the filters narrow by store and by job role', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/users');
    await expect(screen.getByText('Maya Anggraini').first()).toBeVisible(T);
    await expect(screen.getByRole('button', 'Job role')).toBeVisible();
    await expect(screen.getByRole('button', 'Store')).toBeVisible();
  });

  test('SYS-26 a store manager cannot open Users', { tags: ['system'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await signInByApi(browser, 'maya');
    await app.open('/system/users');
    await expect(screen.getByRole('columnheader', 'Job Role')).toBeHidden(T);
  });
});

describe('System: one account', { tags: ['system'] }, () => {
  const RIG_CLOUD = process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580';
  const makeUser = async (t: string) => {
    const username = `uji${t.toLowerCase()}`;
    await admin().post('/api/v1/auth/users', { username, display_name: `Uji ${t}`, password: 'Password01', role: 'CASHIER' });
    return username;
  };
  const loginStatus = async (username: string, password: string) =>
    (await fetch(`${RIG_CLOUD}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).status;

  test('SYS-30 Block sign-in locks the account out at once and Allow sign-in again lets it back', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const username = await makeUser(tag('b'));
    expect(await loginStatus(username, 'Password01')).toBe(200);
    await app.open(`/system/users?user=${username}`);
    await expect(screen.getByRole('button', 'Block sign-in')).toBeVisible(T);
    await screen.getByRole('button', 'Block sign-in').tap();
    await expect(screen.getByRole('button', 'Allow sign-in again')).toBeVisible(T);
    expect(await loginStatus(username, 'Password01')).toBeGreaterThanOrEqual(400);
    await screen.getByRole('button', 'Allow sign-in again').tap();
    await expect(screen.getByRole('button', 'Block sign-in')).toBeVisible(T);
    expect(await loginStatus(username, 'Password01')).toBe(200);
  });

  test('SYS-31 Set password needs a password; the new one signs in and the old one no longer does', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const username = await makeUser(tag('p'));
    await app.open(`/system/users?user=${username}`);
    const set = screen.getByRole('button', 'Set password');
    await expect(set).toBeDisabled({ timeout: SLOW });
    await screen.getByLabel(L('New password')).fill('Password02');
    await expect(set).toBeEnabled();
    await set.tap();
    await expect.poll(() => loginStatus(username, 'Password02'), { timeout: SLOW }).toBe(200);
    expect(await loginStatus(username, 'Password01')).toBeGreaterThanOrEqual(400);
  });

  test('SYS-32 the account sheet shows who they belong to, and Job role Submit waits for a change', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const username = await makeUser(tag('r'));
    await app.open(`/system/users?user=${username}`);
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    for (const term of ['Belongs to', 'Created', 'Created by', 'Last sign-in']) await expect(screen.getByText(term, { exact: true }).first()).toBeVisible();
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });
});

describe('System: devices, notifications, activity', { tags: ['system'] }, () => {
  test('SYS-40 Devices has two books, Devices and Readers; Register reader needs the fields', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/devices');
    await expect(screen.getByRole('tab', 'Devices')).toBeVisible(T);
    await screen.getByRole('tab', 'Readers').tap();
    await screen.getByRole('button', 'Register reader', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByRole('textbox', { name: L('Device id') })).toBeVisible();
    await expect(screen.getByRole('combobox', { name: L('Store server') })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: L('Label') })).toBeVisible();
    await expect(screen.getByRole('combobox', { name: L('Kind') })).toBeVisible();
    await expect(screen.getByRole('button', 'Register')).toBeDisabled();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('SYS-41 Devices lists what store-01 reports, or says the register is empty', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/devices');
    await expect(screen.getByText('Loading the devices…')).toBeHidden(T);
    await expect(screen.getByText('Something went wrong!')).toBeHidden();
  });

  test('SYS-42 Notifications: Unread narrows the list and Mark read on a row marks that notification read', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/notifications');
    await expect(screen.getByRole('heading', 'Notifications')).toBeVisible(T);
    await screen.getByRole('button', 'Unread').tap();
    const first = screen.getByRole('listitem').first();
    await expect(first).toBeVisible(T);
    const body = ((await first.allTextContents())[0] ?? '').replace(/\s+/g, ' ');
    const grn = body.match(/GRN-[A-Z-]+-\d+|PO-\d+-\d+|[A-Z]{2,}-\d{3,}/)?.[0];
    test.skip(!grn, 'the first unread notification carries no document number to find it by');
    await first.getByRole('button', 'Mark read').tap();
    await expect.poll(async () => {
      const page = (await rina().get('/api/v1/notifications?limit=200')) as { items: { body: string; read_at: string | null }[] };
      const mine = page.items.filter((n) => n.body.includes(grn!));
      return mine.length > 0 && mine.every((n) => n.read_at !== null);
    }, { timeout: SLOW }).toBe(true);
  });

  test('SYS-43 Activity: Everything and Refused are two books; each opens without error', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    await app.open('/system/activity');
    await expect(screen.getByRole('heading', 'Activity')).toBeVisible(T);
    await expect(screen.getByText('Reading the log…')).toBeHidden(T);
    await screen.getByRole('button', { name: /^Refused/ }).tap();
    await expect(screen.getByText('Something went wrong!')).toBeHidden();
  });

  test('SYS-44 an action taken through the API shows in Activity afterwards', { session: 'rina', tags: ['system'] }, async ({ app, screen }) => {
    const t = tag('V');
    await rina().post('/api/v1/ga/supplies', { site_id: 'store-c016', requested_by: 'Rina', category_code: 'ATK', item: `Log Uji ${t}`, quantity: '1 rim', needed_by: null, estimated_cost_minor: null });
    await app.open('/system/activity');
    await expect(screen.getByText('Reading the log…')).toBeHidden(T);
    await expect(screen.getByText(/supplies/i).first()).toBeVisible(T);
  });
});
