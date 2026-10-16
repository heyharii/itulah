// Promotions: the New promotion form — every effect, every scope, the validation messages, limits, schedule.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { books, closeList, publishSheet, has, makeCampaign, ruleNamed, tag, TAS } from '../../support/marketing.ts';

const TAGS = ['marketing', 'promotions'];

/** The name goes in first: leaving the empty box would add a problem line and shift every control below it. */
async function openForm(app: any, screen: any, name?: string) {
  await app.open('/commercial/promotions');
  await screen.getByRole('button', 'New promotion').first().tap();
  await expect(screen.getByRole('dialog')).toContainText('Summary', { timeout: 60_000 });
  const dialog = screen.getByRole('dialog');
  if (name !== undefined) await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
  return dialog;
}

/** Pick the Tas article in the Articles search. */
async function pickTas(screen: any) {
  const box = screen.getByRole('combobox', 'The articles this promotion applies to');
  await box.fill('Tas Selempang');
  await screen.getByRole('option').filter({ hasText: TAS.name }).first().tap();
  await closeList(screen); // close the open list; the choice stays
  await expect(screen.getByRole('dialog').getByRole('button', 'Publish')).toBeVisible();
}

async function coupon(dialog: any, code: string) {
  const limits = dialog.getByRole('button', { name: /^Limits/ });
  if ((await dialog.getByRole('textbox', 'Coupon code').count()) === 0) await limits.tap();
  await dialog.getByRole('textbox', 'Coupon code').fill(code);
}

/** Publish: the sheet closes only when the book is out (the receipt dialog is too short-lived to wait for). */
async function publish(screen: any) {
  await publishSheet(screen);
}

/** A new rule on the Tas article behind `code`: name, discount typed by the caller. */
async function fillBasics(dialog: any, screen: any, _name: string, code: string) {
  await pickTas(screen);
  await coupon(dialog, code);
}

describe('new promotion', { tags: TAGS }, () => {
  test('percent off on one article behind a coupon code is published and listed', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const name = `Persen ${tag('N')}`;
    const code = tag('KP');
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('20');
    await pickTas(screen);
    await coupon(dialog, code.toLowerCase());
    await has(dialog, '20% off', 'Code');
    await publish(screen);
    const rule = await ruleNamed(name);
    expect(rule).toBeDefined();
    expect(rule!.coupon_code).toBe(code); // upper-cased by the form
    expect(rule!.definition.effect).toMatchObject({ kind: 'PERCENT', bps: 2000 });
    expect(rule!.definition.scope.applicability).toMatchObject({ on: 'ARTICLE', article_codes: [TAS.article] });
    expect(rule!.status).toBe('ACTIVE');
    // the list shows it, with the code gate in its sheet
    await app.open(`/commercial/promotions?q=${name.replace(' ', '%20')}`);
    await expect(screen.getByRole('row').filter({ hasText: name })).toContainText('20% off', { timeout: 30_000 });
  });

  test('the quick percentages fill the field and the till preview rings it up', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    await expect(dialog).toContainText('Fill in the discount to see the summary.');
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Pratinjau ${tag('V')}`);
    await dialog.getByRole('button', '30%').tap();
    await expect(dialog.getByRole('textbox', 'Per cent off')).toHaveValue('30');
    await expect(dialog.getByRole('button', '30%')).toHaveAttribute('aria-pressed', 'true');
    await has(dialog, '30% off', '1 × Sample item', 'Rp 199.000', 'Rp 59.700', 'Total', 'Rp 139.300');
  });

  test('without a name, a discount or a target, Publish says what is missing, one thing at a time', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    const before = (await books()).length;
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Give the promotion a name.').first()).toBeVisible();
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Kosong ${tag('X')}`);
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Set the discount.').first()).toBeVisible();
    await dialog.getByRole('textbox', 'Per cent off').fill('15');
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Choose what it applies to.').first()).toBeVisible();
    expect((await books()).length).toBe(before); // nothing was published
  });

  test('a zero discount is not a discount', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Nol ${tag('Z')}`);
    await dialog.getByRole('textbox', 'Per cent off').fill('0');
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('Set the discount.').first()).toBeVisible();
  });

  test('amount off the basket writes an AMOUNT rule with the typed rupiah', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Potong ${tag('A')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('radio', 'Amount off').tap();
    await fillBasics(dialog, screen, name, tag('KA'));
    await dialog.getByRole('textbox', 'The figure this promotion applies').fill('25000');
    await has(dialog, 'Rp 25.000 off the basket');
    await publish(screen);
    const rule = await ruleNamed(name);
    expect(rule!.definition.effect).toEqual({ kind: 'AMOUNT', amount: { minor: 25_000 } });
  });

  test('a fixed price writes FIXED_UNIT_PRICE', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Harga pas ${tag('F')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('radio', 'Fixed price').tap();
    await fillBasics(dialog, screen, name, tag('KF'));
    await dialog.getByRole('textbox', 'The figure this promotion applies').fill('150000');
    await has(dialog, 'Rp 150.000 each');
    await publish(screen);
    expect((await ruleNamed(name))!.definition.effect).toEqual({ kind: 'FIXED_UNIT_PRICE', unit_price: { minor: 150_000 } });
  });

  test('buy X get Y: quantities and the reward percentage are written as typed', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Beli ${tag('B')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('radio', 'Buy X get Y').tap();
    await fillBasics(dialog, screen, name, tag('KB'));
    await dialog.getByRole('button', 'Units to buy in each bundle, one more').tap(); // 2 -> 3
    await dialog.getByRole('button', 'Rewarded units in each bundle, one more').tap(); // 1 -> 2
    await dialog.getByRole('button', '50%').tap();
    await has(dialog, 'Buy 3, get 2 at 50% off');
    await publish(screen);
    expect((await ruleNamed(name))!.definition.effect).toEqual({ kind: 'BUY_X_GET_Y', buy: 3, get: 2, reward_bps: 5000 });
  });

  test('buy two get one free is Buy X get Y at 100%', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Gratis ${tag('G')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('radio', 'Buy X get Y').tap();
    await fillBasics(dialog, screen, name, tag('KG'));
    await has(dialog, 'Buy 2, get 1 at 100% off'); // the defaults
    await publish(screen);
    expect((await ruleNamed(name))!.definition.effect).toEqual({ kind: 'BUY_X_GET_Y', buy: 2, get: 1, reward_bps: 10_000 });
  });

  test('a points offer asks for the spend per point and how it combines with a better rate', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Poin ${tag('O')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('radio', 'Points').tap();
    await expect(dialog).toContainText('With a better points offer');
    await fillBasics(dialog, screen, name, tag('KO'));
    await dialog.getByRole('textbox', 'The figure this promotion applies').fill('10000');
    await dialog.getByRole('radio', 'Add the extra').tap();
    await has(dialog, '1 point per Rp 10.000', 'Points earned', '19');
    await publish(screen);
    const rule = await ruleNamed(name);
    expect(rule!.definition.effect).toEqual({ kind: 'EARN_POINTS', mode: 'SPEND_RATE', spend_per_point: { minor: 10_000 } });
    expect(rule!.definition.points_combination).toBe('ADD');
  });

  test('the points combination question appears only under a points offer', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen, `Kombinasi ${tag('Y')}`);
    await expect(dialog).not.toContainText('With a better points offer');
    await dialog.getByRole('radio', 'Points').tap();
    await expect(dialog).toContainText('With a better points offer');
    await dialog.getByRole('radio', 'Amount off').tap();
    await expect(dialog).not.toContainText('With a better points offer');
  });

  test('a SKU scope writes the SKU codes', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Sku ${tag('K')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('5');
    await dialog.getByRole('radio', 'SKUs').tap();
    const box = screen.getByRole('combobox', 'The SKUs this promotion applies to');
    await box.fill(TAS.sku);
    await screen.getByRole('option').filter({ hasText: TAS.sku }).first().tap();
    await closeList(screen);
    await coupon(dialog, tag('KS'));
    await publish(screen);
    expect((await ruleNamed(name))!.definition.scope.applicability).toEqual({ on: 'SKU', sku_codes: [TAS.sku] });
  });

  test('a division scope offers the vocabulary and writes the division code', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Divisi ${tag('D')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('5');
    await dialog.getByRole('radio', 'Divisions').tap();
    await dialog.getByRole('combobox', 'The divisions this promotion applies to').tap();
    await screen.getByRole('option').filter({ hasText: 'Tas' }).first().tap();
    await closeList(screen);
    await coupon(dialog, tag('KD'));
    await has(dialog, '1 division');
    await publish(screen);
    const applicability = (await ruleNamed(name))!.definition.scope.applicability;
    expect(applicability.on).toBe('DIVISION');
    expect(applicability.divisions).toHaveLength(1);
  });

  test('a tag scope writes the tag code', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Tag ${tag('T')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('5');
    await dialog.getByRole('radio', 'Tags').tap();
    await dialog.getByRole('combobox', 'The tags this promotion applies to').tap();
    await screen.getByRole('option').filter({ hasText: 'Aksesori' }).first().tap();
    await closeList(screen);
    await coupon(dialog, tag('KT'));
    await publish(screen);
    const on = (await ruleNamed(name))!.definition.scope.applicability;
    expect(on.on).toBe('TAG');
    expect(on.tags).toHaveLength(1);
  });

  test('a whole-basket scope needs no article and says so in the summary', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Keranjang ${tag('W')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('5');
    await dialog.getByRole('radio', 'Whole basket').tap();
    await coupon(dialog, tag('KW'));
    await has(dialog, 'Whole basket', 'on the whole basket');
    await publish(screen);
    expect((await ruleNamed(name))!.definition.scope.applicability).toEqual({ on: 'WHOLE_CART' });
  });

  test('members only, sale items too and offer-blocking are written into the rule', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Aturan ${tag('R')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KR'));
    await dialog.getByRole('radio', 'Members only').tap();
    await dialog.getByRole('radio', 'Sale items too').tap();
    await dialog.getByRole('radio', 'Blocks offers on its items').tap();
    await has(dialog, 'Members', 'Sale items too', 'Blocks offers on its items');
    await publish(screen);
    const rule = (await ruleNamed(name))!.definition;
    expect(rule.scope.customers).toEqual({ who: 'MEMBERS' });
    expect(rule.markdown_policy).toBe('ALLOW');
    expect(rule.exclusive_scope).toBe('LINE');
  });

  test('the defaults are everyone, not on sale items, and blocks every other offer', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Bawaan ${tag('H')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KH'));
    await expect(dialog.getByRole('radio', 'Everyone')).toBeChecked();
    await expect(dialog.getByRole('radio', 'Not on sale items')).toBeChecked();
    await expect(dialog.getByRole('radio', 'Blocks every other offer')).toBeChecked();
    await publish(screen);
    const rule = (await ruleNamed(name))!.definition;
    expect(rule.scope.customers).toEqual({ who: 'EVERYONE' });
    expect(rule.markdown_policy).toBe('EXCLUDE');
    expect(rule.exclusive_scope).toBe('BASKET');
  });

  test('limits: minimums, budget, transaction caps and priority are written as numbers', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Batas ${tag('L')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KL'));
    await dialog.getByRole('textbox', 'Least matching units').fill('2');
    await dialog.getByRole('textbox', 'Least value of the matching lines').fill('100000');
    await dialog.getByRole('textbox', 'Budget').fill('500000');
    await dialog.getByRole('textbox', 'Most transactions').fill('40');
    await dialog.getByRole('textbox', 'Most transactions for one shopper').fill('2');
    await dialog.getByRole('textbox', 'Priority').fill('3');
    await has(dialog, 'Minimum items', 'Minimum basket', 'Rp 100.000', 'Budget', 'Rp 500.000', 'Transactions', 'Per shopper', 'Priority');
    await publish(screen);
    const rule = (await ruleNamed(name))!.definition;
    expect(rule.conditions.min_quantity).toBe(2);
    expect(rule.conditions.min_amount).toEqual({ minor: 100_000 });
    expect(rule.caps.budget).toEqual({ minor: 500_000 });
    expect(rule.caps.max_uses).toBe(40);
    expect(rule.max_uses_per_customer).toBe(2);
    expect(rule.priority).toBe(3);
  });

  test('the till preview refuses to discount under the minimum basket', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Minimum ${tag('M')}`);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await dialog.getByRole('button', { name: /^Limits/ }).tap();
    await dialog.getByRole('textbox', 'Least value of the matching lines').fill('300000');
    await has(dialog, 'Under the Rp 300.000 minimum.');
  });

  test('a start in a week is Scheduled, with its period written on the rule and in the list', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Jadwal ${tag('J')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KJ'));
    await dialog.getByRole('button', 'The day this promotion starts').tap();
    await screen.getByRole('button', 'In a week').tap();
    await dialog.getByRole('button', 'The last day this promotion runs').tap();
    await screen.getByRole('button', 'In a month').tap();
    await publish(screen);
    const rule = (await ruleNamed(name))!.definition;
    const from = new Date(rule.conditions.effective_from).getTime();
    const to = new Date(rule.conditions.effective_to).getTime();
    expect(from).toBeGreaterThan(Date.now() + 5 * 86_400_000);
    expect(to - from).toBeGreaterThan(28 * 86_400_000);
    await app.open(`/commercial/promotions?q=${name.replace(' ', '%20')}`);
    await expect(screen.getByRole('row').filter({ hasText: name })).toContainText('Scheduled', { timeout: 30_000 });
  });

  test('an end date before the start is flagged at the field and blocks Publish', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    const before = (await books()).length;
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Terbalik ${tag('U')}`);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await pickTas(screen);
    await dialog.getByRole('button', 'The last day this promotion runs').tap();
    await screen.getByRole('button', 'In a week').tap();
    await dialog.getByRole('button', 'The day this promotion starts').tap();
    await screen.getByRole('textbox', 'Type The day this promotion starts').fill('31 Dec 2026');
    await screen.getByRole('textbox', 'Type The day this promotion starts').press('Enter');
    await expect(dialog.getByText('The end date has to be after the start.').first()).toBeVisible();
    await dialog.getByRole('button', 'Publish').tap();
    await expect(dialog.getByText('The end date has to be after the start.').first()).toBeVisible();
    expect((await books()).length).toBe(before);
  });

  test('joining a campaign restates it unchanged and files the promotion under it', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('C');
    const campaignId = await makeCampaign(`Payung ${t}`, { headline: `Judul ${t}`, terms: `Syarat ${t}`, site_ids: ['store-01'] });
    const name = `Dalam ${t}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KC'));
    await dialog.getByRole('combobox', 'The campaign this offer belongs to').fill(`Payung ${t}`);
    await screen.getByRole('option').filter({ hasText: `Payung ${t}` }).first().tap();
    await publish(screen);
    expect((await ruleNamed(name))!.definition.campaign_id).toBe(campaignId);
    const camp = (await (await import('../../support/marketing.ts')).campaignNamed(`Payung ${t}`))!;
    const c = camp.campaign ?? camp;
    expect(c.headline).toBe(`Judul ${t}`); // the poster survived the restatement
    expect(c.terms).toBe(`Syarat ${t}`);
    expect(c.site_ids).toEqual(['store-01']); // and so did the store list
  });

  test('closing the form unpublished leaves the books as they were', { session: 'rina' }, async ({ app, screen }) => {
    const dialog = await openForm(app, screen);
    const before = (await books()).length;
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Batal ${tag('Q')}`);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await screen.getByRole('textbox', { name: /^Name/ }).press('Escape');
    await expect(screen.getByRole('dialog')).toBeHidden();
    expect((await books()).length).toBe(before);
  });

  test('a published promotion appears in the list and a banner never claims it reached nobody', { session: 'rina' }, async ({ app, screen }) => {
    const name = `Tersebar ${tag('Y')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('10');
    await fillBasics(dialog, screen, name, tag('KY'));
    await publish(screen);
    await expect(screen.getByText('Published, but no store is registered to receive it.')).toBeHidden();
    await expect(screen.getByText('Published — sent to 1 store')).toBeVisible();
  });

  test('a percentage above 100 is refused, not published', { session: 'rina', tags: [...TAGS, 'bug'] }, async ({ app, screen }) => {
    const name = `Seratus ${tag('H')}`;
    const dialog = await openForm(app, screen, name);
    await dialog.getByRole('textbox', 'Per cent off').fill('150');
    await fillBasics(dialog, screen, name, tag('KX'));
    await dialog.getByRole('button', 'Publish').tap();
    // either the dialog stays with a refusal, or it closes on a receipt: settle, then look at the books
    await expect(screen.getByRole('dialog').first()).toBeVisible({ timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 6_000));
    // whichever layer refuses it, a 150%-off promotion must not exist
    expect(await ruleNamed(name, { wait: false })).toBeUndefined();
  });
});
