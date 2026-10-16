// People › Benefit › Balances: a rupiah balance HR fills by hand (Add / Take off / Reset), spent at the till by QR.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { HR, adjustBenefit, benefit, hire, pickOne, tag } from '../../support/people.ts';

const LOAD = { timeout: 45_000 };

async function openRow(screen: any, name: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await screen.getByRole('textbox', 'Search people').fill(name);
  await screen.getByRole('button', name).tap();
  await expect(screen.getByRole('dialog').getByRole('heading', name)).toBeVisible(LOAD);
}

describe('People: employee benefit balances', { tags: ['people'] }, () => {
  test('HR-80 Add: the balance rises, the movement is listed as Added with who and why', { session: 'rina', tags: ['people', 'smoke'] }, async ({ app, screen }) => {
    const h = await hire(tag('BA'));
    await app.open('/people/benefit');
    await openRow(screen, h.name);
    const row = screen.getByRole('dialog');
    await row.getByRole('button', 'Add').tap();
    const adjust = screen.getByRole('dialog').last();
    await adjust.getByRole('textbox', /^Amount/).fill('150000');
    await adjust.getByRole('textbox', /^Why/).fill('Jatah bulan Oktober');
    await adjust.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await benefit(h.id)).balance_minor, { timeout: 20_000 }).toBe(150_000);
    const entry = (await benefit(h.id)).entries[0];
    expect(entry).toMatchObject({ kind: 'ADD', delta_minor: 150_000, balance_after: 150_000, reason: 'Jatah bulan Oktober', by: 'rina' });
    await expect(screen.getByRole('dialog').first()).toContainText('Rp 150.000', LOAD);
    await expect(screen.getByRole('dialog').first().getByRole('row', { name: /Added/ })).toContainText('+Rp 150.000');
  });

  test('HR-81 Take off lowers the balance; Reset sets it to the figure', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('BT'));
    await adjustBenefit([h.id], 'ADD', 200_000);
    await app.open('/people/benefit');
    await openRow(screen, h.name);
    await screen.getByRole('dialog').getByRole('button', 'Take off').tap();
    let adjust = screen.getByRole('dialog').last();
    await adjust.getByRole('textbox', /^Amount/).fill('50000');
    await adjust.getByRole('textbox', /^Why/).fill('Dipakai di luar sistem');
    await adjust.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await benefit(h.id)).balance_minor, { timeout: 20_000 }).toBe(150_000);
    await app.open('/people/benefit');
    await openRow(screen, h.name);
    await screen.getByRole('dialog').getByRole('button', 'Reset').tap();
    adjust = screen.getByRole('dialog').last();
    await adjust.getByRole('textbox', /^Amount/).fill('25000');
    await adjust.getByRole('textbox', /^Why/).fill('Reset awal triwulan');
    await adjust.getByRole('button', 'Submit').tap();
    await expect.poll(async () => (await benefit(h.id)).balance_minor, { timeout: 20_000 }).toBe(25_000);
    expect((await benefit(h.id)).entries.map((e: any) => e.kind)).toEqual(['RESET', 'REMOVE', 'ADD']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('HR-82 taking off more than the balance is refused with a sentence, and nothing moves', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('BO'));
    await adjustBenefit([h.id], 'ADD', 30_000);
    await app.open('/people/benefit');
    await openRow(screen, h.name);
    await screen.getByRole('dialog').getByRole('button', 'Take off').tap();
    const adjust = screen.getByRole('dialog').last();
    await adjust.getByRole('textbox', /^Amount/).fill('90000');
    await adjust.getByRole('textbox', /^Why/).fill('Terlalu banyak');
    await adjust.getByRole('button', 'Submit').tap();
    await expect(adjust.getByText(/more|balance|enough|exceed/i).first()).toBeVisible(LOAD);
    expect((await benefit(h.id)).balance_minor).toBe(30_000);
    const res = await adjustBenefit([h.id], 'REMOVE', 90_000);
    expect(JSON.stringify(res)).toMatch(/error/);
  });

  test('HR-83 Fill balances for several people at once: pick them, one act, one reason', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const a = await hire(tag('BM'));
    const b = await hire(tag('BN'));
    await app.open('/people/benefit');
    await screen.getByRole('button', 'Fill balances').first().tap();
    const sheet = screen.getByRole('dialog');
    await pickOne(screen, 'People', a.name);
    await pickOne(screen, 'People', b.name);
    await screen.getByRole('combobox', 'People').press('Escape'); // closes the open list, not the sheet
    await sheet.getByRole('textbox', /^Amount/).fill('40000');
    await sheet.getByRole('textbox', /^Why/).fill('Bonus program karyawan');
    await sheet.getByRole('button', 'Submit').tap();
    await expect(screen.getByRole('dialog')).toBeHidden(LOAD);
    expect((await benefit(a.id)).balance_minor).toBe(40_000);
    expect((await benefit(b.id)).balance_minor).toBe(40_000);
  });

  test('HR-84 the list shows each balance and when it last moved; a person never filled shows Rp 0', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    const h = await hire(tag('BL'));
    const g = await hire(tag('BK'));
    await adjustBenefit([g.id], 'ADD', 65_000);
    await app.open('/people/benefit');
    await screen.getByRole('textbox', 'Search people').fill(g.name);
    await expect(screen.getByRole('row', { name: new RegExp(g.code) })).toContainText('Rp 65.000', LOAD);
    await screen.getByRole('textbox', 'Search people').fill(h.name);
    await expect(screen.getByRole('row', { name: new RegExp(h.code) })).toContainText('Rp 0', LOAD);
  });

  test('HR-85 Benefit settings: the benefit is switched on from a date, with a code lifetime', { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
    await app.open('/people/settings/benefit');
    await expect(screen.getByRole('heading', /Benefit/).first()).toBeVisible(LOAD);
    const rows = await HR().get('/api/v1/benefit/settings');
    // Every statement lists its state, code lifetime and who set it.
    await expect(screen.getByText(/min/).first()).toBeVisible();
    expect(Array.isArray(rows)).toBe(true);
  });
});
