import { places, products, createState, balances, setRoute, scan, remove, grouped, commit } from './model.mjs';
const $ = selector => document.querySelector(selector);
const key = 'central-stockroom-floor-prototype-v1';
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let state = createState();
let storageAvailable = true;
try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.version === 1 && Array.isArray(saved.units) && saved.units.length === 35 && Array.isArray(saved.queue) && Array.isArray(saved.history)) state = saved; } catch { storageAvailable = false; }
let tab = 'move';
let lastScan = null;
let expanded = new Set();
function save() { try { localStorage.setItem(key, JSON.stringify(state)); } catch { storageAvailable = false; $('#offline-help').hidden = false; $('#offline-help').textContent = 'Penyimpanan browser tidak tersedia. Biarkan halaman terbuka agar draft tidak hilang.'; } }
function notice(message, tone = '') { $('#notice').hidden = false; $('#notice').className = `notice ${tone}`; $('#notice').setAttribute('role',tone === 'error'?'alert':'status'); $('#notice').textContent = message; }
function focusScan() { if (tab === 'move' && !$('#review-dialog').open && !$('#clear-dialog').open) $('#scan-input').focus({preventScroll:true}); }
function thumb(p) { return `<div class="thumb" aria-hidden="true"><div class="garment ${p.kind} ${p.tone}"></div></div>`; }
function render() {
  const b = balances(state); const q = state.queue.length; const groups = grouped(state.queue);
  $('#from').value = state.from; $('#to').value = state.to;
  $('#from').disabled = !!q; $('#to').disabled = !!q;
  $('#route-lock').textContent = q ? 'Arah terkunci' : 'Satu arah per sesi';
  $('#from-balance').textContent = `${b[state.from]} potong saat ini`;
  $('#to-balance').textContent = `${b[state.to]} potong saat ini`;
  $('#summary-from').textContent = places[state.from]; $('#summary-to').textContent = places[state.to];
  $('#total').textContent = q; $('#queue-count').textContent = q; $('#sku-count').textContent = groups.length;
  $('#store-total').textContent = state.units.length;
  $('#clear-draft').disabled = !q;
  $('#review').disabled = !q;
  $('#review-mobile').disabled = !q;
  $('#mobile-count').textContent = `${q} potong`;
  $('#mobile-route').textContent = `${places[state.from]} → ${places[state.to]}`;
  $('#review').textContent = q ? `Tinjau ${q} barang${state.queue.some(row => row.status === 'failed') ? ' tersisa' : ''} →` : 'Tinjau perpindahan';
  $('#balance-preview').innerHTML = q ? `<div><span>${places[state.from]}</span><span>${b[state.from]} → <b>${b[state.from]-q}</b></span></div><div><span>${places[state.to]}</span><span>${b[state.to]} → <b>${b[state.to]+q}</b></span></div><span class="small">Perkiraan jika semua tag berhasil.</span>` : '<p class="hint">Perubahan saldo akan terlihat setelah tag ditambahkan.</p>';
  $('#note').value = state.note;
  if(state.note) $('#note-details').open = true;
  $('#offline').checked = !state.online; $('#partial').checked = state.failNext;
  $('#server-status').innerHTML = `<span class="dot${state.online ? '' : ' offline'}"></span>${state.online ? 'Server toko · demo' : 'Offline · demo'}`;
  $('#offline-help').hidden = state.online && storageAvailable;
  if (!storageAvailable) $('#offline-help').textContent = 'Penyimpanan browser tidak tersedia. Draft hanya bertahan selama halaman ini terbuka.';
  else $('#offline-help').textContent = 'Server toko tidak tersambung. Draft tetap tersimpan di perangkat ini.';
  if (lastScan) $('#last-scan').innerHTML = `<span class="scan-mark" aria-hidden="true">${lastScan.ok ? '✓' : '!'}</span><div><b>${lastScan.ok ? 'Tag ditambahkan' : 'Tag tidak ditambahkan'}</b><span>${escape(lastScan.message)}</span></div>`;
  else $('#last-scan').innerHTML = '<span class="scan-mark" aria-hidden="true">▥</span><div><b>Mulai dengan tag pertama</b><span>Arah dan jumlah selalu terlihat selama scan.</span></div>';
  $('#last-scan').className = `last-scan${lastScan ? lastScan.ok ? ' ok' : ' error' : ''}`;
  $('#queue').innerHTML = groups.length ? groups.map(p => `<article class="queue-row">${thumb(p)}<div class="product-info"><b>${p.name}</b><span class="variant">${p.colour} · ${p.size}</span><code>${p.sku}</code>${p.rows.some(row => row.status === 'failed') ? `<p class="tag-error">${p.rows.filter(row => row.status === 'failed').length} tag belum pindah. Buka detail untuk cek atau keluarkan.</p>` : ''}<details class="tag-details" data-sku="${p.sku}"${expanded.has(p.sku)?' open':''}><summary>Lihat ${p.rows.length} tag unik</summary>${p.rows.map(row => `<div class="tag-item"><div><code>${row.epc}</code>${row.error ? `<p class="tag-error">${escape(row.error)}</p>` : ''}</div><button class="remove-tag" data-remove="${row.epc}" aria-label="Keluarkan tag ${row.epc}">×</button></div>`).join('')}</details></div><div class="row-qty">${p.rows.length}<small>potong</small></div></article>`).join('') : '<div class="empty"><span aria-hidden="true">▱</span><b>Belum ada barang dalam sesi</b><p>Scan pakaian yang akan dipindahkan. Detail SKU dan ukuran muncul di sini.</p></div>';
  $('#pool-summary').innerHTML = Object.entries(places).map(([place,label]) => `<article class="pool-card"><h2>${label}</h2><div class="pool-number">${b[place]} <span class="small">potong</span></div><button class="button secondary" data-route="${place}"${q?' disabled':''}>Pindah dari sini →</button></article>`).join('');
  $('#stock-table').innerHTML = products.map(p => {const count=balances(state,p.sku);return `<tr><td><div class="stock-product">${thumb(p)}<div><b>${p.name}</b><span>${p.colour} · ${p.size}</span><span>${p.sku}</span></div></div></td><td class="number">${count.warehouse}</td><td class="number">${count.floor}</td><td class="number">${count.reject}</td><td class="number">${count.warehouse+count.floor+count.reject}</td></tr>`;}).join('');
  $('#history').innerHTML = state.history.length ? state.history.map(event => `<article class="panel history-event"><div class="event-head"><div><b>${event.id} · ${places[event.from]} → ${places[event.to]}</b><p>${new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(event.at))} WIB · ${event.actor}</p></div><span class="event-status">✓ ${event.rows.length} berhasil</span></div>${grouped(event.rows).map(p => `<div class="history-product"><span>${p.name}<br><small>${p.colour} · ${p.size}</small></span><b>${p.rows.length} potong</b></div>`).join('')}${event.note ? `<p class="history-note">${escape(event.note)}</p>` : ''}<details class="history-tags"><summary>Lihat bukti per tag</summary><ul>${event.rows.map(row => `<li><code>${row.epc}</code> · berhasil</li>`).join('')}</ul></details></article>`).join('') : '<section class="panel empty"><span aria-hidden="true">↔</span><b>Belum ada perpindahan</b><p>Sesi yang berhasil dikonfirmasi akan muncul di sini, lengkap dengan tag dan operator.</p><button class="button secondary" data-tab="move">Mulai pindahkan</button></section>';
}
function switchTab(next) {
  tab = next;
  const titles = {move:['Pindahkan barang','Satu sesi untuk satu arah. Scan semua pakaian, lalu konfirmasi saat barang sudah sampai.'], stock:['Stok per lokasi','Lihat jumlah per SKU, warna, dan ukuran pada tiga lokasi toko.'],history:['Riwayat perpindahan','Hanya barang yang berhasil dipindahkan tercatat di sini. Draft dan tag gagal tetap terpisah.'], research:['Riset & keputusan UX','Pola dari empat ERP, disesuaikan untuk pekerjaan stockroom → shop floor.']};
  $('#page-title').textContent=titles[next][0]; $('#page-caption').textContent=titles[next][1];
  for (const view of document.querySelectorAll('.view')) view.hidden=view.id!==`view-${next}`;
  $('#mobile-actionbar').hidden = next !== 'move';
  for (const button of document.querySelectorAll('[data-tab]')) {button.classList.toggle('active',button.dataset.tab===next);if(button.closest('nav')) button.setAttribute('aria-current',button.dataset.tab===next?'page':'false');}
  $('#notice').hidden=true;
  render();
}
function scanCode(raw) { lastScan=scan(state,raw); save(); render(); notice(lastScan.message,lastScan.ok?'success':'error'); $('#scan-input').value=''; focusScan(); }
$('#scan-form').addEventListener('submit',event=>{event.preventDefault();scanCode($('#scan-input').value);});
for(const id of ['from','to']) $(`#${id}`).addEventListener('change',()=>{const result=setRoute(state,$('#from').value,$('#to').value);if(!result.ok)notice(result.message,'error');save();render();});
$('#note').addEventListener('input',()=>{state.note=$('#note').value;save();});
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button)return;
  if(button.dataset.tab) switchTab(button.dataset.tab);
  if(button.dataset.remove){remove(state,button.dataset.remove);lastScan=null;save();render();notice('Tag dikeluarkan dari draft. Saldo belum berubah.');focusScan();}
  if(button.dataset.route){const from=button.dataset.route;const result=setRoute(state,from,from==='floor'?'warehouse':'floor');if(result.ok){save();switchTab('move');focusScan();}else notice(result.message,'error');}
});
$('#queue').addEventListener('toggle',event=>{if(event.target.matches('details')) {if(event.target.open)expanded.add(event.target.dataset.sku);else expanded.delete(event.target.dataset.sku);}},true);
$('#demo-five').addEventListener('click',()=>{
  const eligible=state.units.filter(unit=>unit.place===state.from && !state.queue.some(row=>row.epc===unit.epc));
  const selected=[];
  // Interleave variants so the example demonstrates grouping by SKU.
  for(let round=0;selected.length<5 && round<10;round++) for(const p of products){const unit=eligible.filter(unit=>unit.sku===p.sku)[round];if(unit&&selected.length<5)selected.push(unit);}
  if(!selected.length){notice('Tidak ada tag contoh tambahan di lokasi asal.','error');return;}
  for(const unit of selected)lastScan=scan(state,unit.epc);
  save();render();notice(`${selected.length} tag contoh ditambahkan. Saldo masih sama sampai konfirmasi.`,'success');focusScan();
});
$('#demo-duplicate').addEventListener('click',()=>{if(!state.queue.length){notice('Tambahkan tag pertama, lalu coba scan ganda.','error');return;}scanCode(state.queue[0].epc);});
$('#demo-wrong').addEventListener('click',()=>{const unit=state.units.find(unit=>unit.place!==state.from);if(unit)scanCode(unit.epc);else notice('Tidak ada tag di lokasi lain pada data contoh.','error');});
$('#demo-sku').addEventListener('click',()=>scanCode(products[0].sku));
$('#offline').addEventListener('change',()=>{state.online=!$('#offline').checked;save();render();notice(state.online?'Server toko kembali tersambung. Tinjau draft dan coba ulang.':'Server toko offline. Scan boleh dilanjutkan sebagai draft; saldo tidak berubah.',state.online?'':'error');});
$('#partial').addEventListener('change',()=>{state.failNext=$('#partial').checked;save();render();notice(state.failNext?'Simulasi aktif: satu tag akan ditolak saat konfirmasi.':'Simulasi kegagalan dinonaktifkan.');});
function review() {
  const b=balances(state); const q=state.queue.length;
  $('#review-body').innerHTML=`<div class="review-route"><span>${places[state.from]}</span><span>→</span><span>${places[state.to]}</span></div><p class="review-total"><b>${q} potong</b> · ${grouped(state.queue).length} varian SKU · ${q} tag unik</p>${grouped(state.queue).map(p=>`<div class="review-item"><div>${p.name}<span>${p.colour} · ${p.size}</span></div><b>${p.rows.length} potong</b></div>`).join('')}<div class="review-balances">${places[state.from]}: ${b[state.from]} → ${b[state.from]-q}<br>${places[state.to]}: ${b[state.to]} → ${b[state.to]+q}<br>Total toko tetap ${state.units.length} potong · perkiraan jika semua berhasil.</div>${!state.online?'<p class="review-warning">Server toko tidak tersambung. Draft tersimpan; konfirmasi belum tersedia.</p>':''}`;
  $('#arrived').checked=false;$('#arrived').disabled=!state.online;$('#confirm').disabled=true;
  $('#confirm').textContent=`Pindahkan ${q} barang`;
  $('#review-dialog').showModal();
}
$('#review').addEventListener('click',review);
$('#review-mobile').addEventListener('click',review);
$('#arrived').addEventListener('change',()=>{$('#confirm').disabled=!$('#arrived').checked||!state.online;});
function closeReview(){$('#review-dialog').close();focusScan();}
$('#close-review').addEventListener('click',closeReview);$('#back-scan').addEventListener('click',closeReview);
$('#confirm').addEventListener('click',()=>{
  if(!$('#arrived').checked||!state.online)return;
  $('#confirm').disabled=true;
  const result=commit(state);lastScan=null;expanded.clear();
  save();$('#review-dialog').close();render();notice(result.message,result.ok?'success':'error');focusScan();
});
$('#clear-draft').addEventListener('click',()=>$('#clear-dialog').showModal());
$('#cancel-clear').addEventListener('click',()=>{$('#clear-dialog').close();focusScan();});
$('#confirm-clear').addEventListener('click',()=>{state.queue=[];state.note='';lastScan=null;expanded.clear();save();$('#clear-dialog').close();render();notice('Draft dihapus. Saldo stok tidak berubah.');focusScan();});
$('#reset').addEventListener('click',()=>{state=createState();lastScan=null;expanded.clear();save();render();$('#last-scan').innerHTML='<span class="scan-mark" aria-hidden="true">▥</span><div><b>Mulai dengan tag pertama</b><span>Arah dan jumlah selalu terlihat selama scan.</span></div>';notice('Data contoh dikembalikan ke awal.');});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>focusScan());
switchTab('move');
if(state.queue.length)notice(`Draft ${state.queue.length} tag dipulihkan. Saldo belum berubah untuk tag yang tersisa.`);
