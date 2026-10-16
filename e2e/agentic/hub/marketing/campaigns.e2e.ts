// Campaigns: list, filters, sheet, the New/Change/Duplicate form, the lifecycle switches and the poster.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  books, campaignNamed, publishSheet, campaignOf, cloud, floorEpc, has, makeCampaign, makeCouponRule, publishBook, quote, receipt, restate, ruleDoc, shopSees, tag, TAS,
} from '../../support/marketing.ts';

const TAGS = ['marketing', 'campaigns'];
const row = (screen: any, name: string) => screen.getByRole('row').filter({ hasText: name });
const search = (screen: any) => screen.getByRole('textbox').first();

async function openForm(app: any, screen: any) {
  await app.open('/commercial/campaigns');
  await screen.getByRole('button', 'New campaign').first().tap();
  await expect(screen.getByRole('dialog')).toContainText('Summary', { timeout: 60_000 });
  return screen.getByRole('dialog');
}
async function publish(screen: any) {
  await publishSheet(screen);
}
const campaign = async (name: string) => {
  for (let i = 0; i < 10; i++) {
    const found = await campaignNamed(name);
    if (found) return campaignOf(found);
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(`campaign ${name} never appeared`);
};

describe('campaigns list', { tags: TAGS }, () => {
  test('the seeded campaigns show status, objective, target, budget used, stores and window', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial/campaigns');
    await expect(screen.getByRole('heading', 'Campaigns')).toBeVisible({ timeout: 60_000 });
    const pekan = row(screen, 'Pekan Sepatu');
    await has(pekan, 'Live', 'Drive sales', '≥ Rp 5.000.000 promo sales', '/ Rp 2.000.000', '1 / 1');
    const gajian = row(screen, 'Gajian Hemat');
    await has(gajian, 'Live', 'Increase basket size', '≥ Rp 350.000 average basket value', '/ Rp 1.000.000');
  });

  test('a campaign nobody gave a purpose reads "Not stated"', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('N');
    await makeCampaign(`Tanpa tujuan ${t}`);
    await app.open(`/commercial/campaigns?q=${t}`);
    await expect(row(screen, `Tanpa tujuan ${t}`)).toBeVisible({ timeout: 60_000 });
    await has(row(screen, `Tanpa tujuan ${t}`), 'Not stated');
  });

  test('searching narrows the list by name', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('S');
    await makeCampaign(`Cari ${t}`);
    await app.open('/commercial/campaigns');
    await expect(row(screen, 'Pekan Sepatu')).toBeVisible({ timeout: 60_000 });
    await search(screen).fill(`Cari ${t}`);
    await expect(row(screen, `Cari ${t}`)).toBeVisible();
    await expect(row(screen, 'Pekan Sepatu')).toBeHidden();
    await search(screen).fill(`tak-ada-${t}`);
    await expect(screen.getByText('No campaign matches that search.')).toBeVisible();
  });

  test('the Status filter finds a paused campaign and nothing else', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('P');
    await makeCampaign(`Jeda ${t}`, { status: 'PAUSED' });
    await app.open(`/commercial/campaigns?f=live:isAnyOf:PAUSED&q=${t}`);
    await expect(row(screen, `Jeda ${t}`)).toBeVisible({ timeout: 60_000 });
    await has(row(screen, `Jeda ${t}`), 'Paused');
    await app.open('/commercial/campaigns?f=live:isAnyOf:PAUSED');
    await expect(row(screen, `Jeda ${t}`)).toBeVisible({ timeout: 30_000 });
    await expect(row(screen, 'Pekan Sepatu')).toBeHidden();
  });

  test('the Offers filter "is 0" finds a campaign with nothing to spend its budget on', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('O');
    await makeCampaign(`Hampa ${t}`);
    await app.open('/commercial/campaigns?f=rules:is:0');
    await expect(row(screen, `Hampa ${t}`)).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, 'Pekan Sepatu')).toBeHidden();
  });

  test('the Objective filter "is empty" finds campaigns with no stated goal', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('G');
    await makeCampaign(`Tanpa sasaran ${t}`);
    await app.open('/commercial/campaigns?f=objective:isEmpty');
    await expect(row(screen, `Tanpa sasaran ${t}`)).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, 'Pekan Sepatu')).toBeHidden();
  });

  test('a campaign sheet shows its offers, goal, results, and the stores that carry it', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/campaigns');
    await row(screen, 'Pekan Sepatu').tap();
    const sheet = screen.getByRole('dialog');
    await has(sheet, 'pekan-sepatu', 'Diskon 15% Sandal & Sepatu', 'Goal', 'Drive sales', 'Results', 'Poster', 'Budget used', '/ Rp 2.000.000');
    await sheet.getByRole('tab', { name: /^Stores/ }).tap();
    await has(sheet, 'rig store-01');
    await sheet.getByRole('tab', 'Activity').tap();
    await expect(sheet.getByRole('tab', 'Activity')).toBeVisible();
  });

  test('a fresh campaign lists its next steps; an offer ticks one off; an offer and a goal remove the list', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('X');
    const goal = { objective: 'DRIVE_SALES', success_metric: 'PROMO_SALES', target_direction: 'AT_LEAST', target_value: 1_000_000, baseline_campaign_id: null, notes: null, updated_by: 'rina' };
    const offerFor = async (campaignId: string, name: string) =>
      publishBook(`Promotion: Isi ${name}`, {
        rules: [ruleDoc(`rule-${tag('').toLowerCase()}`, `Isi ${name}`, { kind: 'PERCENT', bps: 500, compound: false }, { on: 'ARTICLE', article_codes: [TAS.article] }, { campaign: campaignId, coupon: tag('KI') })],
        campaigns: [restate((await campaignNamed(name))!)],
      });
    // nothing yet
    const bare = await makeCampaign(`Langkah ${t}`);
    await app.open(`/commercial/campaigns?campaign=${bare}`);
    await expect(screen.getByRole('dialog')).toContainText('Next steps', { timeout: 60_000 });
    await has(screen.getByRole('dialog'), 'Add an offer', 'Set a goal', 'Plan activities', 'Set a budget', 'optional');
    // an offer only
    const withOffer = await makeCampaign(`Satu ${t}`);
    await offerFor(withOffer, `Satu ${t}`);
    await app.open(`/commercial/campaigns?campaign=${withOffer}`);
    await expect(screen.getByRole('dialog')).toContainText('Done: Add an offer', { timeout: 60_000 });
    await has(screen.getByRole('dialog'), 'To do: Set a goal');
    // offer and goal: the checklist is gone
    const both = await makeCampaign(`Dua ${t}`);
    await offerFor(both, `Dua ${t}`);
    await cloud().call('PUT', `/api/v1/commercial/campaigns/${both}/intent`, goal);
    await app.open(`/commercial/campaigns?campaign=${both}`);
    await expect(screen.getByRole('dialog')).toContainText('Rp 1.000.000', { timeout: 60_000 });
    await expect(screen.getByRole('dialog')).not.toContainText('Next steps', { timeout: 30_000 });
  });

  test('"Set a goal" from the checklist saves an objective, metric and target', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('Z');
    const id = await makeCampaign(`Sasaran ${t}`);
    await app.open(`/commercial/campaigns?campaign=${id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Set a goal', { timeout: 60_000 });
    await sheet.getByRole('button', 'Set').first().tap();
    // the form's problem line names what is missing until a target is typed
    await expect(sheet).toContainText('Set a target.');
    await expect(sheet.getByRole('button', 'Submit').first()).toBeDisabled();
    await sheet.getByRole('textbox', 'Target').fill('2500000');
    await sheet.getByRole('button', 'Submit').first().tap();
    await expect(sheet).toContainText('Rp 2.500.000', { timeout: 30_000 });
    const intent = await cloud().get(`/api/v1/commercial/campaigns/${id}/intent`);
    expect(intent.target_value ?? intent.intent?.target_value).toBe(2_500_000);
  });
});

describe('campaign sheet extras', { tags: TAGS }, () => {
  test('"New offer" opens the promotion form with this campaign already chosen', { session: 'rina' }, async ({ app, screen, browser }) => {
    const t = tag('F');
    const id = await makeCampaign(`Tawaran ${t}`);
    await app.open(`/commercial/campaigns?campaign=${id}`);
    await expect(screen.getByRole('dialog')).toContainText('Offers', { timeout: 60_000 });
    await screen.getByRole('link', 'New offer').tap();
    await expect(browser).toHaveURL(/\/commercial\/promotions\?.*new-rule/);
    await expect(screen.getByRole('dialog')).toContainText('New promotion', { timeout: 60_000 });
    await expect(screen.getByRole('combobox', 'The campaign this offer belongs to')).toHaveValue(`Tawaran ${t}`);
  });

  test('a planned activity is added from the sheet and saved on the campaign', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('A');
    const id = await makeCampaign(`Rencana ${t}`);
    await app.open(`/commercial/campaigns?campaign=${id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Activities', { timeout: 60_000 });
    await sheet.getByRole('button', 'Add').first().tap();
    await expect(sheet.getByText('Give it a name.')).toBeVisible();
    await sheet.getByRole('textbox', { name: /^Name/ }).fill(`Brosur ${t}`);
    await sheet.getByRole('textbox', { name: /^Reference/ }).fill(`ref-${t}`);
    await sheet.getByRole('button', 'Submit').nth(1).tap(); // [0] is the goal form that a campaign without a goal shows open
    await expect(sheet.getByText(`Brosur ${t}`).first()).toBeVisible({ timeout: 30_000 });
    const plan = await cloud().get(`/api/v1/commercial/campaigns/${id}/plan`);
    expect(plan.activities.map((a: any) => a.name)).toContain(`Brosur ${t}`);
  });
});

describe('campaign stores', { tags: TAGS }, () => {
  test('a campaign can be limited to several stores when the fleet has several', { session: 'rina' }, async ({ app, screen }) => {
    const fleet = (await cloud().get('/api/v1/commercial/activation')).items.filter((s: any) => s.site_id);
    test.skip(fleet.length < 2, `the rig has ${fleet.length} registered store(s): the Stores picker lists only shops that have reported (/commercial/activation)`);
    const name = `Dua toko ${tag('D')}`;
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    await dialog.getByRole('button', fleet[0].label).tap();
    await dialog.getByRole('button', fleet[1].label).tap();
    await publish(screen);
    expect((await campaign(name)).site_ids).toEqual([fleet[0].site_id, fleet[1].site_id]);
  });
});

describe('new campaign', { tags: TAGS }, () => {
  test('a name alone publishes a live, everywhere campaign starting today', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const name = `Baru ${tag('B')}`;
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    await has(dialog, 'Live', 'Everywhere');
    await publish(screen);
    const c = await campaign(name);
    expect(c.status).toBe('ACTIVE');
    expect(c.site_ids ?? []).toEqual([]);
    expect(c.budget_minor).toBeNull();
    expect(c.valid_to).toBeNull();
    expect(c.campaign_id).toMatch(/^baru-/);
    // its sheet opens on publish
    await expect(screen.getByRole('dialog')).toContainText(name);
  });

  test('without a name Publish says "Give it a name." and publishes nothing', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    const before = (await books()).length;
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Give it a name.').first()).toBeVisible();
    expect((await books()).length).toBe(before);
  });

  test('budget, transaction limit, window, a chosen store and the poster are all written', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Lengkap ${tag('L')}`;
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    await dialog.getByRole('button', 'The last day this campaign runs').tap();
    await screen.getByRole('button', 'In a month').tap();
    await dialog.getByRole('textbox', 'Budget for the whole window').fill('750000');
    await dialog.getByRole('textbox', 'Most transactions').fill('25');
    await dialog.getByRole('button', 'rig store-01').tap();
    await expect(dialog.getByRole('button', 'Everywhere')).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', 'Poster').tap();
    await dialog.getByRole('textbox', 'Headline').fill(`Judul ${name}`);
    await dialog.getByRole('textbox', 'Terms').fill('Syarat berlaku.');
    await dialog.getByRole('textbox', 'Image URL').fill('http://localhost:5350/demo-images/campaign-pekan-sepatu.jpg');
    await has(dialog, 'Rp 750.000', 'Headline');
    await publish(screen);
    const c = await campaign(name);
    expect(c.budget_minor).toBe(750_000);
    expect(c.max_uses).toBe(25);
    expect(c.site_ids).toEqual(['store-01']);
    expect(c.headline).toBe(`Judul ${name}`);
    expect(c.terms).toBe('Syarat berlaku.');
    expect(c.image_url).toContain('campaign-pekan-sepatu.jpg');
    const days = (new Date(c.valid_to).getTime() - new Date(c.valid_from).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(28);
  });

  test('choosing Everywhere again clears a chosen store', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    await dialog.getByRole('button', 'rig store-01').tap();
    await expect(dialog.getByRole('button', 'rig store-01')).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', 'Everywhere').tap();
    await expect(dialog.getByRole('button', 'rig store-01')).toHaveAttribute('aria-pressed', 'false');
    await has(dialog, 'Everywhere');
  });

  test('Status offers Draft, Scheduled, Paused and Live but never Ended or Cancelled', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    await dialog.getByRole('combobox').first().tap();
    for (const label of ['Draft', 'Scheduled', 'Paused', 'Live']) await expect(screen.getByRole('option', label)).toBeVisible();
    await expect(screen.getByRole('option', 'Ended')).toBeHidden();
    await expect(screen.getByRole('option', 'Cancelled')).toBeHidden();
  });

  test('a campaign published as Paused stays paused', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Mulai jeda ${tag('M')}`;
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    await dialog.getByRole('combobox').first().tap();
    await screen.getByRole('option', 'Paused').tap();
    await has(dialog, 'Paused');
    await publish(screen);
    expect((await campaign(name)).status).toBe('PAUSED');
  });

  test('an end date before the start is flagged and blocks Publish', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    const before = (await books()).length;
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Terbalik ${tag('T')}`);
    await dialog.getByRole('button', 'The last day this campaign runs').tap();
    await screen.getByRole('button', 'In a week').tap();
    await dialog.getByRole('button', 'The day this campaign starts').tap();
    await screen.getByRole('textbox', 'Type The day this campaign starts').fill('31 Dec 2026');
    await screen.getByRole('textbox', 'Type The day this campaign starts').press('Enter');
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Ends before it starts.').first()).toBeVisible();
    expect((await books()).length).toBe(before);
  });

  test('Change publishes the next version under the same id and keeps stores, poster and status', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('C');
    const id = await makeCampaign(`Ubah ${t}`, { status: 'PAUSED', headline: `Judul ${t}`, terms: `Syarat ${t}`, site_ids: ['store-01'], budget_minor: 400_000 });
    await app.open(`/commercial/campaigns?campaign=${id}`);
    await screen.getByRole('dialog').getByRole('button', 'Change').tap();
    const form = screen.getByRole('dialog').last();
    await expect(form).toContainText('Change campaign', { timeout: 30_000 });
    await expect(form).toContainText('Stays paused');
    await form.getByRole('textbox', { name: /^Name/ }).fill(`Ubah ${t} v2`);
    await publishSheet(screen);
    const c = await campaign(`Ubah ${t} v2`);
    expect(c.campaign_id).toBe(id);
    expect(c.status).toBe('PAUSED');
    expect(c.headline).toBe(`Judul ${t}`);
    expect(c.site_ids).toEqual(['store-01']);
    expect(c.budget_minor).toBe(400_000);
  });

  test('Duplicate opens a "(copy)" under a new id and copies no offers', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('D');
    const id = await makeCampaign(`Salin ${t}`);
    await app.open(`/commercial/campaigns?campaign=${id}`);
    await screen.getByRole('dialog').getByRole('button', 'Duplicate').tap();
    const form = screen.getByRole('dialog').last();
    await expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(`Salin ${t} (copy)`, { timeout: 30_000 });
    await publishSheet(screen);
    const copy = await campaign(`Salin ${t} (copy)`);
    expect(copy.campaign_id).not.toBe(id);
    expect((await campaignNamed(`Salin ${t}`)) !== undefined).toBe(true);
  });
});

describe('campaign switches', { tags: TAGS }, () => {
  test('pausing from the list asks first; resuming does not', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen, browser }) => {
    const t = tag('W');
    await makeCampaign(`Saklar ${t}`);
    await app.open(`/commercial/campaigns?q=${t}`);
    await expect(row(screen, `Saklar ${t}`)).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('switch', `Pause Saklar ${t}`).tap();
    const ask = screen.getByRole('dialog');
    await has(ask, `Pause Saklar ${t}?`, 'Offers inside it stop at the tills.');
    await ask.getByRole('button', 'Cancel').tap();
    expect((await campaign(`Saklar ${t}`)).status).toBe('ACTIVE'); // asked, declined, nothing changed
    await screen.getByRole('switch', `Pause Saklar ${t}`).tap();
    await screen.getByRole('dialog').getByRole('button', 'Pause').tap();
    await receipt(screen, browser, /^Paused — /);
    expect((await campaign(`Saklar ${t}`)).status).toBe('PAUSED');
    await has(row(screen, `Saklar ${t}`), 'Paused');
    await screen.getByRole('switch', `Resume Saklar ${t}`).tap(); // no question this time
    await receipt(screen, browser, /^Live again — /);
    expect((await campaign(`Saklar ${t}`)).status).toBe('ACTIVE');
  });

  test('the sheet pauses, resumes and ends a campaign for good', { session: 'rina' }, async ({ app, screen, browser }) => {
    const t = tag('E');
    const id = await makeCampaign(`Akhiri ${t}`);
    await app.open(`/commercial/campaigns?campaign=${id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('button', 'Pause')).toBeVisible({ timeout: 60_000 });
    await sheet.getByRole('button', 'Pause').tap();
    await screen.getByRole('dialog').last().getByRole('button', 'Pause').last().tap();
    await receipt(screen, browser, /^Paused — /);
    await expect(sheet.getByRole('button', 'Resume')).toBeVisible({ timeout: 30_000 });
    expect((await campaign(`Akhiri ${t}`)).status).toBe('PAUSED');
    await sheet.getByRole('button', 'Resume').tap();
    await receipt(screen, browser, /^Live again — /);
    await expect(sheet.getByRole('button', 'Pause')).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole('button', 'End now').tap();
    await has(screen.getByRole('dialog').last(), `End Akhiri ${t} now?`, 'Every offer inside it stops at the tills for good.');
    await screen.getByRole('dialog').last().getByRole('button', 'End now').last().tap();
    await receipt(screen, browser, /^Ended — /);
    await expect.poll(async () => (await campaign(`Akhiri ${t}`)).status, { timeout: 30_000 }).toBe('CANCELLED');
    // an ended campaign has no lever left
    await expect(sheet.getByRole('button', 'End now')).toBeHidden();
    await expect(sheet.getByRole('button', 'Pause')).toBeHidden();
    await expect(sheet.getByRole('button', 'Resume')).toBeHidden();
    await expect(sheet.getByText('Cancelled').first()).toBeVisible();
  });

  test('a campaign past its window reads Ended and has no switch', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('V');
    await makeCampaign(`Lewat ${t}`, { valid_from: new Date(Date.now() - 20 * 86_400_000).toISOString(), valid_to: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    await app.open(`/commercial/campaigns?q=${t}`);
    await expect(row(screen, `Lewat ${t}`)).toBeVisible({ timeout: 60_000 });
    await has(row(screen, `Lewat ${t}`), 'Ended');
    await expect(screen.getByRole('switch', `Pause Lewat ${t}`)).toBeHidden();
  });

  test('editing the poster in the sheet is sent to the stores without a new book', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('K');
    const id = await makeCampaign(`Poster ${t}`);
    const before = (await books()).length;
    await app.open(`/commercial/campaigns?campaign=${id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet.getByRole('textbox', 'Headline')).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByRole('button', 'Submit').last()).toBeDisabled(); // nothing changed yet
    await sheet.getByRole('textbox', 'Headline').fill(`Diskon besar ${t}`);
    await sheet.getByRole('textbox', 'Terms').fill(`Syarat ${t}`);
    await sheet.getByRole('button', 'Submit').last().tap();
    await expect(sheet.getByText('Sent to stores.')).toBeVisible({ timeout: 30_000 });
    const c = await campaign(`Poster ${t}`);
    expect(c.headline).toBe(`Diskon besar ${t}`);
    expect(c.terms).toBe(`Syarat ${t}`);
    expect((await books()).length).toBe(before); // a banner is not a price: no new book
  });

  test('pausing a campaign stops its offers at the till; resuming brings them back', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen, browser }) => {
    const t = tag('T');
    const code = tag('KT');
    const id = await makeCampaign(`Kasir ${t}`, { site_ids: ['store-01'] });
    const doc = restate((await campaignNamed(`Kasir ${t}`))!);
    const ruleId = await makeCouponRule(`Kasir ${t} 10%`, code, { kind: 'PERCENT', bps: 1000, compound: false }, { campaign: id, campaignDoc: doc });
    const epc = await floorEpc(TAS.sku);
    await shopSees(ruleId);
    const applied = async () => {
      const q = await quote([epc], { coupons: [code] });
      return q.promotions.find((p: any) => p.rule_id === ruleId);
    };
    await expect.poll(async () => (await applied())?.applied, { timeout: 90_000, intervals: [2000] }).toBe(true);
    expect((await applied()).benefit_minor).toBe(21_900); // 10% of Rp 219.000
    await app.open(`/commercial/campaigns?q=${t}`);
    await screen.getByRole('switch', `Pause Kasir ${t}`).tap();
    await screen.getByRole('dialog').getByRole('button', 'Pause').tap();
    await receipt(screen, browser, /^Paused — /);
    await expect.poll(async () => (await applied())?.applied, { timeout: 90_000, intervals: [2000] }).toBe(false);
    await screen.getByRole('switch', `Resume Kasir ${t}`).tap();
    await expect.poll(async () => (await applied())?.applied, { timeout: 90_000, intervals: [2000] }).toBe(true);
  });
});
