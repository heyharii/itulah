// Stores › open a store, and the life of a store that is still getting ready:
// the Open-store sheet (also raised from Locations and the setup wizard), the
// manager invite links, the checklist, the server install code and the seats.
// Every store this file makes is named `Uji <tag>` and stays GETTING_READY, so
// none of the 16 stores other suites use is touched.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { installAndClaim, resetServer, sharedTestStore, SLOW, storeDetailOf, storeList, admin, type StoreRow, L } from '../../support/stores-ga.ts';
import { RIG } from '../../support/base.ts';
import { ApiError, tag } from '../../support/rig.ts';

/** One getting-ready store for the branches of this file (found again on later runs). */
const sharedStore = () => sharedTestStore();

describe('Stores: the Open store sheet', { tags: ['stores'] }, () => {
  test('STO-30 Open store stays disabled until every named store has a manager; Cancel closes it', { session: 'rina', tags: ['stores', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/stores');
    await screen.getByRole('button', 'Open a new store', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    const open = screen.getByRole('button', 'Open store');
    await expect(open).toBeDisabled();
    await screen.getByLabel(/^Store name/).fill('Uji Kosong');
    await expect(open).toBeDisabled(); // no manager yet
    await screen.getByLabel(/^Manager/).fill('Manajer Uji');
    await expect(open).toBeEnabled();
    await screen.getByLabel(/^Manager/).clear();
    await expect(open).toBeDisabled();
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('STO-31 Enter in a name adds a row, two named stores change the button to "Open 2 stores", Remove drops a row', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores');
    await screen.getByRole('button', 'Open a new store', { visible: true }).tap();
    const names = screen.getByLabel(/^Store name/);
    await names.fill('Uji Satu');
    await names.press('Enter');
    await expect(screen.getByLabel(/^Store name/)).toHaveCount(2);
    await screen.getByLabel(/^Store name/).last().fill('Uji Dua');
    const managers = screen.getByLabel(/^Manager/);
    await managers.first().fill('Manajer Satu');
    await managers.last().fill('Manajer Dua');
    await expect(screen.getByRole('button', 'Open 2 stores')).toBeEnabled();
    await screen.getByRole('button', { name: /^Remove Uji Dua/ }).tap();
    await expect(screen.getByLabel(/^Store name/)).toHaveCount(1);
    await expect(screen.getByRole('button', 'Open store')).toBeEnabled();
    await screen.getByRole('button', 'Cancel').tap();
    // Nothing was made.
    expect((await storeList()).items.some((s) => /^Uji (Satu|Dua)$/.test(s.name))).toBe(false);
  });

  test('STO-32 a pasted list (name, city, manager per line) becomes one row per store', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await app.open('/stores');
    await screen.getByRole('button', 'Open a new store', { visible: true }).tap();
    await expect(screen.getByLabel(/^Store name/)).toBeVisible({ timeout: SLOW });
    await browser.evaluate(() => {
      const input = document.querySelector('input[aria-label^="Store name"]') as HTMLInputElement;
      input.focus();
      const data = new DataTransfer();
      data.setData('text/plain', 'Uji Paste A\tBandung\tManajer A\nUji Paste B\tGarut\tManajer B');
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(screen.getByLabel(/^Store name/)).toHaveCount(2);
    await expect(screen.getByDisplayValue('Uji Paste B')).toBeVisible();
    await expect(screen.getByDisplayValue('Manajer A')).toBeVisible();
    await expect(screen.getByRole('button', 'Open 2 stores')).toBeEnabled();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('STO-33 opening a store shows its manager link once, a saved note and a Getting-ready row', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const t = tag('U');
    const before = (await storeList()).items.length;
    await app.open('/stores');
    await screen.getByRole('button', 'Open a new store', { visible: true }).tap();
    await screen.getByLabel(/^Store name/).fill(`Uji ${t}`);
    await screen.getByLabel(/^City/).fill('Bandung');
    await screen.getByLabel(/^Manager/).fill(`Manajer ${t}`);
    await screen.getByRole('button', 'Open store').tap();
    // The saved note closes itself after three seconds: look at it first.
    await expect(screen.getByText(/^Store C\d{3} created$/)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Send these links to your store managers. Each is shown here once and never again.')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Manajer ${t}`)).toBeVisible();
    await expect(screen.getByText(/Expires in 72 h/)).toBeVisible();
    await expect(screen.getByRole('button', 'Copy')).toBeVisible();
    await expect(screen.getByRole('link', 'WhatsApp')).toBeVisible();
    // Server side: one more store, getting ready, with a shop site.
    const { items } = await storeList();
    expect(items.length).toBe(before + 1);
    const made = items.find((s) => s.name === `Uji ${t}`)!;
    expect(made.status).toBe('GETTING_READY');
    expect(made.site_id).toBeTruthy();
    await screen.getByRole('button', 'Done').tap();
    const row = screen.getByRole('link', { name: new RegExp(`Uji ${t}`) });
    await expect(row).toBeVisible({ timeout: SLOW });
    await expect(row).toContainText('Getting ready');
    await expect(row).toContainText('Not installed');
  });
});

describe('Stores: a store that is still getting ready', { tags: ['stores'] }, () => {
  test('STO-34 Overview shows the checklist and a disabled Open store with the reason beside it', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedStore();
    const d = await storeDetailOf(s.unit_id);
    expect(d.can_open).toBe(false);
    await app.open(`/stores/${s.unit_id}`);
    await expect(screen.getByRole('heading', s.name)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Getting ready', { exact: true })).toBeVisible();
    await expect(screen.getByText('Ready to open')).toBeVisible();
    for (const check of d.checks as { title: string }[]) await expect(screen.getByText(check.title, { exact: false }).first()).toBeVisible();
    await expect(screen.getByRole('button', { name: /^Open store/ })).toBeDisabled();
    await expect(screen.getByText('Available once every check marked required above is green.')).toBeVisible();
  });

  test('STO-35 the API refuses to open it and names what is unmet (409)', { tags: ['stores'] }, async () => {
    const s = await sharedStore();
    const err = await admin().post(`/api/v1/stores/${s.unit_id}/open`, {}).catch((e) => e as ApiError);
    expect(err instanceof ApiError).toBe(true);
    expect((err as ApiError).status).toBe(409);
    expect(JSON.stringify((err as ApiError).body).length).toBeGreaterThan(20);
    expect((await storeDetailOf(s.unit_id)).store.status).toBe('GETTING_READY');
  });

  test('STO-36 Server tab: Install server issues a code and a QR, "Issue a new code" replaces it', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedStore();
    await resetServer(s.unit_id);
    await app.open(`/stores/${s.unit_id}`);
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText('Not installed', { exact: true })).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Install server').tap();
    await expect(screen.getByText('Activation code')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('img', 'QR code carrying the install code')).toBeVisible();
    await expect(screen.getByText(/valid until/)).toBeVisible();
    await expect(screen.getByText('Waiting to be installed', { exact: true })).toBeVisible();
    const codeBox = screen.getByText(/^[A-Z0-9]{4,}-[A-Z0-9]{4,}$/);
    const first = (await codeBox.textContent())?.trim();
    expect((await storeDetailOf(s.unit_id)).store.server.state).toBe('WAITING_TO_INSTALL');
    await screen.getByRole('button', 'Issue a new code').tap();
    await expect.poll(async () => (await codeBox.textContent())?.trim(), { timeout: SLOW, message: 'the new code replaces the old one on the page' }).not.toBe(first);
  });

  test('STO-37 after a reload the code is gone: the page says it was shown once', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedStore();
    const d = await storeDetailOf(s.unit_id);
    test.skip(d.store.server.state !== 'WAITING_TO_INSTALL', 'STO-36 has not issued a code in this run');
    await app.open(`/stores/${s.unit_id}`);
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText(/The code was shown once when it was issued/)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Issue a new code')).toBeVisible();
  });

  test('STO-38 Devices tab: set the seats to 3, the line and the API follow; 0 and 51 cannot be submitted', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedStore();
    await app.open(`/stores/${s.unit_id}`);
    await screen.getByRole('tab', 'Devices').tap();
    const field = screen.getByLabel(L('Number of till seats'));
    await expect(field).toBeVisible({ timeout: SLOW });
    const submit = screen.getByRole('button', 'Submit');
    await field.fill('0');
    await expect(submit).toBeDisabled();
    await field.fill('51');
    await expect(submit).toBeDisabled();
    // The store lives across runs: take the other of 3 and 4 than it has now.
    const now = (await storeDetailOf(s.unit_id)).store.tills.seats as number;
    const want = now === 3 ? 4 : 3;
    await field.fill(String(want));
    await expect(submit).toBeEnabled();
    await submit.tap();
    await expect(screen.getByText(new RegExp(`Till 1 to Till ${want}`))).toBeVisible({ timeout: SLOW });
    expect((await storeDetailOf(s.unit_id)).store.tills.seats).toBe(want);
  });

  test('STO-39 Team tab: no PIC and no one posted yet', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedStore();
    await app.open(`/stores/${s.unit_id}`);
    await screen.getByRole('tab', 'Team').tap();
    await expect(screen.getByText('Nobody is appointed yet.')).toBeVisible({ timeout: SLOW });
  });

  test('STO-40 a batch with a store that has no manager is refused whole (422) and makes nothing', { tags: ['stores'] }, async () => {
    const before = (await storeList()).items.length;
    const err = await admin().post('/api/v1/setup/stores', { stores: [{ name: `Uji Tanpa ${tag('X')}`, city: 'Bandung', manager: { name: '' } }] }).catch((e) => e as ApiError);
    expect(err instanceof ApiError).toBe(true);
    expect([400, 422]).toContain((err as ApiError).status);
    expect((await storeList()).items.length).toBe(before);
  });

  test('STO-41 phone: a getting-ready store is a card whose figure is the steps done', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    const s = await sharedStore();
    await browser.setViewport(viewports.phone);
    await app.open('/stores');
    await expect(screen.getByText(s.name).first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('steps done').first()).toBeVisible();
    await expect(screen.getByText(`${s.readiness.done}/${s.readiness.total}`).first()).toBeVisible();
  });
});

describe('Stores: a server that has claimed its code', { tags: ['stores'] }, () => {
  test('STO-70 the Server tab shows the machine and the verification number, and Reject sends the store back to Not installed', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const t = tag('K');
    const unit = await sharedTestStore();
    const { answer, hostname } = await installAndClaim(unit.unit_id, t);
    await app.open(`/stores/${unit.unit_id}`);
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText('Waiting for approval', { exact: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(new RegExp(hostname))).toBeVisible({ timeout: SLOW });
    const v = String(answer.verification);
    await expect(screen.getByText(`${v.slice(0, 3)} ${v.slice(3)}`)).toBeVisible();
    await expect(screen.getByText(/Ask the store to read the number on its screen/)).toBeVisible();
    await expect(screen.getByRole('button', 'The numbers match — approve')).toBeVisible();
    await screen.getByRole('button', 'Reject').tap();
    await expect.poll(async () => (await storeDetailOf(unit.unit_id)).store.server.state, { timeout: SLOW }).toBe('NOT_INSTALLED');
    await expect(screen.getByRole('button', 'Install server')).toBeVisible({ timeout: SLOW });
  });

  test('STO-71 the claim is also a card on System › Store Servers › Register, with Refuse', { session: 'rina', tags: ['stores', 'system'] }, async ({ app, screen }) => {
    const t = tag('J');
    const unit = await sharedTestStore();
    const { hostname } = await installAndClaim(unit.unit_id, t);
    await app.open('/system/servers');
    await screen.getByRole('tab', 'Register').tap();
    await expect(screen.getByText(new RegExp(hostname))).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Waiting for approval', { exact: true }).first()).toBeVisible();
    await screen.getByRole('button', 'Refuse').first().tap();
    await expect.poll(async () => (await storeDetailOf(unit.unit_id)).store.server.state, { timeout: SLOW }).toBe('NOT_INSTALLED');
  });

  test('STO-72 a code that was never issued is not claimable', { tags: ['stores'] }, async () => {
    const res = await fetch(`${RIG.cloud}/api/v1/sync/enroll/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'NOPE0-NOPE0', key_sha256: 'a'.repeat(64), machine: {} }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
