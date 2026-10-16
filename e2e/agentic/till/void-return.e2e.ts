// Undoing a sale: Void (the whole sale, one supervisor) and Retur (tags that came back, a disposition,
// a refund method, one supervisor). Sales are rung through the node's API; the screens under test are the
// till's. Stock is checked at the node's ledger.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';
import * as pos from '../support/pos.ts';
import { as, uid } from '../support/rig.ts';

type Fx = { app: any; screen: any; browser: any };

async function openSale(t: Fx, saleId: string) {
  await t.screen.getByLabel('ID penjualan').fill(saleId);
  await t.screen.getByRole('button', 'Buka penjualan').tap();
  await expect(t.screen.getByText('Penjualan', { exact: true })).toBeVisible();
}
async function supervisor(t: Fx, who = 'maya', password = PASSWORD) {
  await t.screen.getByLabel('Nama pengguna supervisor').fill(who);
  await t.screen.getByLabel('Kata sandi supervisor').fill(password);
}
const returnByApi = (saleId: string, epcs: string[]) =>
  as('store', 'maya').call('POST', '/api/v1/store/returns', {
    sale_id: saleId,
    lines: epcs.map((epc) => ({ epc, disposition: 'RESALEABLE' })),
    refund_method: 'CASH',
    refund_reference: null,
    reason: 'e2e cleanup',
    supervisor: { username: 'maya', password: PASSWORD },
    actor_id: 'dian',
    idempotency_key: uid(),
  }, { ok: false });

test('TILL-60 Void: find the sale, give a reason, a supervisor password — the units go back to the floor and the sale is VOIDED', { tags: ['pos', 'smoke'] }, async (fx) => {
  const t = fx;
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
    await t.screen.getByRole('button', 'Void').tap();
    await expect(t.screen.getByRole('heading', 'Void penjualan')).toBeVisible();
    await expect(t.screen.getByText('Belum ada penjualan dibuka', { exact: true })).toBeVisible();
    await openSale(t, saleId);
    await expect(t.screen.getByText(unit.name, { exact: false }).first()).toBeVisible();
    await expect(t.screen.getByRole('button', /^Batalkan seluruh penjualan/)).toBeDisabled();
    await t.screen.getByLabel('Alasan pembatalan').fill('salah tekan e2e');
    await supervisor(t);
    await t.screen.getByRole('button', /^Batalkan seluruh penjualan/).tap();
    await expect(t.screen.getByText('Penjualan dibatalkan', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(t.screen.getByText('maya', { exact: true })).toBeVisible();
    await pos.waitOnFloor(unit.epc);
    const r = await pos.receipt(saleId);
    expect(String(r.stamp)).toMatch(/BATAL/);
    await t.screen.getByRole('button', 'Selesai').tap();
    await expect(pos.scanField(t.screen)).toBeVisible();
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-61 Void refusals: unknown id, a receipt number, no password, a wrong password, a cashier as "supervisor"', { tags: ['pos'] }, async (fx) => {
  const t = fx;
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    await t.screen.getByRole('button', 'Void').tap();
    await t.screen.getByLabel('ID penjualan').fill('00000000-0000-4000-8000-000000000000');
    await t.screen.getByRole('button', 'Buka penjualan').tap();
    await expect(t.screen.getByText(/not found|tidak/i).first()).toBeVisible();
    await openSale(t, saleId);
    await t.screen.getByLabel('Alasan pembatalan').fill('uji tolak');
    await t.screen.getByRole('button', /^Batalkan seluruh penjualan/).tap();
    await expect(t.screen.getByText(/^Belum ada otorisasi supervisor/)).toBeVisible();
    await supervisor(t, 'maya', 'salah-sandi');
    await t.screen.getByRole('button', /^Batalkan seluruh penjualan/).tap();
    await expect(t.screen.getByText(/invalid|unauthorized|ditolak|salah/i).first()).toBeVisible({ timeout: 15_000 });
    await supervisor(t, 'dian', PASSWORD);
    await t.screen.getByRole('button', /^Batalkan seluruh penjualan/).tap();
    await expect(t.screen.getByText(/supervisor|forbidden|may not|role/i).first()).toBeVisible({ timeout: 15_000 });
    // Nothing was voided.
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

// BUG: the lookup recognises a receipt number with /^[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]{1,8}$/ to say "Itu nomor struk,
// bukan ID penjualan", but real numbers are STORE-01-20261009-D3581A (the site code has a hyphen), so the hint
// never fires and the cashier gets the node's bare "not found".
test('TILL-61b a receipt number typed as the sale id is explained, not just "not found"', { tags: ['pos', 'bug'] }, async (fx) => {
  const t = fx;
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    const no = (await pos.receipt(saleId)).receipt_no;
    await t.screen.getByRole('button', 'Void').tap();
    await t.screen.getByLabel('ID penjualan').fill(no);
    await t.screen.getByRole('button', 'Buka penjualan').tap();
    await expect(t.screen.getByText(/^Itu nomor struk, bukan ID penjualan/)).toBeVisible();
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-62 Retur: one of two units comes back RESALEABLE, cash refund — it returns to the floor, the other stays sold', { tags: ['pos'] }, async (fx) => {
  const t = fx;
  const a = await pos.pickUnit('plain');
  const b = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([a.epc, b.epc])).sale_id;
    await t.screen.getByRole('button', 'Retur').tap();
    await expect(t.screen.getByRole('heading', 'Retur barang')).toBeVisible();
    await openSale(t, saleId);
    await t.screen.getByLabel('Pindai tag yang kembali').fill(a.epc);
    await t.screen.getByLabel('Pindai tag yang kembali').press('Enter');
    await expect(t.screen.getByText('Tujuan belum dipilih', { exact: true })).toBeVisible();
    await expect(t.screen.getByText('1 tag belum diberi tujuan.', { exact: true })).toBeVisible();
    await expect(t.screen.getByRole('button', 'Catat retur')).toBeDisabled();
    await t.screen.getByRole('button', 'Layak jual').tap();
    await t.screen.getByLabel('Alasan retur').fill('ukuran tidak pas e2e');
    await t.screen.getByRole('button', 'Tunai').tap();
    await supervisor(t);
    await t.screen.getByRole('button', 'Catat retur').tap();
    await expect(t.screen.getByText('Retur tercatat', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(t.screen.getByText('1 unit', { exact: true })).toBeVisible();
    await expect(t.screen.getByText('maya', { exact: true })).toBeVisible();
    await pos.waitOnFloor(a.epc);
    expect(await pos.placeOf(b.epc)).toBe('external/customer');
  } finally {
    if (saleId) await returnByApi(saleId, [b.epc]);
    pos.release(a.epc, b.epc);
  }
});

test('TILL-63 Retur DAMAGED: the unit does not go back to the floor (each run burns one shoe off the floor)', { tags: ['pos'] }, async (fx) => {
  const t = fx;
  const unit = await pos.pickUnit('shoe');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([unit.epc])).sale_id;
    await t.screen.getByRole('button', 'Retur').tap();
    await openSale(t, saleId);
    await t.screen.getByLabel('Pindai tag yang kembali').fill(unit.epc);
    await t.screen.getByLabel('Pindai tag yang kembali').press('Enter');
    await t.screen.getByRole('button', 'Rusak').tap();
    await t.screen.getByLabel('Alasan retur').fill('cacat jahitan e2e');
    await t.screen.getByRole('button', 'QRIS').tap();
    await t.screen.getByLabel('Referensi pengembalian (boleh kosong)').fill('QR-REFUND-1');
    await supervisor(t);
    await t.screen.getByRole('button', 'Catat retur').tap();
    await expect(t.screen.getByText('Retur tercatat', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(t.screen.getByText('QRIS', { exact: true })).toBeVisible();
    expect(await pos.placeOf(unit.epc)).not.toBe(pos.FLOOR);
    expect(await pos.placeOf(unit.epc)).not.toBe('external/customer');
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-64 Retur guards: duplicate tag, a product code instead of a tag, a tag not on the receipt, a card-like reference, a wrong password', { tags: ['pos'] }, async (fx) => {
  const t = fx;
  const sold = await pos.pickUnit('plain');
  const other = await pos.pickUnit('wanita');
  const dup = await pos.pickUnit('plain', { not: [sold.epc] });
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    saleId = (await pos.sellByApi([sold.epc])).sale_id;
    await t.screen.getByRole('button', 'Retur').tap();
    await openSale(t, saleId);
    const tagField = t.screen.getByLabel('Pindai tag yang kembali');
    await tagField.fill(sold.epc);
    await tagField.press('Enter');
    await tagField.fill(sold.epc);
    await tagField.press('Enter');
    await expect(t.screen.getByText('Tag itu sudah ada di daftar. Satu tag adalah satu barang.', { exact: true })).toBeVisible();
    await tagField.fill(sold.sku);
    await tagField.press('Enter');
    await expect(t.screen.getByText(/^Itu kode produk, bukan barang yang mana/)).toBeVisible();
    await tagField.fill('bukan-tag');
    await tagField.press('Enter');
    await expect(t.screen.getByText(/bukan tag yang dikenali terminal ini/)).toBeVisible();
    await tagField.fill(other.epc);
    await tagField.press('Enter');
    await expect(t.screen.getByText('SKU tidak ada di struk ini', { exact: true })).toBeVisible();
    await t.screen.getByRole('button', 'Lepas').last().tap();
    await tagField.fill(dup.epc);
    await tagField.press('Enter');
    await expect(t.screen.getByText(/^Tag untuk .* lebih banyak daripada yang terjual di struk ini/)).toBeVisible();
    await t.screen.getByRole('button', 'Lepas').last().tap();
    await t.screen.getByRole('button', 'Layak jual').tap();
    await t.screen.getByLabel('Alasan retur').fill('uji tolak');
    await t.screen.getByRole('button', 'Kartu').tap();
    await t.screen.getByLabel('Referensi pengembalian (boleh kosong)').fill('4111 1111 1111 1111');
    await supervisor(t);
    await t.screen.getByRole('button', 'Catat retur').tap();
    await expect(t.screen.getByText(/^Referensi itu menyerupai nomor kartu/)).toBeVisible();
    await t.screen.getByLabel('Referensi pengembalian (boleh kosong)').fill('BCA approval 8842');
    await supervisor(t, 'maya', 'salah-sandi');
    await t.screen.getByRole('button', 'Catat retur').tap();
    await expect(t.screen.getByText(/invalid|unauthorized|ditolak|salah/i).first()).toBeVisible({ timeout: 15_000 });
    expect(await pos.placeOf(sold.epc)).toBe('external/customer');
  } finally {
    await pos.restoreSale(saleId, sold.epc, other.epc, dup.epc);
  }
});
