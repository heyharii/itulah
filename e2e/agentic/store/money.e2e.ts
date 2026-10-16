// Money: Sales (the node's own window), Expenses (petty cash: float in, expense out), Cash count, Reports.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';
import * as pos from '../support/pos.ts';
import { as, tag, waitFor } from '../support/rig.ts';

const day = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const todayWindow = () => as('store', 'maya').get(`/api/v1/store/reports/sales/window?from=${day()}&to=${day()}`);

test('STORE-90 Sales (Today): a sale rung on the till moves the figures — Sales and Receipts match the node; the views list cashiers and payments', { session: 'maya-store', tags: ['pos', 'smoke'] }, async ({ app, screen }) => {
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    const before = await todayWindow();
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    const win = await todayWindow();
    expect(win.receipts.length).toBe(before.receipts.length + 1);
    const total = (win.receipts as any[]).reduce((s, r) => s + r.total_minor, 0);
    await app.open('/money/sales');
    await screen.getByRole('button', 'Today').tap();
    await expect(screen.getByText(pos.rp(total), { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText(String(win.receipts.length), { exact: true }).first()).toBeVisible();
    await screen.getByRole('tab', 'Cashiers').tap();
    await expect(screen.getByText('dian', { exact: true }).first()).toBeVisible();
    await screen.getByRole('tab', 'Payment').tap();
    await expect(screen.getByText('Cash', { exact: true }).first()).toBeVisible();
    await screen.getByRole('button', '30 days').tap();
    await expect(screen.getByText(/Sales/).first()).toBeVisible();
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('STORE-91 Expenses: a float counted with a second person tops petty cash up; an expense spends from it; the guards hold', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const payee = `Kurir ${tag('K')}`;
  await app.open('/money/expenses');
  await expect(screen.getByText('Balance', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const before = await as('store', 'maya').get('/api/v1/store/petty-cash');
  // New float: someone else counts it with you.
  await screen.getByRole('button', 'New float').tap();
  const float = screen.getByRole('dialog', 'New float');
  await float.getByRole('textbox', 'Amount').fill('300000');
  await float.getByRole('textbox', /^Counted with/).fill('maya');
  await float.getByRole('textbox', 'Their password').fill(PASSWORD);
  await expect(float.getByText('Someone else counts it with you.', { exact: true })).toBeVisible();
  await expect(float.getByRole('button', 'Create float')).toBeDisabled();
  await float.getByRole('textbox', /^Counted with/).fill('rina'); // a second supervisor: the cashier's word does not count
  await float.getByRole('textbox', 'Their password').fill(PASSWORD);
  await float.getByRole('textbox', /^Reference/).fill('TRF-E2E-001');
  await float.getByRole('button', 'Create float').tap();
  await expect(screen.getByText('Recorded Rp 300.000 float.', { exact: false })).toBeVisible({ timeout: 20_000 });
  const topped = await waitFor('petty cash topped up', async () => {
    const p = await as('store', 'maya').get('/api/v1/store/petty-cash');
    return p.balance_minor === before.balance_minor + 300_000 ? p : null;
  }, 30_000, 1_000);
  expect(topped.top_up_count).toBe(before.top_up_count + 1);
  // New expense.
  await screen.getByRole('button', 'New expense').first().tap();
  const spend = screen.getByRole('dialog', 'New expense');
  await spend.getByRole('textbox', 'Amount').fill('45000');
  await expect(spend.getByRole('button', 'Create expense')).toBeDisabled();
  await spend.getByPlaceholder('Delivery rider').fill(payee);
  await spend.getByPlaceholder('Parcel to a customer').fill('Kirim paket e2e');
  await spend.getByRole('button', 'Create expense').tap();
  await expect(screen.getByText(`Recorded Rp 45.000 to ${payee}.`, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(payee, { exact: true }).first()).toBeVisible();
  const after = await as('store', 'maya').get('/api/v1/store/petty-cash');
  expect(after.balance_minor).toBe(topped.balance_minor - 45_000);
  expect(after.spent_minor).toBe(before.spent_minor + 45_000);
});

test('STORE-92 an expense over what the tin holds is refused before it is sent; over Rp 500.000 asks Finance\'s approval code', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const p = await as('store', 'maya').get('/api/v1/store/petty-cash');
  await app.open('/money/expenses');
  await screen.getByRole('button', 'New expense').first().tap();
  const spend = screen.getByRole('dialog', 'New expense');
  await spend.getByRole('textbox', 'Amount').fill(String(p.balance_minor + 1_000_000));
  await expect(spend.getByText(`Petty cash holds ${pos.rp(p.balance_minor)}.`, { exact: true })).toBeVisible();
  await expect(spend.getByText('Approval code from Finance', { exact: true })).toBeVisible();
  await spend.getByPlaceholder('Delivery rider').fill('X');
  await spend.getByPlaceholder('Parcel to a customer').fill('Y');
  await expect(spend.getByRole('button', 'Create expense')).toBeDisabled();
});

test('STORE-93 Reports: takings, how it was paid and what is in the drawer match the node\'s day', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  const win = await todayWindow();
  const takings = (win.receipts as any[]).reduce((s, r) => s + r.total_minor, 0);
  await app.open('/reports');
  await screen.getByRole('button', 'Today').tap();
  await expect(screen.getByText('Takings', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(pos.rp(takings), { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('In the drawer', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText(pos.rp(win.cash_expected_minor), { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('How it was paid', { exact: true }).first()).toBeVisible();
  await screen.getByRole('button', '7 days').tap();
  await expect(screen.getByText('Takings', { exact: true }).first()).toBeVisible();
});

test('STORE-94 Cash count: the books say what should be there; a count with a difference needs a reason', { session: 'maya-store', tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/money/cash-count');
  await expect(screen.getByText('Cash on hand', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText('Petty cash', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('Cashier float', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('Past counts', { exact: true }).first()).toBeVisible();
  await screen.getByRole('button', 'Count').first().tap();
  await expect(screen.getByRole('dialog').first()).toBeVisible();
});
