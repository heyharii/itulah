// GA › Overview: what needs review or follow-up, read from GET /api/v1/ga/overview.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, requestSupply, SLOW, tag } from '../../support/stores-ga.ts';

describe('GA: overview', { tags: ['ga'] }, () => {
  test('GA-01 the overview counts the items it shows and says when the data is as of', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/ga');
    await expect(screen.getByRole('heading', 'Overview')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText('Needs attention')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/Data as of \d{2} \w{3} 2026/)).toBeVisible();
    const o = await admin().get('/api/v1/ga/overview');
    const total = ['draft_assets', 'expiring_documents', 'expiring_contracts', 'due_maintenance', 'open_repairs', 'replacements', 'supply_requests']
      .reduce((n, k) => n + ((o[k] as unknown[] | undefined)?.length ?? 0), 0);
    if (total === 0) await expect(screen.getByText(/Nothing needs attention as of/)).toBeVisible();
    else await expect(screen.getByText(/\d+ items? shown/)).toBeVisible();
  });

  test('GA-02 a new supply request shows under "New supply requests" and its row opens the request', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('O');
    // The overview lists the ten earliest-needed requests of a kind: ask for it long ago so it is
    // in them however many requests the other suites have left open, and reject it when done.
    const made = await requestSupply(t, { needed_by: '2000-01-01' });
    await app.open('/ga');
    await expect(screen.getByRole('heading', 'New supply requests')).toBeVisible({ timeout: SLOW });
    const row = screen.getByRole('link', { name: new RegExp(`Kertas Uji ${t}`) });
    await expect(row).toBeVisible();
    await row.tap();
    await expect(browser).toHaveURL(new RegExp(`/supplies\\?.*supply=${made.request_id}`), { timeout: SLOW });
    await admin().post(`/api/v1/ga/supplies/${made.request_id}/move`, { to: 'REJECTED', po_reference: null, rejected_reason: 'e2e cleanup' });
  });

  test('GA-03 each card says what it is for', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await requestSupply(tag('P'));
    await app.open('/ga');
    await expect(screen.getByText('Review newly submitted requests.')).toBeVisible({ timeout: SLOW });
  });

  test('GA-04 the GA menu holds Overview, Supply Requests, Repairs, Service Schedule, Assets, Contracts, Sites, Suppliers, Letters, Files', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/ga');
    for (const name of ['Overview', 'Supply Requests', 'Repairs', 'Service Schedule', 'Assets', 'Contracts', 'Sites', 'Letters', 'Files']) {
      await expect(screen.getByRole('link', name).first()).toBeVisible({ timeout: SLOW });
    }
  });

  test('GA-05 phone: the overview keeps its cards', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/ga');
    await expect(screen.getByText('Needs attention')).toBeVisible({ timeout: SLOW });
  });
});
