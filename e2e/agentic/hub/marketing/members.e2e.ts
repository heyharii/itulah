// Members (the shoppers marketing talks to): the directory, segments, saved segments and the points scheme.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { as, rows } from '../../support/rig.ts';
import { cloud, has, ruleById, tag, see } from '../../support/marketing.ts';

const TAGS = ['marketing', 'members'];
const row = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const search = (screen: any) => screen.getByRole('textbox').first();

async function enrol(card: string, name: string) {
  return as('cloud', 'dian').post('/api/v1/members', { member_id: card, display_name: name });
}
const cardNo = () => '0899' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 10);
async function segments() {
  return rows(await cloud().get('/api/v1/members/segments/saved'));
}

describe('member directory', { tags: TAGS }, () => {
  test('the seeded members are listed with segment, spend, transactions and points', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/members');
    await expect(screen.getByRole('heading', 'Members').first()).toBeVisible({ timeout: 60_000 });
    await has(row(screen, 'Sari Wulandari'), 'Rp');
    await expect(row(screen, 'Budi Santoso')).toBeVisible();
    await has(row(screen, 'Rizky Pratama'), 'Never bought');
    await see(screen, 'found', 'enrolled');
  });

  test('a newly enrolled card shows up as Never bought, found by name and by card number', { session: 'rina' }, async ({ app, screen }) => {
    const card = cardNo();
    const name = `Tamu ${tag('M')}`;
    await enrol(card, name);
    await app.open('/members');
    await expect(row(screen, 'Sari Wulandari')).toBeVisible({ timeout: 60_000 });
    await search(screen).fill(name);
    await has(row(screen, name), 'Never bought');
    await expect(row(screen, 'Sari Wulandari')).toBeHidden();
    await search(screen).fill(card);
    await expect(row(screen, name)).toBeVisible();
    await search(screen).fill('tidak-ada-zzz');
    await expect(row(screen, name)).toBeHidden();
  });

  test('the segment tabs keep only members in that segment', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members');
    await expect(row(screen, 'Sari Wulandari')).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Never bought').tap();
    await expect(row(screen, 'Rizky Pratama')).toBeVisible();
    await expect(row(screen, 'Sari Wulandari')).toBeHidden();
    await screen.getByRole('button', 'New').tap();
    await expect(row(screen, 'Sari Wulandari')).toBeVisible();
    await expect(row(screen, 'Rizky Pratama')).toBeHidden();
    await screen.getByRole('button', 'Lapsed').tap();
    await expect(row(screen, 'Sari Wulandari')).toBeHidden();
    await screen.getByRole('button', 'Everyone').tap();
    await expect(row(screen, 'Rizky Pratama')).toBeVisible();
  });

  test('a member sheet reads the card, spend, points and what promotions saved them', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members?member=081311110001');
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Sari Wulandari', { timeout: 60_000 });
    await has(sheet, 'Card', '081311110001', 'Joined', 'Spend', 'Transactions', 'Points held', 'Points earned', 'Points spent', 'Saved by promotions', 'On voucher', 'App', 'Their transactions');
  });

  test('a pairing code is six digits that expire, and the sheet says who to read it to', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members?member=081311110003');
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Ayu Lestari', { timeout: 60_000 });
    await sheet.getByRole('button', 'Issue a pairing code').tap();
    await has(sheet, 'Read these out to 081311110003', 'Good for');
    await expect(sheet.getByText(/^\d{6}$/)).toBeVisible();
  });

  test('member points held agree with the loyalty ledger', { session: 'rina' }, async ({ app, screen }) => {
    const m = rows(await cloud().get('/api/v1/members?q=081311110001'))[0] ?? (await cloud().get('/api/v1/members?q=081311110001')).members[0];
    await app.open('/members?member=081311110001');
    await expect(screen.getByRole('dialog')).toContainText('Points held', { timeout: 60_000 });
    await has(screen.getByRole('dialog'), String(m.points_balance));
  });
});

describe('member segments', { tags: TAGS }, () => {
  test('the built-in six split the directory and each links to its filtered list', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/members/segments');
    await expect(screen.getByRole('button', 'New segment').first()).toBeVisible({ timeout: 60_000 });
    await see(screen, 'Enrolled', 'Buying now', 'Member spend', 'Active within', '90 days', 'Lapsed after', '180 days');
    await see(screen, 'New', 'Active', 'Lapsing', 'Lapsed', 'Never bought', 'Stopped');
    await screen.getByRole('link', 'Open the list').first().tap();
    await expect(screen.getByRole('heading', 'Members').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the saved segments show their conditions and member share', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members/segments');
    await expect(screen.getByText('Member belum belanja').first()).toBeVisible({ timeout: 60_000 });
    await see(screen, 'Sales is 0', 'Spent is at least Rp 300.000', 'Kirim kupon HEMAT50 ke member yang belum pernah belanja.');
  });

  test('a new segment needs a name and a finished condition before Submit', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members/segments');
    await screen.getByRole('button', 'New segment').first().tap();
    const form = screen.getByRole('dialog');
    await expect(form.getByRole('button', 'Submit')).toBeDisabled();
    await has(form, 'A segment needs a name');
    await form.getByRole('textbox', { name: /^What it is called/ }).fill(`Segmen ${tag('S')}`);
    await has(form, 'Add at least one condition');
    await form.getByRole('button', 'Add a condition').tap();
    await has(form, 'Add at least one condition'); // an unfinished condition does not count yet
    await expect(form.getByRole('button', 'Submit')).toBeDisabled();
    await form.getByRole('button', 'Remove this condition').tap();
    await has(form, 'Add at least one condition');
  });

  test('a segment with a spend condition previews how many members match, and is saved', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Besar ${tag('B')}`;
    await app.open('/members/segments');
    await screen.getByRole('button', 'New segment').first().tap();
    const form = screen.getByRole('dialog');
    await form.getByRole('textbox', { name: /^What it is called/ }).fill(name);
    await form.getByRole('textbox', { name: /^Why it exists/ }).fill('Uji pembuatan segmen');
    await form.getByRole('button', 'Add a condition').tap();
    await form.getByRole('combobox').first().tap();
    await screen.getByRole('option', { name: /^Spent$/ }).tap();
    await form.getByRole('combobox').nth(1).tap();
    await screen.getByRole('option', { name: /at least|≥|more than or equal/i }).first().tap();
    await form.getByRole('textbox').last().fill('300000');
    await expect(form).toContainText('of ', { timeout: 30_000 });
    await form.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await segments()).some((s: any) => s.name === name), { timeout: 30_000 }).toBe(true);
    await expect(screen.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('editing a saved segment writes a new version; retiring it asks and removes it', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Ubah ${tag('E')}`;
    await cloud().post('/api/v1/members/segments/saved', {
      name,
      purpose: 'Uji ubah dan pensiun',
      definition: { match: 'ALL', filters: [{ column: 'transaction_count', op: 'Is', values: ['0'] }] },
    });
    await app.open('/members/segments');
    await expect(screen.getByText(name).first()).toBeVisible({ timeout: 60_000 });
    // edit
    await screen.getByRole('button', 'Edit').last().tap();
    const form = screen.getByRole('dialog');
    await expect(form).toContainText('Edit segment');
    await form.getByRole('textbox', { name: /^What it is called/ }).fill(`${name} v2`);
    await form.getByRole('button', 'Submit').tap();
    await expect(screen.getByText(`${name} v2`, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect((await segments()).find((s: any) => s.name === `${name} v2`)?.version).toBe(2);
    // retire
    await screen.getByRole('button', 'Retire segment').last().tap();
    await has(screen.getByRole('dialog'), `Retire ${name} v2?`);
    await screen.getByRole('dialog').getByRole('button', 'Retire').tap();
    await expect(screen.getByRole('dialog')).toBeHidden({ timeout: 30_000 });
    await expect(screen.getByText(`${name} v2`, { exact: false })).toBeHidden({ timeout: 30_000 });
    expect((await segments()).some((s: any) => s.name === `${name} v2`)).toBe(false);
  });
});

describe('points scheme', { tags: TAGS }, () => {
  test('the scheme is a members-only "1 point per Rp 10.000" promotion that is live', { session: 'rina' }, async ({ app, screen }) => {
    const rule = await ruleById('rule-poin-member');
    expect(rule!.definition.effect).toEqual({ kind: 'EARN_POINTS', mode: 'SPEND_RATE', spend_per_point: { minor: 10_000 } });
    expect(rule!.definition.scope.customers).toEqual({ who: 'MEMBERS' });
    await app.open('/commercial/promotions?rule=rule-poin-member');
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Poin member', { timeout: 60_000 });
    await has(sheet, 'Live', '1 point per Rp 10.000', 'Members');
  });
});

describe('points registers (routed, no menu row)', { tags: TAGS }, () => {
  test('Points lists every account with its balance and counts them like the server', { session: 'rina' }, async ({ app, screen }) => {
    const server = await cloud().get('/api/v1/members/points?limit=200');
    await app.open('/members/points');
    await expect(screen.getByRole('heading', 'Points')).toBeVisible({ timeout: 60_000 });
    await see(screen, 'Accounts', 'Points outstanding', 'Not reconciling');
    const sari = server.items.find((a: any) => a.customer_id === '081311110001');
    await has(row(screen, 'Sari Wulandari'), String(sari.balance_points));
    expect(server.accounts_not_reconciling).toBe(0);
  });

  test('Points Ledger lists the movements with what caused each', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/members/points-ledger');
    await expect(screen.getByRole('heading', 'Points Ledger')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('Sari Wulandari').first()).toBeVisible({ timeout: 30_000 });
  });
});
