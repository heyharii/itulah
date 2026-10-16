export const products = [
  { id: 'tee', sku: 'CT-001-SG-M', name: 'Essential cotton tee', detail: 'Sage · M', price: 129000, kind: 'Atasan', color: '#9caca0', shape: 'tee', tag: 'E200001722110001' },
  { id: 'shirt', sku: 'CL-024-OT-L', name: 'Linen blend shirt', detail: 'Oat · L', price: 249000, kind: 'Atasan', color: '#cbbda4', shape: 'shirt', tag: 'E200001722110002' },
  { id: 'pants', sku: 'CP-016-SD-30', name: 'Relaxed chino', detail: 'Sand · 30', price: 299000, kind: 'Bawahan', color: '#b3a389', shape: 'pants', tag: 'E200001722110003' },
  { id: 'tee2', sku: 'CT-001-BK-L', name: 'Essential cotton tee', detail: 'Ink · L', price: 129000, kind: 'Atasan', color: '#424b50', shape: 'tee', tag: 'E200001722110004' },
  { id: 'dress', sku: 'CD-012-CL-M', name: 'Everyday midi dress', detail: 'Clay · M', price: 359000, kind: 'Dress', color: '#b8826e', shape: 'dress', tag: 'E200001722110005' },
  { id: 'bag', sku: 'CA-008-NT-OS', name: 'Canvas everyday tote', detail: 'Natural · All size', price: 89000, kind: 'Aksesori', color: '#bdae92', shape: 'bag', tag: 'E200001722110006' },
];
export const concepts = [
  { name: 'Sekarang', label: 'POS saat ini', title: 'Struktur POS yang sekarang.', desc: 'Panel kerja kiri, keranjang kanan, pembayaran di halaman tersendiri.', for: 'Pembanding dari kode POS web', tone: 'current' },
  { name: 'Focus', label: '01 · Focus', title: 'Satu fokus: selesaikan transaksi.', desc: 'Scan dan keranjang satu area. Ringkasan tetap terlihat; alat tambahan muncul saat dibutuhkan.', for: 'Kasir harian · rekomendasi awal', tone: 'focus' },
  { name: 'Touch', label: '02 · Touch', title: 'Lebih visual. Lebih mudah disentuh.', desc: 'Katalog visual untuk cek harga, target sentuh besar, keranjang ringkas di sisi kanan.', for: 'Tablet & kasir dengan layar sentuh', tone: 'touch' },
  { name: 'Guided', label: '03 · Guided', title: 'Tiga langkah, tanpa menebak.', desc: 'Barang → pelanggan → bayar. Satu keputusan utama di setiap langkah.', for: 'Kasir baru & proses yang terarah', tone: 'guided' },
  { name: 'Express', label: '04 · Express', title: 'Cepat dibaca. Cepat dikerjakan.', desc: 'Tabel lebar, input selalu dekat, pintasan keyboard, dan total di bilah bawah.', for: 'Antrean ramai & pengguna keyboard', tone: 'express' },
  { name: 'Service', label: '05 · Service', title: 'Pelayanan yang lebih personal.', desc: 'Pelanggan di kiri, belanja di tengah, pembayaran langsung di kanan.', for: 'Fashion retail & layanan member', tone: 'service' },
];
export function makeState(seed = true) {
  return { items: seed ? products.slice(0, 3).map(p => ({ ...p })) : [], member: null, coupon: false, bag: false, held: [], payments: [], receipts: [], step: 1, stage: 'sale', method: 'Tunai', amount: '', reference: '', bank: 'BCA', category: 'Semua', search: '', selected: null, last: '', error: '' };
}
export function totals(s) {
  const subtotal = s.items.reduce((sum, p) => sum + p.price, 0);
  const discount = s.coupon && subtotal >= 300000 ? 50000 : 0;
  const total = subtotal - discount + (s.bag ? 3000 : 0);
  const paid = s.payments.reduce((sum, p) => sum + p.amount, 0);
  return { subtotal, discount, total, paid, due: Math.max(0, total - paid), change: Math.max(0, paid - total) };
}
export function addTag(s, tag) {
  const p = products.find(p => p.tag === tag.toUpperCase());
  if (!p) return 'Tag tidak ditemukan. Gunakan salah satu tag contoh.';
  if (s.items.some(i => i.tag === p.tag)) return 'Tag sudah ada di keranjang. Tidak ditambahkan dua kali.';
  s.items.push({ ...p }); s.last = p.id;
  return null;
}
export function takePayment(s) {
  if (!s.items.length) return 'Keranjang masih kosong.';
  const { due } = totals(s);
  if (due === 0) return 'Pembayaran sudah lengkap.';
  const amount = Number(s.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Masukkan nominal pembayaran yang valid.';
  if (s.method !== 'Tunai' && amount > due) return 'Pembayaran non-tunai tidak boleh melebihi sisa tagihan.';
  if (s.method !== 'Tunai' && !s.reference.trim()) return 'Isi nomor referensi pembayaran terlebih dahulu.';
  s.payments.push({ method: s.method, amount, reference: s.reference.trim(), bank: s.method === 'Debit' ? s.bank : null });
  s.amount = ''; s.reference = '';
  return null;
}
