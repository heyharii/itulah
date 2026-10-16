import { seed, locations, locationNames, value, total, status, statuses, transfer, changedAt } from './model.mjs';
const $ = selector => document.querySelector(selector);
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = n => n === null ? '<span class="unknown">—</span>' : n.toLocaleString('id-ID');
const requestedOption = new URLSearchParams(location.search).get('option');
let products = seed(), option = ['a', 'b', 'c'].includes(requestedOption) ? requestedOption : 'a', mode = 'observed', search = '', attention = false, systemTime = '14:35', minute = 35;
let move = { step: 1, from: 'warehouse', to: 'floor', quantities: {} }, toastTimer;
const options = {
  a: { title: 'Ringkas, dengan konteks yang selalu terlihat', description: 'Toggle di kiri, waktu dan cakupan di kanan. Ikon status menjaga tabel tetap tenang. Klik produk atau ikon untuk melihat perbandingan. Paling cocok untuk daftar stok sehari-hari.' },
  b: { title: 'Waktu dan cakupan langsung di tiap lokasi', description: 'Konteks pengecekan ditempatkan di kepala kolom Gudang dan Floor. Cocok jika kedua lokasi sering diperiksa pada waktu berbeda. Angka tetap satu per sel.' },
  c: { title: 'Status ditulis, lebih mudah dibaca staf baru', description: 'Arti tampilan diterangkan dengan kalimat pendek, status menggunakan ikon dan teks. Cocok untuk tim yang belum terbiasa dengan simbol. Tabel sedikit lebih lebar.' },
};
function symbol(item, withText = false) {
  const s = statuses[status(item)];
  return `<span class="status-symbol ${s.tone === 'blue' ? 'blue-tone' : s.tone === 'muted' ? 'muted-tone' : s.tone}" aria-hidden="true">${s.icon}</span>${withText ? `<span>${s.short}</span>` : ''}`;
}
function renderControls() {
  $('.inventory').className = `inventory view-${option}`;
  const toggle = `<div class="segmented" role="group" aria-label="Cara melihat stok"><button data-mode="observed" aria-pressed="${mode === 'observed'}">Terlihat</button><button data-mode="system" aria-pressed="${mode === 'system'}">Sistem</button></div>`;
  const coverage = `<button class="text-button" data-coverage>Lihat cakupan</button>`;
  const context = mode === 'observed' ? `<div class="context"><div class="context-line"><i class="time-dot"></i><strong>Pengecekan hari ini · 14:23</strong></div><p>Gudang 5/6 varian · Floor 4/6 varian <span>·</span> ${coverage}</p></div>` : `<div class="context"><strong>Catatan stok saat ini · ${systemTime}</strong><p>Termasuk perpindahan setelah pengecekan</p></div>`;
  if (option === 'a') $('#view-controls').innerHTML = `<div class="view-controls">${toggle}${context}</div>`;
  if (option === 'b') $('#view-controls').innerHTML = `<div class="view-controls"><div class="view-description"><span class="eyebrow">${mode === 'observed' ? 'HASIL PENGECEKAN TERAKHIR' : 'CATATAN STOK SAAT INI'}</span><h2>${mode === 'observed' ? 'Apa yang terlihat saat dicek' : 'Apa yang tercatat di sistem'}</h2><p>${mode === 'observed' ? 'Waktu dan cakupan mengikuti masing-masing lokasi.' : `Diperbarui pukul ${systemTime} · jumlah mengikuti transaksi terbaru.`}</p></div>${toggle}</div>`;
  if (option === 'c') $('#view-controls').innerHTML = `<div class="view-controls">${toggle}${context}</div><div class="meaning-banner"><div><h2>${mode === 'observed' ? 'Terlihat = jumlah yang tercatat saat pengecekan terakhir' : 'Sistem = stok tercatat setelah transaksi terbaru'}</h2><p>${mode === 'observed' ? 'Angka lama tetap disimpan jika ada perpindahan. Lihat status untuk konteksnya.' : 'Untuk pindah barang, jumlah dibatasi stok asal yang tercatat di Sistem.'}</p></div></div>`;
  $('#option-kicker').textContent = `OPSI ${option.toUpperCase()}${option === 'a' ? ' · REKOMENDASI' : ''}`;
  $('#option-title').textContent = options[option].title;
  $('#option-description').textContent = options[option].description;
  document.querySelectorAll('[data-option]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.option === option)));
  const columnContext = location => option === 'b' ? `<small>${mode === 'observed' ? `Terakhir 14:23<br>${location === 'warehouse' ? '5/6' : '4/6'} varian` : `Sistem · ${systemTime}`}</small>` : '';
  $('#table-head').innerHTML = `<tr><th scope="col">Produk</th><th scope="col">Gudang${columnContext('warehouse')}</th><th scope="col">Floor${columnContext('floor')}</th><th scope="col">Total</th><th scope="col">Status</th></tr>`;
}
function renderRows() {
  const shown = products.filter(product => `${product.name} ${product.variant} ${product.sku}`.toLowerCase().includes(search.toLowerCase()) && (!attention || status(product) !== 'match'));
  $('#rows').innerHTML = shown.map(product => `<tr data-product="${product.id}" tabindex="0" aria-label="Buka detail ${product.name}, ${product.variant}"><td><div class="product"><span class="product-thumb ${product.tint}" aria-hidden="true"><i class="garment"></i></span><div><div class="product-name">${product.name}</div><div class="product-variant">${product.variant}</div></div></div></td>${locations.map(location => `<td>${mode === 'observed' && product.observed[location] && !product.observed[location].complete ? `<span class="quantity-partial" title="${escape(product.observed[location].scope)} · ${product.observed[location].time}" aria-label="${value(product, location, mode)} terlihat, ${escape(product.observed[location].scope)}">${number(value(product, location, mode))}</span>` : number(value(product, location, mode))}</td>`).join('')}<td>${number(total(product, mode))}</td><td><button class="status-button" data-detail="${product.id}" aria-label="${product.name}: ${statuses[status(product)].label}. Lihat perbandingan" title="${statuses[status(product)].label}">${symbol(product, option === 'c')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Tidak ada produk yang cocok.</td></tr>';
  $('#table-foot').innerHTML = `<span>${shown.length} varian ditampilkan</span><strong>${mode === 'observed' ? 'Terlihat · sebagian area belum diperiksa' : `Sistem · diperbarui ${systemTime}`}${option === 'b' && mode === 'observed' ? ` · <button class="text-button" data-coverage>Detail cakupan</button>` : ''}</strong>`;
}
function render() { renderControls(); renderRows(); }
function showDetail(id) {
  const product = products.find(product => product.id === id), s = statuses[status(product)];
  const explanation = { difference: 'Ada perbedaan dengan Sistem pada saat pengecekan. Periksa cakupan dan hitung ulang sebelum melakukan koreksi stok.', changed: 'Catatan Sistem berubah setelah pengecekan. Angka Terlihat belum diperbarui dan tidak bisa dianggap sebagai stok sekarang.', match: 'Jumlah yang terlihat cocok dengan Sistem pada saat pengecekan. Ini tetap hasil pengecekan terakhir.', unchecked: 'Produk ini belum diperiksa di kedua lokasi. Tanda — bukan berarti stok kosong.', partial: 'Pengecekan baru mencakup sebagian lokasi atau area. Jumlah yang terlihat belum mewakili seluruh stok.' }[status(product)];
  $('#detail-content').innerHTML = `<div class="sheet-head"><div><span class="eyebrow">PERBANDINGAN STOK</span><h2 id="detail-title">${product.name}</h2><p>${product.variant} · ${product.sku}</p></div><button class="icon-button" data-close="detail-dialog" aria-label="Tutup detail">×</button></div><div class="sheet-body"><div class="detail-status">${symbol(product)}<span>${s.label}</span></div><div class="info-box ${status(product) === 'difference' ? 'warning-box' : ''}">${explanation}</div><table class="comparison-table" aria-label="Perbandingan per lokasi"><thead><tr><th>Lokasi</th><th>Terlihat<br>saat dicek</th><th>Sistem<br>saat dicek</th><th>Sistem<br>sekarang ${systemTime}</th></tr></thead><tbody>${locations.map(location => `<tr><td>${locationNames[location]}</td><td>${number(product.observed[location]?.count ?? null)}</td><td>${number(product.observed[location]?.system ?? null)}</td><td>${number(product.system[location])}</td></tr>`).join('')}</tbody></table>${locations.map(location => {
    const observation = product.observed[location];
    if (!observation) return `<div class="location-detail"><h3>${locationNames[location]}</h3><p>Belum dicek · belum ada waktu atau cakupan pengecekan.</p></div>`;
    const delta = observation.count - observation.system;
    return `<div class="location-detail"><h3>${locationNames[location]}</h3><p>Hari ini, ${observation.time} · ${observation.scope}<br>Hasil hitung manual · Dita</p><p class="${changedAt(product, location) ? 'moved' : delta && observation.complete ? 'delta' : ''}">${!observation.complete ? 'Area belum lengkap; selisih seluruh lokasi belum bisa disimpulkan.' : delta ? `Selisih saat dicek: ${delta > 0 ? '+' : ''}${delta} pcs terhadap Sistem saat itu.` : 'Sesuai dengan Sistem saat dicek.'}${changedAt(product, location) ? '<br>Ada pergerakan stok setelah pengecekan. Periksa ulang untuk angka Terlihat terbaru.' : ''}</p></div>`;
  }).join('')}<p class="muted" style="margin-top:20px">Perbandingan memakai Sistem pada waktu pengecekan agar perpindahan setelahnya tidak disalahartikan sebagai selisih.</p></div><div class="sheet-footer"><button class="secondary" data-close="detail-dialog">Kembali</button><button class="primary" data-transfer-product="${product.id}">Pindahkan barang ini</button></div>`;
  $('#detail-dialog').showModal();
}
function renderMove() {
  const selected = products.filter(product => (move.quantities[product.id] ?? 0) > 0), quantity = selected.reduce((sum, product) => sum + move.quantities[product.id], 0);
  const steps = `<div class="steps">${['Pilih arah', 'Barang & jumlah', 'Konfirmasi'].map((label, index) => index + 1 === move.step ? `<b>${index + 1}. ${label}</b>` : `<span>${index + 1}. ${label}</span>`).join('')}</div>`;
  let content = '', footer = '';
  if (move.step === 1) {
    content = `<p class="lead">Ke mana barang dipindahkan?</p><p class="muted">Pilih arah, lalu isi barang dan jumlahnya.</p><button class="route-card" data-route="warehouse"><b>Gudang</b><span>→</span><b>Floor</b></button><button class="route-card" data-route="floor"><b>Floor</b><span>→</span><b>Gudang</b></button>`;
    footer = '<button class="secondary" data-close="transfer-dialog">Batal</button>';
  } else if (move.step === 2) {
    const shown = move.productId ? products.filter(product => product.id === move.productId) : products;
    content = `<p class="lead">${locationNames[move.from]} → ${locationNames[move.to]}</p><p class="muted">Masukkan jumlah yang akan dipindahkan. Batas jumlah mengikuti stok Sistem di lokasi asal.</p>${shown.map(product => `<label class="transfer-line"><div><p class="product-name">${product.name}</p><p class="product-variant">${product.variant}</p><p class="availability">Sistem di ${locationNames[move.from]}: ${product.system[move.from]} pcs</p></div><input type="number" inputmode="numeric" min="0" max="${product.system[move.from]}" step="1" value="${move.quantities[product.id] ?? 0}" data-quantity="${product.id}" aria-label="Jumlah ${product.name}, ${product.variant}" ${product.system[move.from] === 0 ? 'disabled' : ''}></label>`).join('')}<p id="move-error" class="form-error" role="alert"></p>`;
    footer = '<button class="secondary" id="move-back">Kembali</button><button class="primary" id="move-review">Periksa pindahan</button>';
  } else {
    content = `<p class="lead">${quantity} pcs · ${locationNames[move.from]} → ${locationNames[move.to]}</p><p class="muted">Periksa barang dan jumlah sebelum mencatat pindahan.</p>${selected.map(product => `<div class="review-line"><div><p>${product.name}</p><span>${product.variant}</span><br><span>${locationNames[move.from]}: ${product.system[move.from]} → ${product.system[move.from] - move.quantities[product.id]} · ${locationNames[move.to]}: ${product.system[move.to]} → ${product.system[move.to] + move.quantities[product.id]}</span></div><b>${move.quantities[product.id]}</b></div>`).join('')}<div class="info-box">Stok Sistem akan diperbarui. Angka Terlihat tetap hasil pengecekan sebelumnya sampai diperiksa lagi.</div><label class="confirmation-line"><input id="arrival" type="checkbox"> Barang sudah dipindahkan dan jumlahnya sesuai.</label><p id="move-error" class="form-error" role="alert"></p>`;
    footer = '<button class="secondary" id="move-back">Kembali</button><button class="primary" id="move-save" disabled>Catat pindahan</button>';
  }
  $('#transfer-content').innerHTML = `<div class="sheet-head"><div><span class="eyebrow">PERPINDAHAN BARANG</span><h2 id="transfer-title">Pindahkan Stok</h2>${steps}</div><button class="icon-button" data-close="transfer-dialog" aria-label="Tutup pindahan">×</button></div><div class="sheet-body">${content}</div><div class="sheet-footer">${footer}</div>`;
}
function startMove(productId) { move = { step: 1, from: 'warehouse', to: 'floor', quantities: {}, productId }; renderMove(); $('#transfer-dialog').showModal(); }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500); }
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) { $(`#${close.dataset.close}`).close(); return; }
  const design = event.target.closest('[data-option]');
  if (design) { option = design.dataset.option; history.replaceState(null, '', `?option=${option}`); render(); return; }
  const view = event.target.closest('[data-mode]');
  if (view) { mode = view.dataset.mode; render(); return; }
  if (event.target.closest('[data-coverage]')) { $('#coverage-dialog').showModal(); return; }
  const productMove = event.target.closest('[data-transfer-product]');
  if (productMove) { $('#detail-dialog').close(); startMove(productMove.dataset.transferProduct); return; }
  const detail = event.target.closest('[data-detail]') || event.target.closest('[data-product]');
  if (detail) { showDetail(detail.dataset.detail || detail.dataset.product); return; }
  const route = event.target.closest('[data-route]');
  if (route) { if (move.from !== route.dataset.route) move.quantities = {}; move.from = route.dataset.route; move.to = move.from === 'warehouse' ? 'floor' : 'warehouse'; move.step = 2; renderMove(); return; }
  if (event.target.closest('#move-back')) { move.step--; renderMove(); return; }
  if (event.target.closest('#move-review')) {
    try {
      const quantities = {};
      document.querySelectorAll('[data-quantity]').forEach(input => {
        if (input.value === '') return;
        const quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < 0 || !input.validity.valid) throw new Error('Isi jumlah bulat, minimal 0 dan tidak melebihi stok Sistem di lokasi asal.');
        if (quantity) quantities[input.dataset.quantity] = quantity;
      });
      transfer(structuredClone(products), quantities, move.from, move.to);
      move.quantities = quantities; move.step = 3; renderMove();
    } catch (error) { $('#move-error').textContent = error.message; }
    return;
  }
  if (event.target.closest('#move-save')) {
    if (!$('#arrival').checked) return;
    try {
      const quantity = transfer(products, move.quantities, move.from, move.to);
      minute++; systemTime = `${14 + Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`; $('#transfer-dialog').close(); render(); toast(`${quantity} pcs dicatat berpindah. Sistem diperbarui; Terlihat tetap hasil pengecekan terakhir.`);
    } catch (error) { $('#move-error').textContent = error.message; }
  }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('tr[data-product]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); showDetail(event.target.dataset.product); }
});
document.addEventListener('input', event => {
  if (event.target.matches('[data-quantity]')) { move.quantities[event.target.dataset.quantity] = Number(event.target.value); $('#move-error').textContent = ''; }
});
document.addEventListener('change', event => { if (event.target.id === 'arrival') $('#move-save').disabled = !event.target.checked; });
$('#search').addEventListener('input', event => { search = event.target.value; renderRows(); });
$('#attention').addEventListener('change', event => { attention = event.target.checked; renderRows(); });
$('#open-transfer').addEventListener('click', () => startMove());
$('#reset').addEventListener('click', () => { products = seed(); systemTime = '14:35'; minute = 35; mode = 'observed'; search = ''; attention = false; $('#search').value = ''; $('#attention').checked = false; $('#toast').hidden = true; render(); });
render();
