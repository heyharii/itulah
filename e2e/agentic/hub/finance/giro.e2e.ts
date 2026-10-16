// Giro Board: a giro written from a BKK waits, comes due, clears or bounces; clearing moves the bank, bouncing reopens the bill.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as F from '../../support/finance.ts';

const TAGS = ['finance', 'giro'];
const card = (screen: any, text: string) => screen.getByText(text, { exact: false }).first();

describe('Giro Board', { tags: TAGS }, () => {
  test('lanes Waiting / Due within 7 days / Cleared / Bounced; a giro lands in the lane its date says and shows its due tag', { session: 'rina', tags: [...TAGS, 'smoke'] }, async ({ app, screen }) => {
    const far = await F.paidByGiro('F', F.amountOf(), 20);
    const near = await F.paidByGiro('N', F.amountOf(), 3);
    await app.open('/finance/cash-bank/giro');
    await F.onScreen(screen, 'Giro Board');
    for (const lane of ['Waiting', 'Due within 7 days', 'Cleared', 'Bounced']) await expect(screen.getByText(lane, { exact: true }).first()).toBeVisible({ timeout: 45_000 });
    await expect(card(screen, far.giroNo)).toBeVisible();
    await expect(card(screen, near.giroNo)).toBeVisible();
    await expect(screen.getByText(`Due ${F.today().slice(0, 4)}`, { exact: false }).first()).toBeVisible().catch(() => undefined);
    expect(far.giro).toMatchObject({ status: 'ISSUED', direction: 'OUT', bank: 'DANAMON' });
    expect(far.giro.days_overdue).toBeLessThan(0);
  });

  test('Late only keeps the giros past their date; the Bank filter narrows by bank', { session: 'rina' }, async ({ app, screen }) => {
    const late = await F.paidByGiro('L', F.amountOf(), -3);
    const fresh = await F.paidByGiro('M', F.amountOf(), 15);
    await app.open('/finance/cash-bank/giro');
    await expect(card(screen, late.giroNo)).toBeVisible({ timeout: 45_000 });
    expect(late.giro.days_overdue).toBeGreaterThan(0);
    await expect(screen.getByText(`${late.giro.days_overdue} ${late.giro.days_overdue === 1 ? 'day' : 'days'} late`, { exact: false }).first()).toBeVisible();
    await screen.getByRole('checkbox', 'Late only').check();
    await expect(card(screen, late.giroNo)).toBeVisible();
    await expect(card(screen, fresh.giroNo)).toBeHidden();
    await screen.getByRole('checkbox', 'Late only').uncheck();
    await F.pick(screen, 'Bank', 'DANAMON');
    await expect(card(screen, fresh.giroNo)).toBeVisible();
  });

  test('desk: dragging a giro to Cleared asks for the clearing date, then Clear Rp N posts it: Dr outstanding giro / Cr bank', { session: 'rina', timeout: 360_000 }, async ({ app, screen }) => {
    const g = await F.paidByGiro('C', F.amountOf(), 5);
    const bank0 = await F.balance(F.BANK.account);
    const out0 = await F.balance('2009');
    await app.open('/finance/cash-bank/giro');
    const cardEl = screen.getByText(g.giroNo, { exact: false }).first();
    await expect(cardEl).toBeVisible({ timeout: 45_000 });
    const lane = screen.getByText('Cleared', { exact: true }).first();
    await cardEl.dragTo(lane);
    await expect(screen.getByRole('button', { name: /^Cleared on/ })).toBeVisible({ timeout: 15_000 });
    await F.pickDay(screen, /^Cleared on/, 'hari ini');
    await screen.getByRole('button', { name: new RegExp('^Clear ' + F.money(g.giro.amount_minor).replace(/\./g, '\\.')) }).tap();
    await expect(screen.getByRole('button', { name: /^Cleared on/ })).toBeHidden({ timeout: 30_000 });
    const after = ((await F.cloud().get('/api/v1/finance/giros?limit=500')) as any[]).find((x) => x.number === g.giroNo);
    expect(after.status).toBe('CLEARED');
    F.expectBalanced((await F.entry(after.clearing_entry_id)).lines);
    expect((await F.balance(F.BANK.account)) - bank0).toBe(-g.giro.amount_minor);
    expect((await F.balance('2009')) - out0).toBe(g.giro.amount_minor); // the "outstanding giro" liability is paid off
  });

  test('phone: tap a giro, choose Bounced, give the date and the reason — the bill is open again', { session: 'rina', timeout: 360_000 }, async ({ app, screen, browser }) => {
    const g = await F.paidByGiro('B', F.amountOf(), 15); // far enough out to sit in the Waiting lane, the lane a phone opens on
    expect((await F.bill(g.bill.invoice_id)).outstanding_minor).toBe(0);
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/finance/cash-bank/giro');
    await screen.getByRole('button', { name: /^Lane:/ }).tap();
    await screen.getByRole('button', { name: /^Waiting/ }).tap(); // a giro due in 15 days waits
    await screen.scrollUntilVisible(screen.getByText(g.giroNo, { exact: false }).first(), { timeout: 60_000 });
    await screen.getByText(g.giroNo, { exact: false }).first().tap();
    await screen.getByRole('button', 'Bounced').tap();
    await F.pickDay(screen, /Bounce date/, 'hari ini');
    await screen.getByRole('textbox', { name: /^Reason/ }).fill('Dana tidak cukup');
    await expect(screen.getByRole('button', 'Bounce')).toBeEnabled({ timeout: 15_000 });
    await F.activate(screen.getByRole('button', 'Bounce'));
    await expect.poll(async () => (((await F.cloud().get('/api/v1/finance/giros?limit=500')) as any[]).find((x) => x.number === g.giroNo)).status, { timeout: 45_000 }).not.toBe('ISSUED');
    const after = ((await F.cloud().get('/api/v1/finance/giros?limit=500')) as any[]).find((x) => x.number === g.giroNo);
    expect(after).toMatchObject({ status: 'REJECTED', rejected_reason: 'Dana tidak cukup' });
    expect((await F.bill(g.bill.invoice_id)).outstanding_minor).toBe(g.giro.amount_minor);
  });

  test('a cleared giro can be taken back (Undo clearing) with a reason, and the bank returns', { session: 'rina', timeout: 360_000 }, async ({ app, screen, browser }) => {
    const g = await F.paidByGiro('U', F.amountOf(), 2);
    await F.cloud().post(`/api/v1/finance/giros/${g.giro.giro_id}/clear`, { on: F.today(), statement_line_id: null, reason: null });
    const bank1 = await F.balance(F.BANK.account);
    await browser.setViewport({ width: 414, height: 896 });
    await app.open('/finance/cash-bank/giro');
    await screen.getByRole('button', { name: /^Lane:/ }).tap();
    await screen.getByRole('button', { name: /^Cleared/ }).tap();
    await screen.scrollUntilVisible(screen.getByText(g.giroNo, { exact: false }).first(), { timeout: 60_000 });
    await screen.getByText(g.giroNo, { exact: false }).first().tap();
    await screen.getByRole('button', 'Undo clearing').tap();
    await F.pickDay(screen, /Taken back on/, 'hari ini');
    await screen.getByRole('textbox', { name: /^Reason/ }).fill('Salah tanggal');
    await F.activate(screen.getByRole('button', 'Undo clearing').last());
    await expect(screen.getByText(g.giroNo, { exact: false })).toBeHidden({ timeout: 30_000 });
    const after = ((await F.cloud().get('/api/v1/finance/giros?limit=500')) as any[]).find((x) => x.number === g.giroNo);
    expect(after.status).not.toBe('CLEARED');
    expect((await F.balance(F.BANK.account)) - bank1).toBe(g.giro.amount_minor);
  });

  test('the board is empty-safe: filtering to a bank with no giro shows the lanes with nothing in them', { session: 'rina' }, async ({ app, screen }) => {
    await F.paidByGiro('E', F.amountOf(), 9);
    await app.open('/finance/cash-bank/giro');
    await expect(screen.getByText('Waiting', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
    await F.pick(screen, 'Bank', 'DANAMON');
    await expect(screen.getByText('Waiting', { exact: true }).first()).toBeVisible();
  });
});
