// Promotions: the list, its phase tabs, search, the campaign filter and the sheet (read side).
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cloud, has, makeCampaign, publishBook, ruleDoc, ruleById, tag, TAS } from '../../support/marketing.ts';

const TAGS = ['marketing'];
const row = (screen: any, name: string) => screen.getByRole('row').filter({ hasText: name });
const search = (screen: any) => screen.getByRole('textbox').first();

/** A promotion on the Tas article behind a coupon code, so no other basket is touched. */
async function plant(name: string, o: { from?: string | null; to?: string | null; status?: string; customers?: 'MEMBERS' | 'EVERYONE' } = {}) {
  const id = `rule-${tag('').toLowerCase()}`;
  const coupon = tag('K');
  await publishBook(`Promotion: ${name}`, {
    rules: [ruleDoc(id, name, { kind: 'PERCENT', bps: 1000, compound: false }, { on: 'ARTICLE', article_codes: [TAS.article] }, { coupon, ...o })],
    coupons: [{ code: coupon, rule_id: id, active: true, valid_from: null, valid_to: null, max_uses: null }],
  });
  return { id, coupon };
}

describe('promotions list', { tags: [...TAGS, 'promotions'] }, () => {
  test('the seeded promotions are listed with phase, benefit and where they apply', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial/promotions');
    await expect(screen.getByRole('heading', 'Promotions')).toBeVisible({ timeout: 60_000 });
    const wanita = row(screen, 'Diskon 10% Koleksi Wanita');
    await has(wanita, 'Live', 'Wanita', '10% off');
    const sepatu = row(screen, 'Diskon 15% Sandal & Sepatu');
    await has(sepatu, 'Live', '15% off');
    const hemat = row(screen, 'Kupon HEMAT50: potongan Rp 50.000');
    await has(hemat, 'The whole basket', 'Rp 50.000 off the basket');
    const poin = row(screen, 'Poin member: 1 poin per Rp 10.000');
    await has(poin, 'members only', '1 point per Rp 10.000');
  });

  test('a promotion never fired reads "Never used"; one that fired reads its uses', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/promotions');
    const { id } = await plant(`Belum ${tag('P')}`);
    await app.open(`/commercial/promotions?q=${encodeURIComponent(id)}`);
    const found = await ruleById(id);
    await expect(row(screen, found!.name)).toContainText('Never used', { timeout: 30_000 });
  });

  test('phase tabs split Live, Scheduled and Ended and carry counts', { session: 'rina', tags: [...TAGS] }, async ({ app, screen }) => {
    const t = tag('P');
    const live = await plant(`Live ${t}`);
    const soon = await plant(`Soon ${t}`, { from: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const over = await plant(`Over ${t}`, { from: new Date(Date.now() - 9 * 86_400_000).toISOString(), to: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await app.open(`/commercial/promotions?q=${t}`);
    await expect(row(screen, `Live ${t}`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('button', { name: /^All 3/ })).toBeVisible();
    await screen.getByRole('button', { name: /^Scheduled/ }).tap();
    await expect(row(screen, `Soon ${t}`)).toContainText('Scheduled');
    await expect(row(screen, `Live ${t}`)).toBeHidden();
    await screen.getByRole('button', { name: /^Ended/ }).tap();
    await expect(row(screen, `Over ${t}`)).toContainText('Ended');
    await expect(row(screen, `Soon ${t}`)).toBeHidden();
    await screen.getByRole('button', { name: /^Live/ }).tap();
    await expect(row(screen, `Live ${t}`)).toContainText('Live');
    await expect(row(screen, `Over ${t}`)).toBeHidden();
    await screen.getByRole('button', { name: /^Paused/ }).tap();
    await expect(screen.getByText('No matches.')).toBeVisible();
    // the API agrees on the phases
    expect((await ruleById(live.id))!.status).toBe('ACTIVE');
    expect((await ruleById(over.id))!.definition.conditions.effective_to).not.toBeNull();
    expect((await ruleById(soon.id))!.definition.conditions.effective_from).not.toBeNull();
  });

  test('searching narrows by name and shows "No matches." when nothing fits', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('S');
    await plant(`Cari ${t}`);
    await app.open('/commercial/promotions');
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeVisible({ timeout: 60_000 });
    await search(screen).fill(`Cari ${t}`);
    await expect(row(screen, `Cari ${t}`)).toBeVisible();
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeHidden();
    await search(screen).fill(`zzz-nothing-${t}`);
    await expect(screen.getByText('No matches.')).toBeVisible();
  });

  test('the search also finds a promotion by its coupon code', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/promotions');
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeVisible({ timeout: 60_000 });
    await search(screen).fill('HEMAT50');
    await expect(row(screen, 'Kupon HEMAT50')).toBeVisible();
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeHidden();
  });

  test('arriving from a campaign narrows to its offers and says so', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/promotions?campaign=gajian-hemat');
    await expect(screen.getByText('Campaign:', { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('Gajian Hemat').first()).toBeVisible();
    await expect(row(screen, 'Kupon HEMAT50')).toBeVisible();
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeHidden();
    await screen.getByRole('button', 'Show every campaign').tap();
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeVisible();
    await expect(screen.getByText('Campaign:', { exact: false })).toBeHidden();
  });

  test('a campaign with no offers says so and offers New promotion', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('E');
    const id = await makeCampaign(`Kosong ${t}`);
    await app.open(`/commercial/promotions?campaign=${id}`);
    await expect(screen.getByText(`No promotions in Kosong ${t}.`)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole('button', 'New promotion').first()).toBeVisible();
  });

  test('a promotion opens as a sheet with Details, Stores and Activity', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/promotions');
    await row(screen, 'Kupon HEMAT50').tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Needs code HEMAT50', { timeout: 30_000 });
    await has(sheet, 'Kupon HEMAT50: potongan Rp 50.000', 'Live');
    await has(sheet, 'Benefit', 'Rp 50.000 off the basket', 'Campaign', 'Gajian Hemat', 'Minimum basket', 'Rp 300.000', 'Code', 'HEMAT50', 'Transactions limit', '100');
    await expect(sheet.getByRole('button', 'Change')).toBeEnabled();
    await expect(sheet.getByRole('button', 'Duplicate')).toBeEnabled();
    await sheet.getByRole('tab', { name: /^Stores/ }).tap();
    await has(sheet, 'rig store-01', 'In service');
    await sheet.getByRole('tab', 'Activity').tap();
    await expect(sheet.getByRole('tab', 'Activity')).toBeVisible();
  });

  test('a link to one promotion opens its sheet even when it is not on the first page', { session: 'rina' }, async ({ app, screen }) => {
    const { id } = await plant(`Tautan ${tag('L')}`);
    const rule = await ruleById(id);
    await app.open(`/commercial/promotions?rule=${id}`);
    await expect(screen.getByRole('dialog')).toContainText(rule!.name, { timeout: 60_000 });
    await has(screen.getByRole('dialog'), '10% off', 'Article 00000010', 'Needs code');
  });

  test('Sync usage to stores sends the counts and settles without an error', { session: 'rina' }, async ({ app, screen, browser }) => {
    await app.open('/commercial/promotions');
    await expect(screen.getByRole('button', 'Sync usage to stores')).toBeVisible({ timeout: 60_000 });
    const sent = browser.waitForResponse('**/api/v1/commercial/usage/publish');
    await screen.getByRole('button', 'Sync usage to stores').tap();
    expect((await sent).status).toBe(200);
    await expect(screen.getByRole('button', 'Sync usage to stores')).toBeEnabled();
    await expect(screen.getByText('Sent automatically every 5 minutes')).toBeVisible();
  });

  test('the Used filter "is 0" keeps promotions that never fired; "at least 1" keeps the ones that did', { session: 'rina' }, async ({ app, screen }) => {
    const { id } = await plant(`Sepi ${tag('U')}`);
    const idle = (await ruleById(id))!.name;
    await app.open('/commercial/promotions?f=usage:is:0');
    await expect(row(screen, idle)).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, 'Diskon 15% Sandal & Sepatu')).toBeHidden();
    await app.open('/commercial/promotions?f=usage:gte:1');
    await expect(row(screen, 'Diskon 15% Sandal & Sepatu')).toBeVisible({ timeout: 30_000 });
    await expect(row(screen, idle)).toBeHidden();
  });

  test('the Stores filter "is 1" keeps promotions every shop carries', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/promotions?f=reached:is:1');
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeVisible({ timeout: 60_000 });
    await app.open('/commercial/promotions?f=reached:is:0');
    await expect(row(screen, 'Diskon 10% Koleksi Wanita')).toBeHidden({ timeout: 30_000 });
  });

  test('the campaign named on a promotion links to that campaign\'s sheet', { session: 'rina' }, async ({ app, screen, browser }) => {
    await app.open('/commercial/promotions?rule=rule-hemat50');
    await expect(screen.getByRole('dialog')).toContainText('Gajian Hemat', { timeout: 60_000 });
    await screen.getByRole('dialog').getByRole('link', 'Gajian Hemat').tap();
    await expect(browser).toHaveURL(/\/commercial\/campaigns\?.*campaign=gajian-hemat/);
    await expect(screen.getByRole('dialog')).toContainText('gajian-hemat', { timeout: 60_000 });
  });
});
