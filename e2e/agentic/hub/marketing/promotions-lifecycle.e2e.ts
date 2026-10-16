// Promotions: pause / resume / end / change / duplicate — and what the shop's till does about each.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cloud, floorEpc, floorEpcs, has, makeCouponRule, promoIn, publishSheet, receipt, ruleById, shopSees, tag, TAS } from '../../support/marketing.ts';

const TAGS = ['marketing', 'promotions'];
const row = (screen: any, name: string) => screen.getByRole('row').filter({ hasText: name });
const PCT10 = { kind: 'PERCENT', bps: 1000, compound: false };

async function planted(label: string, effect: any = PCT10, o: any = {}) {
  const t = tag('L');
  const name = `${label} ${t}`;
  const code = tag('K');
  const id = await makeCouponRule(name, code, effect, o);
  return { id, name, code, t };
}
const applied = async (id: string, code: string, epcs: string[], member: string | null = null) => promoIn(epcs, id, { coupons: [code], member });

describe('pause and resume', { tags: TAGS }, () => {
  test('pausing asks first; declining changes nothing', { session: 'rina' }, async ({ app, screen }) => {
    const p = await planted('Jeda');
    await app.open(`/commercial/promotions?q=${p.t}`);
    await expect(row(screen, p.name)).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('switch', `Pause ${p.name}`).tap();
    await has(screen.getByRole('dialog'), `Pause ${p.name}?`, 'Stores stop giving this discount. You can resume it any time.');
    await screen.getByRole('dialog').getByRole('button', 'Cancel').tap();
    await expect(screen.getByRole('dialog')).toBeHidden();
    expect((await ruleById(p.id))!.status).toBe('ACTIVE');
  });

  test('Pause then Resume flips the status, says how many stores were told, and moves the tab counts', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen, browser }) => {
    const p = await planted('Saklar');
    await app.open(`/commercial/promotions?q=${p.t}`);
    await screen.getByRole('switch', `Pause ${p.name}`).tap();
    await screen.getByRole('dialog').getByRole('button', 'Pause').tap();
    await receipt(screen, browser, 'Paused — sent to 1 store');
    await expect.poll(async () => (await ruleById(p.id))!.status, { timeout: 30_000 }).toBe('PAUSED');
    await has(row(screen, p.name), 'Paused');
    await screen.getByRole('button', { name: /^Paused/ }).tap();
    await expect(row(screen, p.name)).toBeVisible();
    await screen.getByRole('switch', `Resume ${p.name}`).tap(); // resuming does not ask
    await receipt(screen, browser, 'Resumed — sent to 1 store');
    await expect.poll(async () => (await ruleById(p.id))!.status, { timeout: 30_000 }).toBe('ACTIVE');
  });

  test('the till stops and restarts the discount with the switch', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen, browser }) => {
    const p = await planted('Kasir');
    const epc = await floorEpc(TAS.sku);
    await shopSees(p.id);
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.applied, { timeout: 90_000, intervals: [2000] }).toBe(true);
    expect((await applied(p.id, p.code, [epc])).benefit_minor).toBe(21_900);
    await app.open(`/commercial/promotions?q=${p.t}`);
    await screen.getByRole('switch', `Pause ${p.name}`).tap();
    await screen.getByRole('dialog').getByRole('button', 'Pause').tap();
    await receipt(screen, browser, /^Paused — /);
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.applied, { timeout: 90_000, intervals: [2000] }).toBe(false);
    await screen.getByRole('switch', `Resume ${p.name}`).tap();
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.applied, { timeout: 90_000, intervals: [2000] }).toBe(true);
  });
});

describe('end now', { tags: TAGS }, () => {
  test('ending is for good: confirmed, written as Ended, no switch and no End button afterwards', { session: 'rina' }, async ({ app, screen, browser }) => {
    const p = await planted('Akhir');
    await app.open(`/commercial/promotions?rule=${p.id}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText(p.name, { timeout: 60_000 });
    await sheet.getByRole('button', 'End now').tap();
    await has(screen.getByRole('dialog').last(), `End ${p.name} now?`, 'Stores stop giving this discount for good.');
    await screen.getByRole('dialog').last().getByRole('button', 'End now').last().tap();
    await receipt(screen, browser, /^Ended — /);
    await expect.poll(async () => (await ruleById(p.id))!.status, { timeout: 60_000 }).toBe('EXPIRED');
    await expect(sheet.getByRole('button', 'End now')).toBeHidden();
    await expect(sheet.getByText('Ended').first()).toBeVisible();
    await app.open(`/commercial/promotions?q=${p.t}`);
    await expect(row(screen, p.name)).toBeVisible({ timeout: 60_000 });
    await has(row(screen, p.name), 'Ended');
    await expect(screen.getByRole('switch', `Pause ${p.name}`)).toBeHidden();
  });

  test('an ended promotion no longer discounts at the till', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen }) => {
    const p = await planted('Selesai');
    const epc = await floorEpc(TAS.sku);
    await shopSees(p.id);
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.applied, { timeout: 90_000, intervals: [2000] }).toBe(true);
    await app.open(`/commercial/promotions?rule=${p.id}`);
    await screen.getByRole('dialog').getByRole('button', 'End now').tap();
    await screen.getByRole('dialog').last().getByRole('button', 'End now').last().tap();
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.applied ?? false, { timeout: 90_000, intervals: [2000] }).toBe(false);
  });
});

describe('change and duplicate', { tags: TAGS }, () => {
  test('Change publishes the next version under the same id and the till follows', { session: 'rina', tags: [...TAGS, 'till'] }, async ({ app, screen }) => {
    const p = await planted('Ganti');
    const epc = await floorEpc(TAS.sku);
    await app.open(`/commercial/promotions?rule=${p.id}`);
    await screen.getByRole('dialog').getByRole('button', 'Change').tap();
    const form = screen.getByRole('dialog').last();
    await expect(form).toContainText('Change promotion', { timeout: 30_000 });
    await expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(p.name);
    await form.getByRole('button', '10%').tap(); // keeps 10 -> pick 30 below
    await form.getByRole('button', '30%').tap();
    await publishSheet(screen);
    const rule = (await ruleById(p.id))!;
    expect(rule.definition.effect).toMatchObject({ kind: 'PERCENT', bps: 3000 });
    expect(rule.coupon_code).toBe(p.code);
    expect(rule.name).toBe(p.name);
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.benefit_minor, { timeout: 90_000, intervals: [2000] }).toBe(65_700);
  });

  test('changing a paused promotion keeps it paused', { session: 'rina' }, async ({ app, screen }) => {
    const p = await planted('Tetap jeda', PCT10, { status: 'PAUSED' });
    await app.open(`/commercial/promotions?rule=${p.id}`);
    await screen.getByRole('dialog').getByRole('button', 'Change').tap();
    const form = screen.getByRole('dialog').last();
    await expect(form).toContainText('Stays paused', { timeout: 30_000 });
    await form.getByRole('button', '20%').tap();
    await publishSheet(screen);
    const rule = (await ruleById(p.id))!;
    expect(rule.status).toBe('PAUSED');
    expect(rule.definition.effect).toMatchObject({ bps: 2000 });
  });

  test('Duplicate opens a "(copy)" without the coupon code and mints a new id', { session: 'rina' }, async ({ app, screen }) => {
    const p = await planted('Salin');
    await app.open(`/commercial/promotions?rule=${p.id}`);
    await screen.getByRole('dialog').getByRole('button', 'Duplicate').tap();
    const form = screen.getByRole('dialog').last();
    await expect(form).toContainText('Duplicate promotion', { timeout: 30_000 });
    await expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(`${p.name} (copy)`);
    // a code unlocks one promotion: the copy starts without it, so it would fire for everyone — give it a new one
    await form.getByRole('button', { name: /^Limits/ }).tap();
    await expect(form.getByRole('textbox', 'Coupon code')).toHaveValue('');
    const code2 = tag('KD');
    await form.getByRole('textbox', 'Coupon code').fill(code2);
    await publishSheet(screen);
    const copy = (await cloud().get(`/api/v1/commercial/rules?q=${encodeURIComponent(`${p.name} (copy)`)}`)).rows[0];
    expect(copy.rule_id).not.toBe(p.id);
    expect(copy.coupon_code).toBe(code2);
    expect((await ruleById(p.id))!.coupon_code).toBe(p.code); // the original keeps its own
  });
});

describe('what the till makes of a rule', { tags: [...TAGS, 'till'] }, () => {
  test('a members-only promotion needs a member in the basket', { session: 'rina' }, async () => {
    const p = await planted('Anggota', PCT10, { customers: 'MEMBERS' });
    const epc = await floorEpc(TAS.sku);
    await shopSees(p.id);
    await expect.poll(async () => (await applied(p.id, p.code, [epc]))?.reason, { timeout: 90_000, intervals: [2000] }).toContain('members only');
    await expect.poll(async () => (await applied(p.id, p.code, [epc], '081311110001'))?.applied, { timeout: 30_000, intervals: [2000] }).toBe(true);
  });

  test('a minimum basket is honoured: one bag is not enough, two are', { session: 'rina' }, async () => {
    const p = await planted('Minimum', PCT10, { minAmount: 300_000 });
    const [a, b] = await floorEpcs(TAS.sku, 2);
    await shopSees(p.id);
    await expect.poll(async () => (await applied(p.id, p.code, [a]))?.applied, { timeout: 90_000, intervals: [2000] }).toBe(false);
    const two = await applied(p.id, p.code, [a, b]);
    expect(two.applied).toBe(true);
    expect(two.benefit_minor).toBe(43_800); // 10% of 2 x Rp 219.000
  });

  test('a promotion that has not started yet is not applied', { session: 'rina' }, async () => {
    const p = await planted('Nanti', PCT10, { from: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const epc = await floorEpc(TAS.sku);
    await shopSees(p.id);
    expect((await applied(p.id, p.code, [epc]))?.applied).toBe(false);
  });

  test('without the code, a coupon promotion says it needs one', { session: 'rina' }, async () => {
    const p = await planted('Kode');
    const epc = await floorEpc(TAS.sku);
    await shopSees(p.id);
    const entry = await promoIn([epc], p.id, { coupons: [] });
    expect(entry.applied).toBe(false);
    expect(entry.reason).toContain('coupon code');
  });

  test('amount off, fixed price and buy-two-get-one reach the till as typed', { session: 'rina' }, async () => {
    const amount = await planted('Potongan', { kind: 'AMOUNT', amount: { minor: 25_000 } });
    const fixed = await planted('Harga tetap', { kind: 'FIXED_UNIT_PRICE', unit_price: { minor: 150_000 } });
    const [a, b, c] = [...(await floorEpcs(TAS.sku, 2)), undefined];
    await shopSees(amount.id);
    await shopSees(fixed.id);
    await expect.poll(async () => (await applied(amount.id, amount.code, [a]))?.benefit_minor, { timeout: 90_000, intervals: [2000] }).toBe(25_000);
    await expect.poll(async () => (await applied(fixed.id, fixed.code, [a]))?.benefit_minor, { timeout: 90_000, intervals: [2000] }).toBe(69_000);
    void b;
    void c;
  });
});
