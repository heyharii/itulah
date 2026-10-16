// GA › Supply Requests: the list, the composer and its three refusals, the flow
// REQUESTED → APPROVED → ORDERED (needs a PO number) → RECEIVED, and Reject.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, choose, GA_SITE, requestSupply, SLOW, tag, L } from '../../support/stores-ga.ts';

describe('GA: supply requests', { tags: ['ga'] }, () => {
  test('GA-30 the list shows the request, its KPI strip and the Procurement note', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('SA');
    await requestSupply(t);
    await app.open('/supplies');
    await expect(screen.getByRole('heading', 'Supply Requests')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Kertas Uji ${t}`)).toBeVisible({ timeout: SLOW });
    for (const label of [/^Submitted/, /^With Procurement/, /^Billed/]) await expect(screen.getByText(label).first()).toBeVisible();
    await expect(screen.getByText(/aren't connected to a Procurement module yet/).first()).toBeVisible();
  });

  test('GA-31 the composer refuses an empty form with a sentence under each missing field', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/supplies');
    await screen.getByRole('button', 'Request supplies', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Enter the item first.')).toBeVisible();
    await expect(screen.getByText('Choose a location first.')).toBeVisible();
    await expect(screen.getByText("Enter the requester's name.")).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
  });

  test('GA-32 a request made in the composer lands on the list and in the API', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('SB');
    await app.open('/supplies');
    await screen.getByRole('button', 'Request supplies', { visible: true }).tap();
    await screen.getByLabel(L('Item')).fill(`Spidol Uji ${t}`);
    await choose(screen, 'Location', /Cirebon/);
    await screen.getByLabel(L('Requested by')).fill('Rina Uji');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog').getByText(`Spidol Uji ${t}`).first()).toBeVisible({ timeout: SLOW });
    const rows = await admin().get('/api/v1/ga/supplies');
    const mine = (rows as { item: string; status: string; site_id: string }[]).find((r) => r.item === `Spidol Uji ${t}`);
    expect(mine?.status).toBe('REQUESTED');
    expect(mine?.site_id).toBe(GA_SITE);
  });

  test('GA-33 Reject asks for a reason and the request ends Rejected with it shown', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('SC');
    const made = await requestSupply(t);
    await app.open(`/supplies?supply=${made.request_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    await screen.getByRole('tab', 'Stage').tap();
    await screen.getByRole('button', 'Reject').tap();
    await screen.getByLabel(L('Reason for rejection')).fill('stok masih ada');
    await screen.getByRole('button', 'Reject request').tap();
    await expect(screen.getByText('stok masih ada')).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(/A rejected request stops here/)).toBeVisible();
    const row = (await admin().get('/api/v1/ga/supplies') as { request_id: string; status: string; rejected_reason: string }[]).find((r) => r.request_id === made.request_id)!;
    expect(row.status).toBe('REJECTED');
    expect(row.rejected_reason).toBe('stok masih ada');
  });

  test('GA-34 the stages move forward one at a time; ORDERED needs the PO number', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('SD');
    const made = await requestSupply(t);
    await app.open(`/supplies?supply=${made.request_id}`);
    await screen.getByRole('tab', 'Stage').tap();
    const statusOf = async () => (await admin().get('/api/v1/ga/supplies') as { request_id: string; status: string; po_reference: string | null }[]).find((r) => r.request_id === made.request_id)!;
    const next = screen.getByRole('button', { name: /^Next:/ });
    await next.tap(); // opens the form for → APPROVED
    await next.tap(); // confirms it
    await expect.poll(async () => (await statusOf()).status, { timeout: SLOW }).toBe('APPROVED');
    await next.tap(); // opens the form for → ORDERED, which asks for the PO
    const po = screen.getByLabel(L('PO number (Procurement)'));
    await expect(po).toBeVisible();
    await expect(next).toBeDisabled();
    await po.fill(`PO-${t}`);
    await next.tap();
    await expect.poll(async () => (await statusOf()).status, { timeout: SLOW }).toBe('ORDERED');
    expect((await statusOf()).po_reference).toBe(`PO-${t}`);
  });

  test('GA-35 a request that is no longer REQUESTED cannot be rejected', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const made = await requestSupply(tag('SE'));
    await admin().call('POST', `/api/v1/ga/supplies/${made.request_id}/move`, { to: 'APPROVED', po_reference: null, rejected_reason: null });
    await app.open(`/supplies?supply=${made.request_id}`);
    await screen.getByRole('tab', 'Stage').tap();
    await expect(screen.getByRole('button', { name: /^Next:/ })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByRole('button', 'Reject')).toBeHidden();
  });

  test('GA-36 the request sheet reads as facts: item, quantity, category, location, requester', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('SF');
    const made = await requestSupply(t);
    await app.open(`/supplies?supply=${made.request_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible({ timeout: SLOW });
    for (const term of ['Item', 'Quantity', 'Category', 'Location', 'Requested by', 'Needed by', 'Estimate']) {
      await expect(screen.getByText(term, { exact: true }).first()).toBeVisible();
    }
    await expect(screen.getByText(`Kertas Uji ${t}`).first()).toBeVisible();
  });

  test('GA-37 phone: the list is cards and Request supplies is the round button', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('SG');
    await requestSupply(t);
    await browser.setViewport(viewports.phone);
    await app.open('/supplies');
    await expect(screen.getByRole('button', 'Request supplies', { visible: true })).toBeVisible({ timeout: SLOW });
    await expect(screen.getByText(`Kertas Uji ${t}`)).toBeVisible();
  });
});
