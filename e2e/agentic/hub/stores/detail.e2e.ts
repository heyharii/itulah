// Stores › one store's page: the eight tabs, read-only. The two stores read
// here are the ones the rig leaves alone: C001 (server online) and C002 (no
// server installed). Nothing on this file writes.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { SLOW, sharedTestStore, storeDetailOf, L } from '../../support/stores-ga.ts';

const TABS = ['Overview', 'Server', 'Devices', 'Activity', 'Team', 'Payments', 'Stock', 'Facilities'];

describe('Stores: a store page', { tags: ['stores'] }, () => {
  test('STO-10 the page names the store and offers the eight tabs, Overview first', { session: 'rina', tags: ['stores', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await expect(screen.getByRole('heading', 'Cikupa')).toBeVisible({ timeout: SLOW });
    for (const tab of TABS) await expect(screen.getByRole('tab', tab)).toBeVisible();
    await expect(screen.getByRole('tab', 'Overview')).toHaveAttribute('aria-selected', 'true');
  });

  test('STO-11 Overview: code, city, timezone, PIC, address and open-since come from the store', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const d = await storeDetailOf('store-01');
    await app.open('/stores/store-01');
    await expect(screen.getByText('Code', { exact: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('C001', { exact: true })).toBeVisible();
    await expect(screen.getByText(d.store.timezone, { exact: true })).toBeVisible();
    for (const term of ['City', 'Timezone', 'PIC', 'Address']) await expect(screen.getByText(term, { exact: true })).toBeVisible();
    if (!d.store.pic) await expect(screen.getByText('Not appointed yet')).toBeVisible();
    if (d.store.status === 'OPEN') {
      await expect(screen.getByText('Open since', { exact: true })).toBeVisible();
      await expect(screen.getByText(/Cikupa is open and trading since \d{2} \w{3} 2026/)).toBeVisible();
      // An open store has no checklist and no Open button.
      await expect(screen.getByText('Ready to open')).toBeHidden();
    }
  });

  test('STO-12 Overview carries the exceptions card; a store with none reads All clear, not the fleet\'s count', { session: 'rina', tags: ['stores', 'bug'] }, async ({ app, screen }) => {
    await app.open('/stores/store-12');
    await expect(screen.getByRole('heading', 'Banjaran')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('heading', 'Exceptions')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('No open exceptions — this store is on time.')).toBeVisible({ timeout: SLOW });
    // BUG: the pill beside it reads the fleet-wide total ("24 open") because
    // GET /stores/{unit}/exceptions answers a summary that ignores the unit.
    await expect(screen.getByText('All clear')).toBeVisible();
    await expect(screen.getByText(/^\d+ open$/)).toBeHidden();
  });

  test('STO-13 Server tab of a store whose server is online: the word Online, a heartbeat and the Actions menu', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText('Online', { exact: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/heartbeat/)).toBeVisible();
    await expect(screen.getByRole('button', 'Actions')).toBeVisible({ timeout: SLOW });
  });

  test('STO-14 Server tab of a store with no server: the install card, its 24-hour code sentence and the Install server button', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const d = await storeDetailOf('store-02');
    test.skip(d.store.server.state !== 'NOT_INSTALLED', 'store-02 has a server in the rig now');
    await app.open('/stores/store-02');
    await screen.getByRole('tab', 'Server').tap();
    await expect(screen.getByText('Not installed', { exact: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/Issue an install code for Muaro Bungo/)).toBeVisible();
    await expect(screen.getByText(/good for 24 hours or until it is used/)).toBeVisible();
    await expect(screen.getByRole('button', 'Install server')).toBeVisible();
  });

  test('STO-15 Devices tab: tills online line, the seat count and the seats form', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const d = await storeDetailOf('store-02');
    await app.open('/stores/store-02');
    await screen.getByRole('tab', 'Devices').tap();
    await expect(screen.getByText(/tills online/)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/Till seats:/)).toBeVisible();
    await expect(screen.getByText(/Each seat is one drawer/)).toBeVisible();
    const field = screen.getByLabel(L('Number of till seats'));
    await expect(field).toHaveValue(String(d.store.tills.seats));
    // Unchanged: nothing to submit.
    await expect(screen.getByRole('button', 'Submit')).toBeDisabled();
  });

  test('STO-16 Devices tab: a store with no reporting devices says so', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-05');
    await screen.getByRole('tab', 'Devices').tap();
    await expect(screen.getByText(/No till, printer or reader has reported at this site/)).toBeVisible({ timeout: SLOW });
  });

  test('STO-17 Activity tab: a store nobody asked anything of says so', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-06');
    await screen.getByRole('tab', 'Activity').tap();
    await expect(screen.getByText('Nothing has been asked of this store from head office yet.')).toBeVisible({ timeout: SLOW });
  });

  test('STO-18 Team tab: the PIC card with its link to Master, and who is posted here', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Team').tap();
    await expect(screen.getByRole('heading', 'PIC')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('link', 'Change in Master › Units')).toBeVisible();
    // Whoever is posted to the unit is listed, each a link to their record.
    await expect(screen.getByRole('listitem').first()).toBeVisible({ timeout: SLOW });
  });

  test('STO-19 Team tab: a new store lists the manager who was invited to it, with no PIC appointed', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    const s = await sharedTestStore(); // nobody is ever posted to it
    await app.open(`/stores/${s.unit_id}`);
    await screen.getByRole('tab', 'Team').tap();
    await expect(screen.getByText('Nobody is appointed yet.')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('link', { name: /^Manajer Bersama E2E/ })).toBeVisible();
  });

  test('STO-20 Payments tab: the enabled methods or the sentence about cash, and the Finance link', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Payments').tap();
    await expect(screen.getByRole('link', 'Manage in Finance')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Reading the payment methods…')).toBeHidden({ timeout: SLOW });
  });

  test('STO-21 Stock tab: open flow documents touching the site, or none', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-13');
    await screen.getByRole('tab', 'Stock').tap();
    await expect(screen.getByText('Reading the open flow documents…')).toBeHidden({ timeout: SLOW });
  });

  test('STO-22 Facilities tab: Open facilities raises the location hub sheet for the site', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-01');
    await screen.getByRole('tab', 'Facilities').tap();
    await expect(screen.getByText(/everything GA keeps about this/)).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Open facilities').tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
  });

  test('STO-23 a store id nobody has is an error, not a blank page', { session: 'rina', tags: ['stores'] }, async ({ app, screen }) => {
    await app.open('/stores/store-nope');
    await expect(screen.getByText('Reading the store…')).toBeHidden({ timeout: SLOW });
    await expect(screen.getByRole('tab', 'Overview')).toBeHidden();
  });

  test('STO-24 phone: the store page keeps its tabs and the Overview facts', { session: 'rina', tags: ['stores'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/stores/store-01');
    await expect(screen.getByRole('heading', 'Cikupa')).toBeVisible({ timeout: SLOW });
    // On a phone the tabs fold into one dock button that names the current one.
    await expect(screen.getByRole('button', { name: /^Status: Overview/ })).toBeVisible();
    await expect(screen.getByText('Code', { exact: true })).toBeVisible();
  });
});
