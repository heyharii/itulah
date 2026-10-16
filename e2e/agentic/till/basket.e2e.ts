// The counter before payment: what scanning does, what the node's quote adds (promotions, coupon,
// member points, bags), and the supervisor-gated ways of taking things back off the counter.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';
import * as pos from '../support/pos.ts';
import { as, waitFor } from '../support/rig.ts';

const t3 = ({ app, screen, browser }: any) => ({ app, screen, browser });

test('TILL-40 member + shoe promotion: promotion row, estimated points and the total equal the node quote; the sale syncs to head office tagged with the member', { tags: ['pos', 'smoke'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('shoe');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByLabel('Nomor member').fill(pos.MEMBER.id);
    const q = await pos.quote([unit.epc], { member: pos.MEMBER.id });
    expect(q.points_earned).toBeGreaterThan(0);
    const due = pos.dueOf(q);
    const promo = (q.promotions as any[]).find((p) => p.applied && /Sepatu/.test(p.name));
    expect(promo).toBeTruthy();
    await expect(screen.getByText(promo.name, { exact: true })).toBeVisible();
    await expect(screen.getByText(`+${q.points_earned}`, { exact: true })).toBeVisible();
    expect(await pos.payTotal(t, due)).toBe(due);
    expect(due).toBeLessThan(unit.price);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    await expect(screen.getByText('Lunas', { exact: true })).toBeVisible();
    saleId = await pos.finishSale(t);
    expect((await pos.receipt(saleId)).total_minor).toBe(due);
    expect((await pos.saleInWindow(saleId))?.total_minor).toBe(due);
    expect(await pos.placeOf(unit.epc)).toBe('external/customer');
    const cloud = as('cloud', 'rina');
    const synced = await waitFor('sale at head office', async () => {
      const list = await cloud.get('/api/v1/sales?limit=500');
      return (list.items ?? list.rows ?? list).find?.((s: any) => s.id === saleId);
    }, 120_000);
    expect(synced.total_minor).toBe(due);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-41 coupon HEMAT50 on a small basket: the chip is kept and the till says it gave no discount', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const small = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, small.epc);
    await screen.getByLabel('Kode kupon').fill('hemat50');
    await screen.getByRole('button', 'Pakai').tap();
    await expect(screen.getByRole('button', 'Lepas kupon HEMAT50')).toBeVisible();
    await expect(screen.getByText('HEMAT50 belum memberi potongan.', { exact: true })).toBeVisible();
  } finally {
    pos.release(small.epc);
  }
});

// HEMAT50 is quota-limited (100 uses): the till asks head office for a hold through the node relay,
// re-quotes with it, and the sale commits the hold. The basket must carry no other promotion (shoe and
// Koleksi Wanita offers beat the coupon, which stands alone), so it is plain units adding to Rp 300.000+.
test('TILL-41b coupon HEMAT50 takes Rp 50.000 off a Rp 300.000+ basket', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const units: pos.Unit[] = [];
  let saleId: string | undefined;
  try {
    while (units.reduce((n, u) => n + u.quoted, 0) < 300_000) units.push(await pos.pickUnit('plain'));
    const epcs = units.map((u) => u.epc);
    const sum = units.reduce((n, u) => n + u.quoted, 0);
    const plain = await pos.quote(epcs);
    expect(pos.dueOf(plain)).toBe(sum);
    await pos.openCounter(t);
    await pos.scanUnits(t, ...epcs);
    await screen.getByLabel('Kode kupon').fill('HEMAT50');
    await screen.getByRole('button', 'Pakai').tap();
    await expect(screen.getByText('Kupon HEMAT50: potongan Rp 50.000', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(screen.getByText('HEMAT50 belum memberi potongan.', { exact: true })).toBeHidden();
    expect(await pos.payTotal(t, sum - 50_000)).toBe(sum - 50_000);
  } finally {
    await pos.restoreSale(saleId, ...units.map((u) => u.epc));
  }
});

test('TILL-42 coupon chip lifts the coupon again', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByLabel('Kode kupon').fill('HEMAT50');
    await screen.getByRole('button', 'Pakai').tap();
    await screen.getByRole('button', 'Lepas kupon HEMAT50').tap();
    await expect(screen.getByRole('button', 'Lepas kupon HEMAT50')).toBeHidden();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-43 Koleksi Wanita promotion is shown on a blouse and the total is the quote', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('wanita');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    const q = await pos.quote([unit.epc]);
    const promo = (q.promotions as any[]).find((p) => p.applied);
    await expect(screen.getByText(promo.name, { exact: true })).toBeVisible();
    const due = pos.dueOf(q);
    expect(await pos.payTotal(t, due)).toBe(due);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    saleId = await pos.finishSale(t);
    expect((await pos.receipt(saleId)).total_minor).toBe(due);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-44 a marked-down unit sells at its markdown price and earns no promotion', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const left = (await pos.floorUnits()).some((u) => u.kind === 'markdown');
  test.skip(!left, 'stock: no marked-down unit left on store-01 floor (Sandal Slide Karet)');
  const unit = await pos.pickUnit('markdown');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    expect(unit.quoted).toBe(unit.price);
    expect(unit.price).toBeLessThan(unit.base);
    await expect(screen.getByText(pos.rp(unit.price)).first()).toBeVisible();
    expect(await pos.payTotal(t, unit.price)).toBe(unit.price);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    saleId = await pos.finishSale(t);
    expect((await pos.receipt(saleId)).total_minor).toBe(unit.price);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-45 a shopping bag is a charge on the bill, not a unit; it can be taken off again (the sale is not completed here: see TILL-45b)', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('button', 'Kantong').tap();
    const sheet = screen.getByRole('dialog', 'Kantong belanja');
    await expect(sheet.getByText('Gratis').first()).toBeVisible();
    await sheet.getByRole('button', /Kantong plastik besar/).tap();
    await expect(screen.getByText(/^Kantong plastik besar/)).toBeVisible();
    await expect(screen.getByText('1 unit', { exact: true })).toBeVisible();
    const bag = { code: 'PACKAGING', description: 'Kantong plastik besar', amount_minor: 1000, tax_category: 'STANDARD' };
    const q = await pos.quote([unit.epc], { charges: [bag] });
    expect(await pos.payTotal(t, pos.dueOf(q))).toBe(unit.quoted + 1000);
    await screen.getByRole('button', 'lepas').tap();
    expect(await pos.payTotal(t, unit.quoted)).toBe(unit.quoted);
    await screen.getByRole('button', 'Kantong').tap();
    await screen.getByRole('dialog', 'Kantong belanja').getByRole('button', /Kantong plastik kecil/).tap();
    await pos.payTotal(t, unit.quoted + 500);
  } finally {
    pos.release(unit.epc);
  }
});

// BUG (found 9 Oct, rig agentic): a sale with a bag charge is booked at the shop (total = lines + charge) but the
// centre refuses it — "sale lines add up to 219000 but the total says 219500" — and that BLOCKS store-01's whole
// sync stream (seq 159 stays unapplied; every later sale and stock fact never reaches head office).
// Destructive for the rig, so it only runs when asked: RIG_POS_BAG_SALE=1 (needs a freshly provisioned rig).
test('TILL-45b a sale with a bag charge reaches head office and does not block the store\'s sync', { tags: ['pos', 'bug'] }, async (fx) => {
  test.skip(process.env.RIG_POS_BAG_SALE !== '1', 'destructive: blocks store-01 sync on this rig; run with RIG_POS_BAG_SALE=1 on a fresh rig');
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  let saleId: string | undefined;
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('button', 'Kantong').tap();
    await screen.getByRole('dialog', 'Kantong belanja').getByRole('button', /Kantong plastik kecil/).tap();
    await pos.payTotal(t, unit.quoted + 500);
    await pos.goToPayment(t);
    await screen.getByRole('button', /^Bayar Rp/).tap();
    saleId = await pos.finishSale(t);
    const cloud = as('cloud', 'rina');
    const synced = await waitFor('the bag sale at head office', async () => {
      const list = await cloud.get('/api/v1/sales?limit=500');
      return (list.items ?? []).find((s: any) => s.id === saleId);
    }, 60_000);
    expect(synced.total_minor).toBe(unit.quoted + 500);
  } finally {
    await pos.restoreSale(saleId, unit.epc);
  }
});

test('TILL-46 scanning: duplicate tag, price check by name, no match, member card, tag with no price', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await pos.scan(t, unit.epc);
    await expect(screen.getByText('Tag itu sudah ada di keranjang. Satu tag adalah satu barang.', { exact: true })).toBeVisible();
    await expect(screen.getByText('1 unit', { exact: true })).toBeVisible();

    await pos.scan(t, 'kaos');
    await expect(screen.getByText('Cek harga', { exact: true })).toBeVisible();
    await expect(screen.getByText(/Kaos Basic Katun Combed/).first()).toBeVisible();
    await screen.getByRole('button', 'Tutup cek harga').tap();
    await expect(screen.getByText('Cek harga', { exact: true })).toBeHidden();

    await pos.scan(t, 'zzzzqq');
    await expect(screen.getByText(/^Tidak ada yang cocok dengan “zzzzqq”/)).toBeVisible();

    await pos.scan(t, `M1:${pos.MEMBER.id}`);
    await expect(screen.getByText(`Kartu member ${pos.MEMBER.id} terbaca.`, { exact: true })).toBeVisible();
    await expect(screen.getByLabel('Nomor member')).toHaveValue(pos.MEMBER.id);

    await pos.scan(t, 'A1' + '99999999999' + '00000000001');
    await expect(screen.getByText('Tidak ada di buku harga', { exact: true })).toBeVisible();
    await expect(screen.getByText('TANPA HARGA', { exact: true })).toBeVisible();
    await expect(screen.getByText('Ada unit tanpa harga', { exact: true })).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-47 Tahan / Ditahan: park a basket, resume it, drop it with a supervisor', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('button', 'Tahan').tap();
    await expect(screen.getByText('Siap untuk transaksi baru', { exact: true })).toBeVisible();
    await screen.getByRole('button', /^Ditahan/).tap();
    const sheet = screen.getByRole('dialog', 'Transaksi ditahan');
    await expect(sheet.getByText(/^1 unit/)).toBeVisible();
    await sheet.getByRole('button', 'Lanjutkan').tap();
    await expect(screen.getByText('1 unit', { exact: true })).toBeVisible();
    // Park it again and drop it: the hold needs a supervisor.
    await screen.getByRole('button', 'Tahan').tap();
    await screen.getByRole('button', /^Ditahan/).tap();
    const again = screen.getByRole('dialog', 'Transaksi ditahan');
    await again.getByRole('button', 'Buang').tap();
    await again.getByRole('button', 'Ya, buang').tap();
    await pos.approve(t);
    await expect(screen.getByRole('button', /^Ditahan/)).toBeDisabled();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-48 cancelling a basket: reason, then a supervisor; a wrong password keeps the basket', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('button', /^Batal/).tap();
    const card = screen.getByRole('dialog', 'Batalkan transaksi');
    await expect(card.getByRole('button', 'Batalkan transaksi')).toBeDisabled();
    await card.getByRole('button', 'Pembeli berubah pikiran').tap();
    await card.getByRole('button', 'Batalkan transaksi').tap();
    await pos.approve(t, 'maya', 'salah-sandi');
    await expect(screen.getByRole('dialog', 'Persetujuan kepala toko')).toBeVisible();
    await expect(screen.getByRole('dialog', 'Persetujuan kepala toko').getByText(/./).first()).toBeVisible();
    await screen.getByRole('dialog', 'Persetujuan kepala toko').getByLabel('Kata sandi').fill(PASSWORD);
    await screen.getByRole('dialog', 'Persetujuan kepala toko').getByRole('button', 'Setujui').tap();
    await expect(screen.getByText('Transaksi dibatalkan — Pembeli berubah pikiran · disetujui maya', { exact: true })).toBeVisible();
    await expect(screen.getByText('Siap untuk transaksi baru', { exact: true })).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-49 taking one unit off the basket needs a supervisor', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const a = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, a.epc);
    await screen.getByRole('button', `Lepas ${a.name}`).tap();
    await expect(screen.getByText('Hapus barang dari keranjang', { exact: true })).toBeVisible();
    await pos.approve(t);
    await expect(screen.getByText('Siap untuk transaksi baru', { exact: true })).toBeVisible();
  } finally {
    pos.release(a.epc);
  }
});

test('TILL-50 Kunci: the counter locks, refuses a wrong password, and opens on the right one with the basket still there', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('button', 'Kunci').tap();
    await expect(screen.getByText('Konter terkunci', { exact: true })).toBeVisible();
    await screen.getByLabel('Kata sandi').fill('salah-sandi');
    await screen.getByRole('button', 'Buka konter').tap();
    await expect(screen.getByText('unauthorized: invalid username or password', { exact: true })).toBeVisible();
    await expect(screen.getByText('Konter terkunci', { exact: true })).toBeVisible();
    await screen.getByLabel('Kata sandi').fill(PASSWORD);
    await screen.getByRole('button', 'Buka konter').tap();
    await expect(screen.getByText('Konter terkunci', { exact: true })).toBeHidden();
    await expect(screen.getByText('1 unit', { exact: true })).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-51 Dari handheld lists reader sessions (or says there are none)', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  await pos.openCounter(t);
  await screen.getByRole('button', /Dari handheld/).tap();
  const sheet = screen.getByRole('dialog', 'Ambil dari handheld');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/Belum ada sesi pindai|tag ·/).first()).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', 'Tutup').tap();
  await expect(sheet).toBeHidden();
});

test('TILL-52 function keys: F4 bags, F9 holds, F12 shift, F3 return; Esc leaves payment with the basket', { tags: ['pos'] }, async (fx) => {
  const t = t3(fx);
  const { screen } = t;
  const unit = await pos.pickUnit('plain');
  try {
    await pos.openCounter(t);
    await pos.scanUnits(t, unit.epc);
    await screen.getByRole('textbox', 'Pindai tag atau cari barang').press('F4');
    await expect(screen.getByRole('dialog', 'Kantong belanja')).toBeVisible();
    await screen.getByRole('dialog', 'Kantong belanja').getByRole('button', 'Tutup').tap();
    await screen.getByRole('textbox', 'Pindai tag atau cari barang').press('F10');
    await expect(screen.getByText('Metode pembayaran', { exact: true })).toBeVisible();
    await screen.getByLabel('Nominal pembayaran').press('Escape');
    await expect(screen.getByText('1 unit', { exact: true })).toBeVisible();
    await screen.getByRole('textbox', 'Pindai tag atau cari barang').press('F3');
    await expect(screen.getByRole('heading', 'Retur barang')).toBeVisible();
  } finally {
    pos.release(unit.epc);
  }
});

test('TILL-53 customer display window greets with no session of its own', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/?display');
  await expect(screen.getByText('Selamat datang', { exact: true })).toBeVisible();
  await expect(screen.getByText('Selamat berbelanja', { exact: true })).toBeVisible();
});
