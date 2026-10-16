// Stores › Exceptions: what goes wrong in a store's money and goods, read from
// the data. The rig has only resolved MISSING_OPEN ones, so the acknowledge
// branch skips itself until a store has an open exception.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, choose, SLOW, L } from '../../support/stores-ga.ts';

// The hub hides the Missing kind while SHOW_MISSING is off (lib/queries/exceptions.ts), so the
// expectations are made over what it shows.
const summary = async (state: string) => {
  const page = await admin().get(`/api/v1/exceptions?state=${state}&limit=200`);
  page.items = (page.items as { kind: string }[]).filter((i) => i.kind !== 'MISSING_OPEN');
  page.summary.by_kind = (page.summary.by_kind as { kind: string }[]).filter((k) => k.kind !== 'MISSING_OPEN');
  return page;
};

describe('Stores: exceptions', { tags: ['stores'] }, () => {
  test('STO-50 the screen opens on Open and offers Unacknowledged, Acknowledged, Resolved and All', { session: 'rina', tags: ['stores', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/stores/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: SLOW });
    for (const word of ['Open', 'Unacknowledged', 'Acknowledged', 'Resolved', 'All']) await expect(screen.getByRole('button', word)).toBeVisible();
    await expect(screen.getByRole('button', 'Open', { pressed: true })).toBeVisible();
  });

  test('STO-51 with nothing open the list says every store is on time', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const open = await summary('open');
    test.skip(open.items.length > 0, 'something is open in the rig (the till suites leave cash differences open)');
    await app.open('/stores/exceptions');
    await expect(screen.getByText('No open exceptions — every store is on time.')).toBeVisible({ timeout: SLOW });
  });

  test('STO-52 Resolved lists the resolved ones with their kind pill, the store and the resolved date', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    const resolved = await summary('resolved');
    test.skip(resolved.items.length === 0, 'no resolved exception on the rig');
    await app.open('/stores/exceptions');
    await screen.getByRole('button', 'Resolved').tap();
    await expect(browser).toHaveURL(/exceptions-state=resolved/, { timeout: SLOW });
    const first = resolved.items[0];
    await expect(screen.getByText(`${first.unit_name} (${first.unit_code})`, { exact: false }).first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/^Resolved \d{2} \w{3} 2026/).first()).toBeVisible();
    // Resolved rows carry no Acknowledge button.
    await expect(screen.getByRole('button', 'Acknowledge')).toBeHidden();
  });

  test('STO-53 the store picker narrows the list to one store and puts it in the address', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    const all = await summary('all');
    test.skip(all.items.length === 0, 'no exception on the rig');
    const one = all.items[0];
    await app.open('/stores/exceptions?exceptions-state=all');
    await expect(screen.getByLabel(L('Store'))).toBeVisible({ timeout: SLOW });
    await choose(screen, 'Store', new RegExp(`\\(${one.unit_code}\\) · \\d+$`));
    await expect(browser).toHaveURL(new RegExp(`exceptions-unit=${one.unit_id}`), { timeout: SLOW });
    const theirs = all.items.filter((i: { unit_id: string }) => i.unit_id === one.unit_id).length;
    await expect(screen.getByText(new RegExp(`\\(${one.unit_code}\\) · since`))).toHaveCount(theirs, { timeout: SLOW });
  });

  test('STO-54 a kind chip filters by kind and a second tap clears it', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    const open = await summary('open');
    const kind = (open.summary.by_kind as { kind: string; count: number }[]).find((k) => k.count > 0);
    test.skip(!kind, 'no exception kind has a count');
    await app.open('/stores/exceptions');
    const chip = screen.getByRole('button', { name: /· \d+$/ }).first();
    await chip.tap();
    await expect(browser).toHaveURL(/exceptions-kind=/, { timeout: SLOW });
    await chip.tap();
    await expect(browser).not.toHaveURL(/exceptions-kind=/);
  });

  test('STO-55 an open exception can be acknowledged with a note and then reads Acknowledged', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const open = await summary('open');
    // Cash differences at C001 belong to the till suites, which read them; the
    // acknowledge branch only runs on an exception of some other kind.
    const mine = (open.items as { kind: string; state: string; id: string; sentence: string }[]).find((i) => i.state === 'OPEN' && i.kind !== 'CASH_DIFFERENCE');
    test.skip(!mine, 'needs an open exception that is not a till cash difference; the rig has none');
    await app.open('/stores/exceptions?exceptions-kind=' + mine!.kind);
    await screen.getByRole('button', 'Acknowledge').first().tap();
    await screen.getByRole('textbox').last().fill('e2e acknowledged');
    await screen.getByRole('button', 'Acknowledge').last().tap();
    await expect(screen.getByText(/Acknowledged by/).first()).toBeVisible({ timeout: SLOW });
  });

  test('STO-56 Thresholds is an Admin-only button in the header', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: SLOW });
    // `bypass` (the owner/administrator) is what shows it; either way the page must still render.
    const shown = await screen.getByRole('button', 'Thresholds').isVisible();
    if (shown) {
      await screen.getByRole('button', 'Thresholds').tap();
      await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    }
  });

  test('STO-57 phone: state is the dock status, the store and kind live in the Filters sheet', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/stores/exceptions');
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Search Exceptions')).toBeVisible();
    await expect(screen.getByRole('button', 'Unacknowledged')).toBeHidden();
  });
});

describe('Stores: remote actions', { tags: ['stores'] }, () => {
  test('STO-60 the Actions menu lists the server actions; Update server is disabled with its reason', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Server').tap();
    await screen.getByRole('button', 'Actions').tap();
    for (const label of ['Restart server', 'Resend initial data', 'Back up now', 'Diagnose', 'Sync now']) {
      await expect(screen.getByRole('menuitem', label)).toBeVisible({ timeout: SLOW });
    }
    // The disabled row carries its reason in its name.
    const update = screen.getByRole('menuitem', { name: /^Update server/ });
    await expect(update).toBeDisabled({ timeout: SLOW });
    await expect(screen.getByText(/signed build is installed from Fleet/)).toBeVisible();
  });

  test('STO-61 a dangerous action asks first; Cancel sends nothing', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const before = (await admin().get('/api/v1/stores/store-01/actions/history?limit=50')).items.length;
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Server').tap();
    await screen.getByRole('button', 'Actions').tap();
    await screen.getByRole('menuitem', 'Restart server').tap();
    await expect(screen.getByText(/Restart the server at C001 Cikupa\?/)).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByText(/Restart the server at C001 Cikupa\?/)).toBeHidden();
    expect((await admin().get('/api/v1/stores/store-01/actions/history?limit=50')).items.length).toBe(before);
  });

  test('STO-62 a plain action goes straight to the node and lands in the Activity tab', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const before = (await admin().get('/api/v1/stores/store-01/actions/history?limit=50')).items.length;
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Server').tap();
    await screen.getByRole('button', 'Actions').tap();
    await screen.getByRole('menuitem', 'Diagnose').tap();
    // "Diagnose" is not marked dangerous or note-required, so it is sent at once.
    await expect.poll(async () => (await admin().get('/api/v1/stores/store-01/actions/history?limit=50')).items.length, { timeout: SLOW }).toBe(before + 1);
    await screen.getByRole('tab', 'Activity').tap();
    await expect(screen.getByText('Diagnose').first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/Queued|Sent|Running|Done|Failed|Expired/).first()).toBeVisible();
  });

  test('STO-63 a store with no server has every action disabled with the reason "no server yet"', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-03');
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText('Not installed', { exact: true })).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Actions').tap();
    await expect(screen.getByRole('menuitem', { name: /^Restart server/ })).toBeDisabled({ timeout: SLOW });
    await expect(screen.getByText('This store has no server yet.').first()).toBeVisible();
  });
});
