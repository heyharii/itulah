// Vouchers: the book, tabs, search, filters, issuing, spending, cancelling, and the coupon reader.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { closeList, cloud, has, iso, ledger, see, tag, voucher } from '../../support/marketing.ts';

const TAGS = ['marketing', 'vouchers'];
const row = (screen: any, text: string) => screen.getByRole('row').filter({ hasText: text });
const search = (screen: any) => screen.getByRole('textbox').first();

/** Issue a voucher through the API (the thing under test is elsewhere). */
async function issue(code: string, value = 100_000, o: Record<string, unknown> = {}) {
  return cloud().post('/api/v1/commercial/vouchers', { code, kind: 'GIFT_CARD', value_minor: value, currency: 'IDR', site_id: 'store-01', note: `Uji ${code}`, ...o });
}
const spendApi = (code: string, amount: number) => cloud().post(`/api/v1/commercial/vouchers/${code}/redeem`, { amount_minor: amount });
const voidApi = (code: string) => cloud().post(`/api/v1/commercial/vouchers/${code}/void`, { reason: 'Uji coba pembatalan' });

describe('voucher book', { tags: TAGS }, () => {
  test('the seeded vouchers are listed with kind, member, face value, balance and status', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await expect(screen.getByRole('heading', 'Vouchers')).toBeVisible({ timeout: 60_000 });
    await has(row(screen, 'UNDIAN200'), 'Gift card', 'Anyone', 'Rp 200.000', 'Live');
    await has(row(screen, 'MAAF50BUDI'), 'Goodwill', 'Budi Santoso', 'Rp 50.000', 'Live');
    await has(row(screen, 'GIFT100SARI'), 'Gift card', 'Sari Wulandari', 'Rp 100.000', 'Rp 0', 'Spent');
  });

  test('the liability strip matches the cloud ledger', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await expect(screen.getByText('Outstanding')).toBeVisible({ timeout: 60_000 });
    const l = await ledger();
    const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');
    await see(screen, fmt(l.outstanding_minor), fmt(l.issued_minor), fmt(l.redeemed_minor), 'Issued', 'Spent', 'Cancelled', 'Expired');
  });

  test('Live, Spent and Cancelled tabs split the book by stored status', { session: 'rina' }, async ({ app, screen }) => {
    const t = tag('V');
    await issue(`LIVE${t}`);
    await issue(`SPNT${t}`, 30_000);
    await spendApi(`SPNT${t}`, 30_000);
    await issue(`VOID${t}`);
    await voidApi(`VOID${t}`);
    await app.open(`/commercial/vouchers?q=${t}`);
    await expect(row(screen, `LIVE${t}`)).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, `SPNT${t}`)).toBeVisible();
    await expect(row(screen, `VOID${t}`)).toBeVisible();
    await screen.getByRole('button', 'Live').tap();
    await expect(row(screen, `LIVE${t}`)).toBeVisible();
    await expect(row(screen, `SPNT${t}`)).toBeHidden();
    await screen.getByRole('button', 'Spent').tap();
    await expect(row(screen, `SPNT${t}`)).toContainText('Spent');
    await expect(row(screen, `LIVE${t}`)).toBeHidden();
    await screen.getByRole('button', 'Cancelled').tap();
    await expect(row(screen, `VOID${t}`)).toContainText('Cancelled');
    await expect(row(screen, `SPNT${t}`)).toBeHidden();
    await screen.getByRole('button', 'All').tap();
    await expect(row(screen, `LIVE${t}`)).toBeVisible();
  });

  test('search finds a voucher by code or by the member holding it', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await expect(row(screen, 'UNDIAN200')).toBeVisible({ timeout: 60_000 });
    await search(screen).fill('undian');
    await expect(row(screen, 'UNDIAN200')).toBeVisible();
    await expect(row(screen, 'MAAF50BUDI')).toBeHidden();
    await search(screen).fill('Budi');
    await expect(row(screen, 'MAAF50BUDI')).toBeVisible();
    await expect(row(screen, 'UNDIAN200')).toBeHidden();
    await search(screen).fill('tidak-ada-zzz');
    await expect(screen.getByText('No vouchers match.').first()).toBeVisible();
  });

  test('the Face value and Status filters narrow the book on the server', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers?f=face:gte:150000');
    await expect(row(screen, 'UNDIAN200')).toBeVisible({ timeout: 60_000 });
    await expect(row(screen, 'MAAF50BUDI')).toBeHidden();
    await app.open('/commercial/vouchers?f=status:is:SPENT');
    await expect(row(screen, 'GIFT100SARI')).toBeVisible({ timeout: 30_000 });
    await expect(row(screen, 'UNDIAN200')).toBeHidden();
  });

  test('with filters that match nothing, "Clear filters" brings the book back', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers?f=face:gte:999999999');
    await expect(screen.getByText('No vouchers match.').first()).toBeVisible({ timeout: 60_000 });
    await screen.getByRole('button', 'Clear filters').tap();
    await expect(row(screen, 'UNDIAN200')).toBeVisible();
  });

  test('Coupons lists every code and the promotion it unlocks', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await screen.getByRole('button', 'Coupons').tap();
    const sheet = screen.getByRole('dialog');
    await has(sheet, 'Coupons', 'HEMAT50', 'Kupon HEMAT50: potongan Rp 50.000', 'Anyone', '100');
  });
});

describe('issuing a voucher', { tags: TAGS }, () => {
  test('a gift card of a given value is minted with a code and opens its sheet', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    const before = (await ledger()).issued_minor;
    await screen.getByRole('button', 'New voucher').first().tap();
    const form = screen.getByRole('dialog');
    await form.getByRole('textbox', { name: /^Value/ }).fill('125000');
    const note = `Catatan ${tag('N')}`;
    await form.getByRole('textbox', 'Note').fill(note);
    await form.getByRole('button', 'Submit').tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Gift card · Rp 125.000', { timeout: 30_000 });
    await has(sheet, 'Live', 'Rp 125.000', 'Anyone', 'rina', note);
    expect((await ledger()).issued_minor).toBe(before + 125_000);
  });

  test('Submit stays disabled and a blurred empty value says "Enter a value."', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await screen.getByRole('button', 'New voucher').first().tap();
    const form = screen.getByRole('dialog');
    await expect(form.getByRole('button', 'Submit')).toBeDisabled();
    const value = form.getByRole('textbox', { name: /^Value/ });
    await value.focus();
    await form.getByRole('textbox', 'Note').focus();
    await expect(form.getByText('Enter a value.')).toBeVisible();
    await value.fill('5000');
    await expect(form.getByRole('button', 'Submit')).toBeEnabled();
  });

  test('refund and goodwill kinds, a typed code and an expiry are all kept', { session: 'rina' }, async ({ app, screen }) => {
    const code = `RF${tag('R')}`;
    await app.open('/commercial/vouchers');
    await screen.getByRole('button', 'New voucher').first().tap();
    const form = screen.getByRole('dialog');
    await form.getByRole('radio', 'Refund').tap();
    await form.getByRole('textbox', { name: /^Value/ }).fill('40000');
    await form.getByRole('textbox', 'Code').fill(code);
    await form.getByRole('button', /Expires/).tap();
    await screen.getByRole('textbox', 'Type a day').fill(iso(30));
    await screen.getByRole('textbox', 'Type a day').press('Enter');
    await form.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog')).toContainText(`Refund · Rp 40.000`, { timeout: 30_000 });
    const v = await voucher(code);
    expect(v.kind).toBe('REFUND');
    expect(v.issued_minor).toBe(40_000);
    expect(new Date(v.expires_at).getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
  });

  test('a voucher can be given to a member picked from the directory', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    await screen.getByRole('button', 'New voucher').first().tap();
    const form = screen.getByRole('dialog');
    await form.getByRole('radio', 'Goodwill').tap();
    await form.getByRole('textbox', { name: /^Value/ }).fill('20000');
    const box = form.getByRole('combobox', 'Member');
    await box.fill('Ayu');
    await screen.getByRole('option').filter({ hasText: 'Ayu Lestari' }).first().tap();
    await closeList(screen);
    await form.getByRole('button', 'Submit').tap();
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Goodwill · Rp 20.000', { timeout: 30_000 });
    await has(sheet, 'Ayu Lestari');
  });

  test('re-using an existing code is refused and mints nothing', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers');
    const before = (await ledger()).issued_minor;
    await screen.getByRole('button', 'New voucher').first().tap();
    const form = screen.getByRole('dialog');
    await form.getByRole('textbox', { name: /^Value/ }).fill('10000');
    await form.getByRole('textbox', 'Code').fill('UNDIAN200');
    await form.getByRole('button', 'Submit').tap();
    await expect(form.getByRole('button', 'Submit')).toBeEnabled({ timeout: 30_000 });
    expect((await ledger()).issued_minor).toBe(before);
    await expect(form.getByText('Voucher', { exact: false }).first()).toBeVisible(); // still on the form
  });
});

describe('one voucher', { tags: TAGS }, () => {
  test('the sheet reads kind, code, member, balance and ledger', { session: 'rina' }, async ({ app, screen }) => {
    await app.open('/commercial/vouchers?voucher=MAAF50BUDI');
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Goodwill · Rp 50.000', { timeout: 60_000 });
    await has(sheet, 'MAAF50BUDI', 'Budi Santoso', 'Expires', 'of Rp 50.000', 'Kompensasi');
    await sheet.getByRole('tab', { name: /^Ledger/ }).tap();
    await has(sheet, '+Rp 50.000');
  });

  test('spending part of a voucher lowers the balance and writes a ledger line', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const code = `SP${tag('S')}`;
    await issue(code, 100_000);
    await app.open(`/commercial/vouchers?voucher=${code}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Gift card · Rp 100.000', { timeout: 60_000 });
    await sheet.getByRole('button', 'Spend').tap();
    await expect(sheet.getByRole('button', 'Spend Rp 0')).toBeDisabled();
    await sheet.getByRole('textbox', { name: /^Amount/ }).fill('35000');
    await sheet.getByRole('button', 'Spend Rp 35.000').tap();
    await expect(sheet).toContainText('Gift card · Rp 65.000', { timeout: 30_000 });
    expect((await voucher(code)).balance_minor).toBe(65_000);
    await sheet.getByRole('tab', { name: /^Ledger/ }).tap();
    await has(sheet, '−Rp 35.000', 'Rp 65.000');
  });

  test('an amount above the balance is flagged and cannot be submitted', { session: 'rina' }, async ({ app, screen }) => {
    const code = `OV${tag('O')}`;
    await issue(code, 50_000);
    await app.open(`/commercial/vouchers?voucher=${code}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Gift card · Rp 50.000', { timeout: 60_000 });
    await sheet.getByRole('button', 'Spend').tap();
    await sheet.getByRole('textbox', { name: /^Amount/ }).fill('70000');
    await expect(sheet.getByText('Only Rp 50.000 is left.')).toBeVisible();
    await expect(sheet.getByRole('button', 'Spend Rp 70.000')).toBeDisabled();
  });

  test('spending the whole balance marks the voucher Spent and removes the actions', { session: 'rina' }, async ({ app, screen }) => {
    const code = `FU${tag('F')}`;
    await issue(code, 20_000);
    await app.open(`/commercial/vouchers?voucher=${code}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Gift card · Rp 20.000', { timeout: 60_000 });
    await sheet.getByRole('button', 'Spend').tap();
    await sheet.getByRole('textbox', { name: /^Amount/ }).fill('20000');
    await sheet.getByRole('button', 'Spend Rp 20.000').tap();
    await expect(sheet.getByText('Spent').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await voucher(code)).status, { timeout: 30_000 }).toBe('SPENT');
    await expect(sheet.getByRole('button', 'Spend')).toBeHidden();
    await expect(sheet.getByRole('button', 'Cancel voucher')).toBeHidden();
  });

  test('cancelling needs a reason of four characters, then voids the balance', { session: 'rina' }, async ({ app, screen }) => {
    const code = `CN${tag('C')}`;
    await issue(code, 60_000);
    const before = (await ledger()).voided_minor;
    await app.open(`/commercial/vouchers?voucher=${code}`);
    const sheet = screen.getByRole('dialog');
    await expect(sheet).toContainText('Gift card · Rp 60.000', { timeout: 60_000 });
    await sheet.getByRole('button', 'Cancel voucher').tap();
    const ask = screen.getByRole('dialog').last();
    await has(ask, `Cancel ${code}?`, "Rp 60.000 left on it can't be spent.");
    await ask.getByRole('textbox', { name: /^Reason/ }).fill('abc');
    await ask.getByRole('button', 'Cancel voucher').tap();
    await has(ask, 'Give a reason (at least 4 characters).');
    expect((await voucher(code)).status).toBe('ACTIVE');
    await ask.getByRole('textbox', { name: /^Reason/ }).fill('Salah terbit');
    await ask.getByRole('button', 'Cancel voucher').tap();
    await expect.poll(async () => (await voucher(code)).status, { timeout: 30_000 }).toBe('VOIDED');
    expect((await ledger()).voided_minor).toBe(before + 60_000);
    await expect(sheet.getByText('Cancelled').first()).toBeVisible();
    await expect(sheet.getByRole('button', 'Spend')).toBeHidden();
  });

  test('"Keep" in the cancel question leaves the voucher live', { session: 'rina' }, async ({ app, screen }) => {
    const code = `KP${tag('K')}`;
    await issue(code, 10_000);
    await app.open(`/commercial/vouchers?voucher=${code}`);
    await expect(screen.getByRole('dialog')).toContainText('Gift card · Rp 10.000', { timeout: 60_000 });
    await screen.getByRole('dialog').getByRole('button', 'Cancel voucher').tap();
    await screen.getByRole('dialog').last().getByRole('button', 'Keep').tap();
    expect((await voucher(code)).status).toBe('ACTIVE');
  });
});

describe('voucher rules the server holds', { tags: TAGS }, () => {
  test('a voucher that has already expired cannot be issued', { session: 'rina' }, async () => {
    const refused = await cloud().call('POST', '/api/v1/commercial/vouchers', { code: `PAST${tag('X')}`, kind: 'GIFT_CARD', value_minor: 10_000, currency: 'IDR', site_id: 'store-01', expires_at: '2026-10-01T00:00:00Z' }, { ok: false });
    expect(JSON.stringify(refused)).toContain('already expired');
  });

  test('a cancelled voucher cannot be spent', { session: 'rina' }, async () => {
    const code = `VD${tag('Y')}`;
    await issue(code, 10_000);
    await voidApi(code);
    const refused = await cloud().call('POST', `/api/v1/commercial/vouchers/${code}/redeem`, { amount_minor: 1_000 }, { ok: false });
    expect(refused?.error ?? JSON.stringify(refused)).toBeTruthy();
    const v = await voucher(code);
    expect(v.status).toBe('VOIDED');
    expect(v.balance_minor).toBe(0); // cancelling takes the balance out of circulation
  });

  test('a voucher cannot be spent beyond its balance', { session: 'rina' }, async () => {
    const code = `VB${tag('Z')}`;
    await issue(code, 10_000);
    const refused = await cloud().call('POST', `/api/v1/commercial/vouchers/${code}/redeem`, { amount_minor: 10_001 }, { ok: false });
    expect(JSON.stringify(refused)).toBeTruthy();
    expect((await voucher(code)).balance_minor).toBe(10_000);
  });
});
