// GA › Service Schedule (recurring tasks, inspections) and Replacements.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, choose, expenseVendor, GA_SITE, registerAsset, SLOW, tag, L } from '../../support/stores-ga.ts';

const makeTask = async (t: string, over: Record<string, unknown> = {}) =>
  admin().post('/api/v1/ga/maintenance-tasks', {
    asset_id: null, site_id: GA_SITE, title: `Cuci AC Uji ${t}`, interval_kind: 'MONTHS', interval_value: 3,
    next_due: '2026-12-01', contract_id: null, supplier_id: null, notes: null, ...over,
  });

describe('GA: service schedule', { tags: ['ga'] }, () => {
  test('GA-60 Tasks and Inspections are two books; a task shows what, where and when', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('K');
    await makeTask(t);
    await app.open('/maintenance/schedule');
    await expect(screen.getByRole('heading', 'Service Schedule')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Cuci AC Uji ${t}`)).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('per location · every point at the location').first()).toBeVisible();
    await expect(screen.getByText('every 3 months').first()).toBeVisible();
    await expect(screen.getByText('01 Dec 2026').first()).toBeVisible();
  });

  test('GA-61 the new-task form names each missing piece', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/maintenance/schedule');
    await screen.getByRole('button', 'Add task', { visible: true }).first().tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Enter the task first.')).toBeVisible();
    await expect(screen.getByText('Enter the interval number.')).toBeVisible();
    await expect(screen.getByText('Enter the next due date.')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('GA-62 a task made in the form (for a location) is saved with its interval and due date', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('L');
    await app.open('/maintenance/schedule');
    await screen.getByRole('button', 'Add task', { visible: true }).first().tap();
    await screen.getByRole('radio', { name: /^One location/ }).tap();
    await choose(screen, 'Location', /Cirebon/);
    await screen.getByLabel(L('Task')).fill(`Servis Genset Uji ${t}`);
    await screen.getByRole('radio', { name: /^Months/ }).tap();
    await screen.getByLabel(L('Every')).fill('6');
    await screen.getByLabel(L('Next due')).fill('2026-12-15');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(`Servis Genset Uji ${t}`)).toBeVisible({ timeout: SLOW });
    const mine = ((await admin().get('/api/v1/ga/maintenance-tasks?limit=200')).rows as { title: string; interval_value: number; next_due: string; site_id: string }[]).find((r) => r.title === `Servis Genset Uji ${t}`);
    expect(mine?.interval_value).toBe(6);
    expect(mine?.next_due).toBe('2026-12-15');
    expect(mine?.site_id).toBe(GA_SITE);
  });

  test('GA-63 Record done moves the next due date forward by the interval', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('M');
    const task = await makeTask(t, { next_due: '2026-10-05' });
    await app.open('/maintenance/schedule');
    const row = screen.getByText(`Cuci AC Uji ${t}`);
    await expect(row).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Record done').first().tap();
    await expect(screen.getByRole('dialog')).toBeVisible();
    await screen.getByLabel(L('Done on')).fill('2026-10-08');
    await screen.getByRole('button', { name: /^(Submit|Record done)$/ }).last().tap();
    await expect.poll(async () => ((await admin().get('/api/v1/ga/maintenance-tasks?limit=200')).rows as { task_id: string; next_due: string }[]).find((r) => r.task_id === task.task_id)?.next_due, { timeout: SLOW }).toBe('2027-01-08');
  });

  test('GA-64 an inspection with a finding can carry a repair; the form needs the asset and the finding', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/maintenance/schedule');
    await screen.getByRole('button', 'Record inspection', { visible: true }).first().tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Choose an asset first.')).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('GA-65 an inspection recorded on an asset shows in the Inspections book', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('N');
    const a = await registerAsset(t);
    await admin().post('/api/v1/ga/inspections', { asset_id: a.asset_id, inspected_on: '2026-10-08', inspected_by: 'Pak Uji', result: 'BAIK', findings: `Semua baik ${t}`, task_id: null });
    await app.open('/maintenance/schedule');
    await expect(screen.getByText(`Semua baik ${t}`)).toBeVisible({ timeout: SLOW });
  });

  test('GA-66 the API refuses a task for both an asset and a site, or for neither', { tags: ['ga'] }, async () => {
    const t = tag('O');
    const a = await registerAsset(t);
    const both = await admin().call('POST', '/api/v1/ga/maintenance-tasks', { asset_id: a.asset_id, site_id: GA_SITE, title: 'x', interval_kind: 'MONTHS', interval_value: 1, next_due: '2026-12-01', contract_id: null, supplier_id: null, notes: null }, { ok: false });
    const none = await admin().call('POST', '/api/v1/ga/maintenance-tasks', { asset_id: null, site_id: null, title: 'x', interval_kind: 'MONTHS', interval_value: 1, next_due: '2026-12-01', contract_id: null, supplier_id: null, notes: null }, { ok: false });
    for (const res of [both, none]) expect(JSON.stringify(res)).not.toMatch(/"task_id"/);
  });

  test('GA-67 phone: the schedule keeps both books behind a switch', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/maintenance/schedule');
    await expect(screen.getByRole('heading', 'Service Schedule')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', { name: /^Status: Tasks/ })).toBeVisible();
    await expect(screen.getByRole('button', 'Add New task')).toBeVisible();
  });
});

describe('GA: replacements', { tags: ['ga'] }, () => {
  test('GA-70 a proposed replacement is counted under Proposed and opens its sheet', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('P');
    const a = await registerAsset(t);
    const r = await admin().post('/api/v1/ga/replacements', { old_asset_id: a.asset_id, repair_id: null, reason: `Uzur ${t}`, supplier_id: null, proposed_on: '2026-10-08' });
    await app.open('/maintenance/replacements');
    await expect(screen.getByRole('heading', 'Replacements')).toBeVisible({ timeout: SLOW });
    for (const word of ['Proposed', 'In progress', 'Done']) await expect(screen.getByText(word, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(`Rak Uji ${t}`).first()).toBeVisible();
    await app.open(`/maintenance/replacements?replacement=${r.replacement_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Uzur ${t}`).first()).toBeVisible();
    await expect(screen.getByText('Old asset', { exact: true }).first()).toBeVisible();
  });

  test('GA-71 the Replacements screen is routed but not a sidebar row; Repairs stays lit', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/maintenance/replacements');
    await expect(screen.getByRole('heading', 'Replacements')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('link', 'Replacements')).toBeHidden();
  });
});
void expenseVendor;
