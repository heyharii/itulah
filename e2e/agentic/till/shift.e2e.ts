// Seats and shifts: Pilih kasir, opening a drawer with a float, taking a held seat over, losing it
// mid-sale, cash in/out of the drawer, and the blind count that closes a shift.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import * as pos from '../support/pos.ts';
import { as, uid } from '../support/rig.ts';

const mayaShift = (float = 100_000) =>
  as('store', 'maya').post('/api/v1/store/shifts/take-over', { terminal_id: pos.TERMINAL, opening_float_minor: float, actor_id: 'maya', idempotency_key: uid() });

/** maya lets go of whatever she holds, and dian counts anything left to count. */
async function cleanSeats() {
  const maya = as('store', 'maya');
  const mine = await maya.get('/api/v1/store/shifts/mine');
  if (mine.open) await maya.post(`/api/v1/store/shifts/${mine.open.shift_id}/close`, { declared_cash_minor: 0, counted: [], note: 'e2e', actor_id: 'maya', idempotency_key: uid() });
  for (const owed of mine.uncounted ?? []) await maya.post(`/api/v1/store/shifts/${owed.shift_id}/count`, { declared_cash_minor: 0, counted: [], note: 'e2e', actor_id: 'maya', idempotency_key: uid() });
  await pos.countUncounted();
}

test('TILL-10 a free seat: Pilih kasir → Pakai Kasir 1 → the float → Buka shift opens the drawer', { tags: ['pos', 'smoke'] }, async (fx) => {
  const { app, screen, browser } = fx;
  await cleanSeats();
  await pos.closeMyShift();
  await pos.signInTill({ app, screen, browser });
  await expect(screen.getByRole('heading', 'Pilih kasir')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('Kosong', { exact: true })).toBeVisible();
  await screen.getByRole('button', 'Pakai Kasir 1').tap();
  await expect(screen.getByText('Hitung uang di laci Anda, lalu isi modal awalnya.', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', /^Buka shift · Rp\s0$/)).toBeVisible();
  await screen.getByLabel('Modal awal di laci').fill('500000');
  await screen.getByRole('button', /^Buka shift · Rp\s500\.000$/).tap();
  await expect(pos.scanField(screen)).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('Kasir 1', { exact: true })).toBeVisible();
  const mine = await pos.myShifts();
  expect(mine.open.terminal_id).toBe(pos.TERMINAL);
  expect(mine.open.opening_float_minor).toBe(500_000);
  expect(mine.open.status).toBe('OPEN');
});

test('TILL-11 a held seat can be taken over: the warning, then the float; the other shift ends', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  await cleanSeats();
  await pos.closeMyShift();
  const theirs = (await mayaShift()).shift;
  try {
    await pos.signInTill({ app, screen, browser });
    await expect(screen.getByRole('heading', 'Pilih kasir')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^Dipegang maya sejak \d\d:\d\d$/)).toBeVisible();
    await screen.getByRole('button', 'Ambil alih').tap();
    await expect(screen.getByText(/akan berakhir\./)).toBeVisible();
    await screen.getByRole('button', 'Ambil alih Kasir 1').tap();
    await screen.getByLabel('Modal awal di laci').fill('250000');
    await screen.getByRole('button', /^Buka shift/).tap();
    await expect(pos.scanField(screen)).toBeVisible({ timeout: 30_000 });
    expect((await pos.myShifts()).open.opening_float_minor).toBe(250_000);
    const maya = await as('store', 'maya').get('/api/v1/store/shifts/mine');
    expect(maya.open).toBeNull();
    expect(maya.uncounted.some((s: any) => s.shift_id === theirs.shift_id)).toBe(true);
  } finally {
    await cleanSeats();
  }
});

test('TILL-12 whoever lost a seat must count their drawer before anything else (Hitung laci)', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  await cleanSeats();
  await pos.ensureShift();
  await mayaShift(); // takes dian's seat over
  try {
    await pos.signInTill({ app, screen, browser });
    await expect(screen.getByRole('heading', 'Hitung laci Kasir 1')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/diambil alih oleh maya/)).toBeVisible();
    await screen.getByLabel('Jumlah lembar Rp 100.000').fill('2');
    await screen.getByRole('button', 'Lanjut').tap();
    await expect(screen.getByText('Periksa hitungan', { exact: true })).toBeVisible();
    await screen.getByRole('button', 'Kunci hitungan').tap();
    await expect(screen.getByRole('heading', 'Pilih kasir')).toBeVisible({ timeout: 20_000 });
    expect((await pos.myShifts()).uncounted).toHaveLength(0);
  } finally {
    await cleanSeats();
  }
});

test('TILL-13 the seat is taken over while a sale is being paid: the sale is not booked and the cashier is sent back to Pilih kasir', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.payTotal(t);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    await mayaShift();
    await screen.getByRole('button', 'Selesaikan transaksi').tap();
    await expect(screen.getByText('Kasir 1 sudah diambil alih oleh maya — pilih kasir lagi.', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await pos.placeOf(unit.epc)).toBe(pos.FLOOR);
  } finally {
    await cleanSeats();
    pos.release(unit.epc);
  }
});

test('TILL-14 cash out of and into the drawer: validation, then the movement is listed', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  await pos.openCounter(t);
  await screen.getByRole('button', /Shift & kas/).tap();
  await expect(screen.getByRole('heading', 'Shift & kas')).toBeVisible();
  await expect(screen.getByText('Modal awal', { exact: true }).first()).toBeVisible();
  await screen.getByRole('button', /^Catat/).tap();
  await expect(screen.getByText('Isi nominalnya.', { exact: true })).toBeVisible();
  await screen.getByLabel('Nominal').fill('20000');
  await screen.getByRole('button', /^Catat/).tap();
  await expect(screen.getByText('Alasan wajib diisi.', { exact: true })).toBeVisible();
  await screen.getByLabel('Alasan').fill('setor sore e2e');
  await screen.getByRole('button', /^Catat · Rp\s20\.000$/).tap();
  await expect(screen.getByText('Pergerakan kas', { exact: true })).toBeVisible();
  await expect(screen.getByText(/^setor sore e2e/)).toBeVisible();
  await expect(screen.getByText(/^−Rp\s20\.000$/)).toBeVisible();
  await screen.getByRole('radio', 'Tambah uang laci').tap();
  await screen.getByLabel('Nominal').fill('5000');
  await screen.getByLabel('Alasan').fill('tambah receh e2e');
  await screen.getByRole('button', /^Catat/).tap();
  await expect(screen.getByText(/^tambah receh e2e/)).toBeVisible();
  const open = (await pos.myShifts()).open;
  const report = await as('store', 'maya').get(`/api/v1/store/shifts/${open.shift_id}`);
  expect((report.movements as any[]).map((m) => m.amount_minor)).toEqual(expect.arrayContaining([-20_000, 5_000]));
});

test('TILL-15 closing the shift: a blind count by notes, a check screen, then Shift ditutup', { tags: ['pos'] }, async (fx) => {
  const { app, screen, browser } = fx;
  const t = { app, screen, browser };
  await pos.openCounter(t);
  const open = (await pos.myShifts()).open;
  await screen.getByRole('button', /Shift & kas/).tap();
  await screen.getByRole('button', 'Tutup shift').tap();
  await expect(screen.getByText('Tutup shift · hitung uang di laci', { exact: true })).toBeVisible();
  await screen.getByLabel('Jumlah lembar Rp 100.000').fill('4');
  await screen.getByLabel('Tambah Rp 50.000').tap();
  await expect(screen.getByText('Total dihitung', { exact: true })).toBeVisible();
  await screen.getByRole('button', 'Lanjut').tap();
  await expect(screen.getByText('Periksa hitungan', { exact: true })).toBeVisible();
  await expect(screen.getByText('Rp 450.000').first()).toBeVisible();
  await screen.getByRole('button', 'Hitung ulang').tap();
  await screen.getByRole('button', 'Lanjut').tap();
  await screen.getByLabel('Catatan (opsional)').fill('e2e tutup');
  await screen.getByRole('button', 'Kunci hitungan & tutup shift').tap();
  await expect(screen.getByText('Shift ditutup', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText('Uang yang Anda hitung', { exact: true })).toBeVisible();
  const report = await as('store', 'maya').get(`/api/v1/store/shifts/${open.shift_id}`);
  expect(report.status).not.toBe('OPEN');
  expect(report.declared_cash_minor).toBe(450_000);
  await screen.getByRole('button', 'Pilih kasir').tap();
  await expect(screen.getByRole('heading', 'Pilih kasir')).toBeVisible();
  await pos.ensureShift();
});
