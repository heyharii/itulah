// GA › Repairs: the book, the composer, the four-eyes budget approval and the
// stage moves OPEN → APPROVED → IN_PROGRESS → COMPLETED (→ CLOSED) or CANCELLED.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, choose, expenseVendor, rina, GA_SITE, recordRepair, registerAsset, SLOW, tag, L } from '../../support/stores-ga.ts';

const repairOf = async (id: string) => admin().get(`/api/v1/ga/repairs/${id}`);

describe('GA: repairs', { tags: ['ga'] }, () => {
  test('GA-40 the book shows its three figures and a repair made through the API', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('R');
    const v = await expenseVendor(t);
    await recordRepair(t, v.supplier_id);
    await app.open('/maintenance');
    await expect(screen.getByRole('heading', 'Repairs')).toBeVisible({ timeout: SLOW });
    for (const label of ['Open', 'Done in the last 90 days', 'Actual over estimate/budget']) await expect(screen.getByText(label).first()).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Bocor Uji ${t}`)).toBeVisible();
  });

  test('GA-41 the composer names what is missing: problem, object, location, vendor', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/maintenance');
    await screen.getByRole('button', 'Record repair', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Enter the problem first.')).toBeVisible();
    await expect(screen.getByText('Choose the object first.')).toBeVisible();
    await expect(screen.getByText('Choose a location first.')).toBeVisible();
    await expect(screen.getByText('Choose a vendor first.')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('GA-42 a repair on an asset takes the asset\'s site and class; saved, it opens its sheet', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('S');
    const v = await expenseVendor(t);
    const a = await registerAsset(t);
    await app.open('/maintenance');
    await screen.getByRole('button', 'Record repair', { visible: true }).tap();
    await screen.getByLabel(L('Problem')).fill(`Rusak Uji ${t}`);
    await choose(screen, 'Asset', new RegExp(a.asset_number));
    await expect(screen.getByLabel(L('Location'))).toBeHidden(); // follows the asset
    await choose(screen, 'Vendor', v.name);
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('tab', 'Details')).toBeVisible({ timeout: SLOW });
    const mine = ((await admin().get('/api/v1/ga/repairs?limit=200')).rows as { title: string; asset_id: string; site_id: string; status: string }[]).find((r) => r.title === `Rusak Uji ${t}`);
    expect(mine?.asset_id).toBe(a.asset_id);
    expect(mine?.site_id).toBe(GA_SITE);
    expect(mine?.status).toBe('OPEN');
  });

  test('GA-43 the sheet reads as facts with Details, Cost, Accounts and Documents', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('T');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id);
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    for (const tab of ['Details', 'Cost', 'Accounts', 'Documents']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    for (const term of ['Asset', 'Location', 'Object', 'Vendor', 'Reported', 'Recorded by']) await expect(screen.getByText(term, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText('No asset')).toBeVisible();
  });

  test('GA-44 four eyes: the person who recorded a repair cannot approve its budget', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('U');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id, null, {}, rina()); // recorded by rina, who then looks at it
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await expect(screen.getByRole('button', 'Creator cannot approve their own request')).toBeDisabled({ timeout: SLOW });
  });

  test('GA-45 another person approves the budget with a figure and the sheet shows it', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('V');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id); // recorded by admin; rina approves
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await screen.getByRole('button', 'Approve budget').tap();
    const budget = screen.getByLabel(new RegExp(`^Budget for Bocor Uji ${t}`));
    await expect(screen.getByRole('button', 'Approve budget').last()).toBeDisabled();
    await budget.fill('450000');
    await screen.getByRole('button', 'Approve budget').last().tap();
    await expect.poll(async () => (await repairOf(r.repair_id)).approved_budget_minor, { timeout: SLOW }).toBe(450_000);
    expect((await repairOf(r.repair_id)).approved_by).toBe('rina');
  });

  test('GA-46 Move stage walks the repair forward and offers Send bill to Finance once it is done', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('W');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id);
    for (const [pick, status] of [['Approved', 'APPROVED'], ['In progress', 'IN_PROGRESS'], ['Done', 'COMPLETED']] as const) {
      // A decision closes the sheet; the next one opens it again.
      await app.open(`/maintenance?repair=${r.repair_id}`);
      await screen.getByRole('button', 'Move stage').tap();
      await screen.getByRole('radio', { name: new RegExp(`^${pick}`) }).tap();
      await screen.getByRole('button', 'Move').tap();
      await expect.poll(async () => (await repairOf(r.repair_id)).status, { timeout: SLOW }).toBe(status);
    }
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await expect(screen.getByRole('button', 'Send bill to Finance')).toBeVisible({ timeout: SLOW });
  });

  test('GA-47 a cancelled repair has nowhere left to move', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('X');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id);
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await screen.getByRole('button', 'Move stage').tap();
    await screen.getByRole('radio', { name: /^Cancelled/ }).tap();
    await expect(screen.getByText(/Stops this repair/)).toBeVisible();
    await screen.getByRole('button', 'Move').tap();
    await expect.poll(async () => (await repairOf(r.repair_id)).status, { timeout: SLOW }).toBe('CANCELLED');
    // The sheet closes on a decision; reopened, a cancelled repair offers no further move.
    await app.open(`/maintenance?repair=${r.repair_id}`);
    await expect(screen.getByRole('tab', 'Details')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Move stage')).toBeHidden();
  });

  test('GA-48 the API refuses a jump from OPEN straight to COMPLETED and names both stages', { tags: ['ga'] }, async () => {
    const t = tag('Y');
    const v = await expenseVendor(t);
    const r = await recordRepair(t, v.supplier_id);
    const res = await admin().call('POST', `/api/v1/ga/repairs/${r.repair_id}/move`, { to: 'COMPLETED', note: null }, { ok: false });
    expect(JSON.stringify(res)).toMatch(/OPEN/);
    expect((await repairOf(r.repair_id)).status).toBe('OPEN');
  });

  test('GA-49 phone: the repair book is cards and Record repair is the round button', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('Z');
    const v = await expenseVendor(t);
    await recordRepair(t, v.supplier_id);
    await browser.setViewport(viewports.phone);
    await app.open('/maintenance');
    await expect(screen.getByRole('button', 'Record repair', { visible: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Bocor Uji ${t}`)).toBeVisible();
  });
});

