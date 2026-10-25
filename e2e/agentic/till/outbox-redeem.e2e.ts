// The outbox (a sale the node has not answered is kept on the till and re-sent), a sale the node refuses,
// and Poin (a member's points → a voucher, asked for by the cashier and approved by the shopper).
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';
import { as, waitFor } from '../support/rig.ts';

test('TILL-70 node unreachable at payment: "Tersimpan di terminal", the shift cannot close, and the sale is re-sent when the line returns', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  const started = Date.now() - 2_000;
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    await browser.route('**/api/v1/store/sales', (route: any) => route.abort());
    await screen.getByRole('button', 'Selesaikan transaksi').tap();
    await expect(screen.getByRole('dialog', 'Tersimpan di terminal')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^Menunggu terkirim ke node — dikirim ulang otomatis\./)).toBeVisible();
    expect(await pos.placeOf(unit.epc)).toBe(pos.FLOOR);
    await screen.getByRole('button', 'Transaksi berikutnya').tap();
    await expect(screen.getByText('1 belum terkirim', { exact: true })).toBeVisible();
    await expect(screen.getByText('1 penjualan menunggu terkirim', { exact: true })).toBeVisible();
    // A drawer cannot be closed over a sale the node has not heard of.
    await screen.getByRole('button', /Shift & kas/).tap();
    await expect(screen.getByText('1 penjualan belum terkirim ke node — tunggu sampai terkirim sebelum menutup shift.', { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', 'Tutup shift')).toBeDisabled();
    // The line comes back; the counter re-sends on its own when it comes to rest.
    await browser.unroute('**/api/v1/store/sales');
    await screen.getByRole('button', 'Kembali ke konter').tap();
    await expect(screen.getByText('Semua penjualan terkirim', { exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(screen.getByText('1 belum terkirim', { exact: true })).toBeHidden();
    const sale = await waitFor('the re-sent sale at the node', () => pos.newestSale(due, started), 30_000, 1_000);
    saleId = sale.id;
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-71 a sale the node refuses (the unit was sold elsewhere): a refused banner with the node\'s sentence, Buang clears it', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  let theirs: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.payTotal(t);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    // Meanwhile the unit is rung up on another seat.
    theirs = (await pos.sellByApi([unit.epc])).sale_id;
    await screen.getByRole('button', 'Selesaikan transaksi').tap();
    await expect(screen.getByRole('dialog', 'Tersimpan di terminal')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Transaksi berikutnya').tap();
    await expect(screen.getByText('1 penjualan ditolak node — selesaikan sebelum tutup shift.', { exact: true }).first()).toBeVisible();
    const gone = await browser.onDialog('accept');
    await screen.getByRole('button', 'Buang').tap();
    await expect(screen.getByText('1 penjualan ditolak node — selesaikan sebelum tutup shift.', { exact: true })).toBeHidden();
    await gone();
  } finally {
    await pos.restoreSale(theirs, unit.epc);
  }
});

// Poin (owner, 25 Oct 2026): the cashier types how many points, the shopper approves — in the member app, or by reading back
// the six digits head office sends to their WhatsApp. A test can do the first (the shopper-app REST path, `pos.memberApp`)
// and never the second: the code goes to WhatsApp and nowhere else. NOT RUN against the new Bayar yet: the helpers
// `goToPayment` / `payTotal` still look for the old "Metode pembayaran" screen, so these reach Bayar by its own button
// (`pos.openBayarForMember`).
test('TILL-72 Poin: the cashier types the points, the shopper approves in the member app — the row turns into a voucher and the points leave the balance', { tags: ['pos'] }, async (fx) => {
  const { screen } = fx;
  const member = pos.MEMBER.id;
  const POINTS = 10;
  const unit = await pos.pickUnit('plain');
  try {
    const before = await pos.pointsOf(member);
    test.skip(before < POINTS, `${member} holds ${before} points, fewer than the ${POINTS} this test spends`);
    const app = await pos.memberApp(member);
    await pos.openBayarForMember(fx, unit.epc, member);
    await pos.askPoints(fx, POINTS);
    const ask = await waitFor('the ask in the member app', () => app.waiting(), 20_000, 1_000);
    expect(ask).toMatchObject({ points: POINTS, status: 'PENDING' });
    await expect(screen.getByText(pos.rpRe(ask.value_minor, `${POINTS} poin = `))).toBeVisible();
    // The shopper taps Approve; the till finds the voucher on its next look (every two seconds).
    await app.approve(ask.request_id);
    await expect(screen.getByText(pos.rpRe(ask.value_minor, `${POINTS} poin ditukar · `))).toBeVisible({ timeout: 20_000 });
    expect(await pos.pointsOf(member)).toBe(before - POINTS);
    // Esc leaves Bayar; the voucher stays on the row for this basket.
    await screen.getByRole('button', 'Kembali ke transaksi').tap();
    await expect(pos.scanField(screen)).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-72b Poin: the shopper declines in the member app — "Pelanggan menolak penukaran poin.", the points stay, and the cashier can ask again', { tags: ['pos'] }, async (fx) => {
  const { screen } = fx;
  const member = pos.MEMBER.id;
  const unit = await pos.pickUnit('plain');
  try {
    const before = await pos.pointsOf(member);
    test.skip(before < 10, `${member} holds ${before} points, fewer than the 10 this test asks for`);
    const app = await pos.memberApp(member);
    await pos.openBayarForMember(fx, unit.epc, member);
    await pos.askPoints(fx, 10);
    const ask = await waitFor('the ask in the member app', () => app.waiting(), 20_000, 1_000);
    await app.decline(ask.request_id);
    await expect(screen.getByText('Pelanggan menolak penukaran poin.', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await pos.pointsOf(member)).toBe(before);
    // A new ask goes out from the same row.
    await screen.getByRole('button', /^Minta persetujuan/).tap();
    const again = await waitFor('the second ask in the member app', () => app.waiting(), 20_000, 1_000);
    expect(again.request_id).not.toBe(ask.request_id);
    // Closing Bayar takes the waiting ask back: the shopper has nothing left to approve.
    await screen.getByRole('button', 'Kembali ke transaksi').tap();
    await waitFor('the ask taken back', async () => ((await app.waiting()) === undefined ? true : null), 20_000, 1_000);
  } finally {
    pos.release(unit.epc);
  }
});

// Not testable from here: the six digits head office sends to the shopper's WhatsApp are never returned to the till or to
// any API, so "the cashier types what the shopper reads back" (lookup → confirm) needs a WhatsApp stub that hands the
// test the code (`WHATSAPP_GATEWAY` pointed at a fake that records messages).
test.skip('TILL-72c Poin: the shopper reads the WhatsApp code back and the cashier types it into the row — needs a WhatsApp stub that records the message', { tags: ['pos'] }, async () => {});

// BUG: the BENEFIT tender's reference is the spend's sale_ref, a random UUID (till.tsx saleRef = randomUUID()).
// The node refuses any payment reference with 12 or more digits ("a payment reference must not look like a card
// number"), and a UUID has ~20 digits, so the sale is refused and the employee's balance has already been spent
// at head office. Seen: "invalid request: a payment reference must not look like a card number".
test('TILL-73 Saldo karyawan: HR fills the balance, the employee shows a 6-digit code, the till spends part of the bill from it', { tags: ['pos', 'bug'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  const rina = as('cloud', 'rina');
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    // Arrange (head office): the benefit is on, maya (not the cashier: a cashier may not ring up their own benefit) has Rp 100.000 in it and shows her code.
    const today = new Date().toISOString().slice(0, 10);
    const settings = await rina.get('/api/v1/benefit/settings');
    if (!settings.some((s: any) => s.enabled)) {
      await rina.post('/api/v1/benefit/settings', { effective_from: today, enabled: true, code_minutes: 30, reason: 'e2e: till benefit test' });
    }
    const me = await as('cloud', 'maya').get('/api/v1/employees/me');
    const before = (await rina.get('/api/v1/benefit/balances')).find((b: any) => b.employee_id === me.employee_id).balance_minor as number;
    await rina.post('/api/v1/benefit/adjustments', { action: 'ADD', amount_minor: 100_000, employee_ids: [me.employee_id], reason: 'e2e: till benefit test' });
    const code = (await as('cloud', 'maya').post('/api/v1/employees/me/benefit-code', {})).code as string;
    expect(code).toMatch(/^\d{6}$/);

    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const due = pos.dueOf(await pos.quote([unit.epc]));
    await pos.payTotal(t, due);
    await pos.goToPayment(t);
    await screen.getByRole('button', 'Saldo karyawan').tap();
    await screen.getByLabel('Kode saldo karyawan').fill('000000');
    await screen.getByRole('button', 'Cek saldo').tap();
    await expect(screen.getByText('Maya Anggraini', { exact: true })).toBeHidden();
    await screen.getByLabel('Kode saldo karyawan').fill(code);
    await screen.getByRole('button', 'Cek saldo').tap();
    await expect(screen.getByText('Maya Anggraini', { exact: true })).toBeVisible({ timeout: 20_000 });
    await screen.getByLabel('Nominal pembayaran').fill('30000');
    await screen.getByRole('button', /^Pakai saldo/).tap();
    await expect(screen.getByText('Diterima', { exact: true })).toBeVisible({ timeout: 20_000 });
    await screen.getByRole('button', 'Tunai').tap();
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    const r = await pos.receipt(saleId);
    const benefit = (r.tenders as any[]).find((x) => x.method === 'BENEFIT');
    expect(benefit?.amount_minor).toBe(30_000);
    const after = (await rina.get('/api/v1/benefit/balances')).find((b: any) => b.employee_id === me.employee_id).balance_minor as number;
    expect(after).toBe(before + 100_000 - 30_000);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});
