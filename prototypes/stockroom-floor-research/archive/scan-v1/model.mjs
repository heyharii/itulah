export const places = { warehouse: 'Stockroom', floor: 'Shop floor', reject: 'Return stock' };
export const products = [
  { sku: '24010001102', name: 'Oxford stripe shirt', colour: 'Blue stripe', size: 'M', kind: 'shirt', tone: 'blue', back: 8, floor: 2, reject: 0 },
  { sku: '24010001103', name: 'Oxford stripe shirt', colour: 'Blue stripe', size: 'L', kind: 'shirt', tone: 'blue', back: 5, floor: 1, reject: 0 },
  { sku: '24010002103', name: 'Essential cotton tee', colour: 'Off white', size: 'L', kind: 'tee', tone: 'cream', back: 6, floor: 2, reject: 0 },
  { sku: '24010003202', name: 'Everyday chino', colour: 'Sand', size: 'M', kind: 'pants', tone: 'sand', back: 4, floor: 3, reject: 0 },
  { sku: '24010004302', name: 'Linen camp shirt', colour: 'Olive', size: 'M', kind: 'shirt', tone: 'olive', back: 2, floor: 0, reject: 2 },
];
export function createState() {
  const units = [];
  for (const p of products) {
    let serial = 1;
    for (const [place, count] of [['warehouse', p.back], ['floor', p.floor], ['reject', p.reject]]) {
      for (let i = 0; i < count; i++) units.push({ epc: `A1${p.sku}${(serial++).toString(16).padStart(11, '0').toUpperCase()}`, sku: p.sku, place });
    }
  }
  return { version: 1, units, from: 'warehouse', to: 'floor', queue: [], history: [], online: true, failNext: false, sequence: 0, note: '', session: 1 };
}
export function balances(state, sku) {
  const result = { warehouse: 0, floor: 0, reject: 0 };
  for (const unit of state.units) if (!sku || unit.sku === sku) result[unit.place]++;
  return result;
}
export function setRoute(state, from, to) {
  if (state.queue.length) return { ok: false, message: 'Selesaikan atau hapus draft sebelum mengganti arah.' };
  if (!places[from] || !places[to] || from === to) return { ok: false, message: 'Lokasi asal dan tujuan harus berbeda.' };
  state.from = from; state.to = to;
  return { ok: true };
}
export function scan(state, raw) {
  const epc = raw.trim().replace(/\s/g, '').toUpperCase();
  if (/^(R1:)?\d{11}$/.test(epc) || /^8\d{11}$/.test(epc)) return { ok: false, message: 'Ini barcode SKU. Scan tag unik pakaian agar setiap potong dihitung tepat satu kali.' };
  if (!/^A1[0-9A-F]{22}$/.test(epc)) return { ok: false, message: 'Kode tidak dikenali. Gunakan EPC tag pakaian 24 karakter.' };
  if (state.queue.some(row => row.epc === epc)) return { ok: false, message: 'Tag sudah ada di sesi ini. Jumlah tetap; barang tidak dihitung dua kali.' };
  const unit = state.units.find(row => row.epc === epc);
  if (!unit) return { ok: false, message: 'Tag belum terdaftar di toko ini. Pisahkan barang dan cek identitasnya.' };
  if (unit.place !== state.from) return { ok: false, message: `Barang tercatat di ${places[unit.place]}, bukan ${places[state.from]}. Arah sesi tetap; pisahkan barang ini.` };
  state.sequence++;
  state.queue.push({ epc, sku: unit.sku, status: 'ready', error: '', key: `demo-${state.session}-${state.sequence}` });
  return { ok: true, message: `${products.find(p => p.sku === unit.sku).name} ditambahkan. ${state.queue.length} tag unik siap ditinjau.` };
}
export function remove(state, epc) { state.queue = state.queue.filter(row => row.epc !== epc); }
export function grouped(queue) {
  return products.map(p => ({ ...p, rows: queue.filter(row => row.sku === p.sku) })).filter(p => p.rows.length);
}
export function commit(state, at = new Date().toISOString()) {
  if (!state.online) return { ok: false, success: 0, failed: state.queue.length, message: 'Server toko tidak tersambung. Draft tersimpan; saldo belum berubah.' };
  if (!state.queue.length) return { ok: false, success: 0, failed: 0, message: 'Scan minimal satu tag sebelum memindahkan.' };
  if (state.from === state.to) return { ok: false, success: 0, failed: state.queue.length, message: 'Lokasi asal dan tujuan harus berbeda.' };
  const movement = { id: `MV-${String(state.history.length + 1).padStart(4, '0')}`, at, from: state.from, to: state.to, rows: [], note: state.note, actor: 'Maya · contoh' };
  const remaining = [];
  let forcedFailure = state.failNext;
  for (const row of state.queue) {
    if (state.history.some(event => event.rows.some(p => p.key === row.key))) continue;
    const unit = state.units.find(p => p.epc === row.epc);
    let error = !unit ? 'Tag tidak ditemukan.' : unit.place !== state.from ? `Lokasi berubah ke ${places[unit.place]}. Cek barang sebelum mencoba lagi.` : '';
    if (!error && forcedFailure) { error = 'Server menolak tag ini (simulasi). Coba ulang tag yang gagal.'; forcedFailure = false; }
    if (error) remaining.push({ ...row, status: 'failed', error });
    else { unit.place = state.to; movement.rows.push({ ...row, status: 'done', error: '' }); }
  }
  state.failNext = false;
  if (movement.rows.length) state.history.unshift(movement);
  state.queue = remaining;
  if (!remaining.length) { state.note = ''; state.session++; }
  return { ok: remaining.length === 0, success: movement.rows.length, failed: remaining.length, message: remaining.length ? `${movement.rows.length} barang berhasil dipindahkan; ${remaining.length} belum pindah. Hanya tag gagal yang tersisa di draft.` : `${movement.rows.length} barang berhasil dipindahkan ke ${places[state.to]}.` };
}
