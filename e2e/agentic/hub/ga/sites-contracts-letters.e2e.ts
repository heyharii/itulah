// GA › Sites (the places GA looks after), Contracts and Letters.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { viewports } from '../../support/base.ts';
import { admin, GA_SITE, sharedTestStore, SLOW, T, tag, L } from '../../support/stores-ga.ts';

const makeContract = async (t: string, over: Record<string, unknown> = {}) =>
  admin().post('/api/v1/ga/contracts', {
    contract_number: `LK/UJI/${t}`, contract_type: 'SEWA_TOKO', counterparty_name: `Pemilik Uji ${t}`, site_id: GA_SITE,
    starts_on: '2026-01-01', ends_on: '2027-12-31', contract_value_minor: 1_200_000_000, is_signed: true, signed_by: 'Bpk Uji', reminder_days: 60, ...over,
  });

describe('GA: sites', { tags: ['ga'] }, () => {
  test('GA-80 Sites lists every place with a count, a type filter and Open store', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/locations');
    await expect(screen.getByRole('heading', 'Sites')).toBeVisible(T);
    await expect(screen.getByText('Cirebon').first()).toBeVisible(T);
    await expect(screen.getByText(/\d+ places/)).toBeVisible();
    await expect(screen.getByRole('button', 'Open store', { visible: true })).toBeVisible();
    await expect(screen.getByRole('button', 'All types')).toBeVisible();
  });

  test('GA-81 a site opens its hub: Details, Assets, Contracts, Utilities, Repairs, Schedule, Supply requests, Bills', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open(`/locations?location=${GA_SITE}`);
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    for (const tab of ['Details', 'Assets', 'Contracts', 'Utilities', 'Repairs', 'Schedule', 'Supply requests', 'Bills (Finance)']) {
      await expect(screen.getByRole('tab', tab)).toBeVisible();
    }
    await expect(screen.getByText(GA_SITE, { exact: true }).first()).toBeVisible();
  });

  test('GA-82 Edit details saves address, contact and floor area on a store of ours', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('SI');
    const unit = await sharedTestStore();
    await app.open(`/locations?location=${unit.site_id}`);
    await screen.getByRole('button', { name: /^(Complete|Edit details)$/ }).tap();
    await screen.getByLabel(L('Address')).fill(`Jl. Uji ${t} No. 1`);
    await screen.getByLabel(/^Contact(?! phone)/).fill('Pak Uji');
    await screen.getByRole('spinbutton', { name: /^Floor area/ }).fill('120');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(`Jl. Uji ${t} No. 1`).first()).toBeVisible(T);
    const row = (await admin().get('/api/v1/ga/locations')) as { site_id: string; address: string; floor_area_sqm: number }[];
    const mine = row.find((r) => r.site_id === unit.site_id)!;
    expect(mine.address).toBe(`Jl. Uji ${t} No. 1`);
    expect(Number(mine.floor_area_sqm)).toBe(120);
  });

  test('GA-83 a floor area with a full stop is refused on the form, not quietly stored as 10x (12.5 became 125)', { session: 'rina', tags: ['ga', 'bug'] }, async ({ app, screen }) => {
    const unit = await sharedTestStore();
    await app.open(`/locations?location=${unit.site_id}`);
    await screen.getByRole('button', { name: /^(Complete|Edit details)$/ }).tap();
    await screen.getByRole('spinbutton', { name: /^Floor area/ }).fill('12.5');
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText('Numbers only, no full stops.')).toBeVisible(T);
  });

  test('GA-84 the Open store button here raises the same sheet as Stores', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/locations');
    await screen.getByRole('button', 'Open store', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await expect(screen.getByLabel(/^Store name/)).toBeVisible();
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('GA-85 phone: sites are cards with Open store as the round button', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/locations');
    await expect(screen.getByRole('button', 'Open store', { visible: true })).toBeVisible(T);
    await expect(screen.getByText('Cirebon').first()).toBeVisible();
  });
});

describe('GA: contracts', { tags: ['ga'] }, () => {
  test('GA-90 the register shows its four figures and the contract made through the API', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    const t = tag('CA');
    await makeContract(t);
    await app.open('/contracts');
    await expect(screen.getByRole('heading', 'Contracts')).toBeVisible(T);
    for (const k of ['Active', 'Due for renewal', 'Active contract value']) await expect(screen.getByText(k).first()).toBeVisible(T);
    await expect(screen.getByText(`LK/UJI/${t}`).first()).toBeVisible(T);
  });

  test('GA-91 the contract sheet reads as facts: party, type, location, term, signed, value', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('CB');
    const c = await makeContract(t);
    await app.open(`/contracts?contract=${c.contract_id}`);
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    for (const tab of ['Details', 'Documents']) await expect(screen.getByRole('tab', tab)).toBeVisible();
    for (const term of ['Party', 'Type', 'Location', 'Term', 'Signed', 'Contract value', 'Reminder']) await expect(screen.getByText(term, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(`Pemilik Uji ${t}`).first()).toBeVisible();
  });

  test('GA-92 Archive asks for a reason first, then archives and the sheet says Archived', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const t = tag('CC');
    const c = await makeContract(t);
    await app.open(`/contracts?contract=${c.contract_id}`);
    await screen.getByRole('button', 'Archive').tap();
    await screen.getByRole('button', 'Archive').last().tap();
    await expect(screen.getByText('Write the reason first.')).toBeVisible(T);
    await screen.getByLabel(new RegExp(`^Archive LK/UJI/${t}`)).fill('selesai e2e');
    await screen.getByRole('button', 'Archive').last().tap();
    await expect.poll(async () => ((await admin().get(`/api/v1/ga/contracts/${c.contract_id}`)) as { contract: { archived: boolean } }).contract.archived, { timeout: SLOW }).toBe(true);
  });

  test('GA-93 Add contract opens the composer and names what is missing', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/contracts');
    await screen.getByRole('button', 'Add contract', { visible: true }).tap();
    await expect(screen.getByRole('dialog')).toBeVisible(T);
    await screen.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(/^(Enter|Choose) /).first()).toBeVisible(T);
    await screen.getByRole('button', 'Cancel').tap();
  });

  test('GA-94 the group chips narrow the register', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await makeContract(tag('CD'));
    await app.open('/contracts');
    await expect(screen.getByRole('link', { name: /^All \d+$/ })).toBeVisible(T);
    await expect(screen.getByRole('link', { name: /^Leases \d+$/ })).toBeVisible();
  });

  test('GA-95 the API refuses an end date before the start date', { tags: ['ga'] }, async () => {
    const t = tag('CE');
    const res = await admin().call('POST', '/api/v1/ga/contracts', {
      contract_number: `LK/UJI/${t}`, contract_type: 'SEWA_TOKO', counterparty_name: 'X', site_id: GA_SITE, starts_on: '2027-01-01', ends_on: '2026-01-01', contract_value_minor: 1, is_signed: false, signed_by: null, reminder_days: 30,
    }, { ok: false });
    expect(JSON.stringify(res)).not.toContain('"contract_id"');
  });

  test('GA-96 phone: the register is cards with Add contract as the round button', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    const t = tag('CF');
    await makeContract(t);
    await browser.setViewport(viewports.phone);
    await app.open('/contracts');
    await expect(screen.getByRole('button', { name: /^Add (New )?contract$/i, visible: true })).toBeVisible(T);
    await expect(screen.getByText(`LK/UJI/${t}`).first()).toBeVisible(T);
  });
});

describe('GA: letters', { tags: ['ga'] }, () => {
  test('GA-100 Letters has its kinds, the status filter and New letter', { session: 'rina', tags: ['ga', 'smoke'] }, async ({ app, screen }) => {
    await app.open('/letters');
    await expect(screen.getByRole('heading', 'Letters')).toBeVisible(T);
    for (const kind of ['All', 'Goods receipt note', 'Delivery note', 'Return PO', 'Letter']) await expect(screen.getByRole('button', kind)).toBeVisible();
    await expect(screen.getByRole('button', 'Any status')).toBeVisible();
    await expect(screen.getByRole('button', 'New letter', { visible: true }).first()).toBeVisible();
  });

  test('GA-101 New letter explains what a draft is and writes a blank one', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    await app.open('/letters');
    await screen.getByRole('button', 'New letter', { visible: true }).first().tap();
    await expect(screen.getByText('This opens a draft: no number yet, and one button throws it away.')).toBeVisible(T);
    await screen.getByRole('dialog').getByRole('button', 'Letter').tap();
    await expect(screen.getByRole('button', /^Write (a blank letter|it from this pattern)$/)).toBeVisible();
  });

  test('GA-102 a blank draft opens in the editor and the list counts it as awaiting issue', { session: 'rina', tags: ['ga'] }, async ({ app, screen }) => {
    const before = (await admin().get('/api/v1/letters?limit=1')) as { drafts?: number };
    await app.open('/letters');
    await screen.getByRole('button', 'New letter', { visible: true }).first().tap();
    await screen.getByRole('dialog').getByRole('button', 'Letter').tap();
    await screen.getByRole('button', 'Write a blank letter').tap();
    await expect(screen.getByRole('button', 'Bold')).toBeVisible(T);
    const after = (await admin().get('/api/v1/letters?limit=1')) as { drafts?: number };
    expect(after.drafts ?? 0).toBe((before.drafts ?? 0) + 1);
  });

  test('GA-103 phone: letters keep the kind switch in the dock', { session: 'rina', tags: ['ga'] }, async ({ app, screen, browser }) => {
    await browser.setViewport(viewports.phone);
    await app.open('/letters');
    await expect(screen.getByRole('button', { name: /^Add (New )?letter$/i, visible: true })).toBeVisible(T);
    await expect(screen.getByRole('button', 'Search letters')).toBeVisible();
    await expect(screen.getByRole('button', { name: /^Status: All/ })).toBeVisible();
  });
});
