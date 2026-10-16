import { places, products, createState, balances, totalStock, totalQuantity, setRoute, setQuantity, grouped, commit } from './model.mjs';
const $=selector=>document.querySelector(selector);
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const key='central-stockroom-floor-quantity-v2';
let state=createState();let storageAvailable=true;let tab='move';let search='';
const invalidInputs=new Map();
try {const saved=JSON.parse(localStorage.getItem(key));if(saved?.version===2&&Array.isArray(saved.stock)&&Array.isArray(saved.queue)&&Array.isArray(saved.history))state=saved;}catch{storageAvailable=false;}
function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{storageAvailable=false;}}
function notice(message,tone=''){$('#notice').hidden=false;$('#notice').className=`notice ${tone}`;$('#notice').setAttribute('role',tone==='error'?'alert':'status');$('#notice').textContent=message;}
function thumb(p){return `<div class="thumb" aria-hidden="true"><div class="garment ${p.kind} ${p.tone}"></div></div>`;}
function renderSummary(){
  const b=balances(state);const q=totalQuantity(state.queue);
  $('#from').value=state.from;$('#to').value=state.to;$('#from').disabled=!!state.queue.length;$('#to').disabled=!!state.queue.length;
  $('#route-lock').textContent=state.queue.length?'Arah terkunci':'Satu arah per sesi';
  $('#from-balance').textContent=`${b[state.from]} potong saat ini`;$('#to-balance').textContent=`${b[state.to]} potong saat ini`;
  $('#summary-from').textContent=places[state.from];$('#summary-to').textContent=places[state.to];
  $('#total').textContent=q;$('#queue-count').textContent=`${state.queue.length} varian`;$('#sku-count').textContent=state.queue.length;$('#store-total').textContent=totalStock(state);
  $('#clear-draft').disabled=!state.queue.length&&!invalidInputs.size;
  $('#review').disabled=!q||!!invalidInputs.size;$('#review-mobile').disabled=!q||!!invalidInputs.size;
  $('#mobile-count').textContent=`${q} potong`;$('#mobile-route').textContent=`${places[state.from]} → ${places[state.to]}`;
  $('#review').textContent=invalidInputs.size?'Perbaiki jumlah dulu':q?`Tinjau ${q} potong →`:'Tinjau perpindahan';
  $('#balance-preview').innerHTML=q?`<div><span>${places[state.from]}</span><span>${b[state.from]} → <b>${b[state.from]-q}</b></span></div><div><span>${places[state.to]}</span><span>${b[state.to]} → <b>${b[state.to]+q}</b></span></div><span class="small">Perkiraan jika semua varian berhasil.</span>`:'<p class="hint">Isi jumlah untuk melihat perubahan stok.</p>';
  $('#offline').checked=!state.online;$('#partial').checked=state.failNext;
  $('#server-status').innerHTML=`<span class="dot${state.online?'':' offline'}"></span>${state.online?'Server toko · demo':'Offline · demo'}`;
  $('#offline-help').hidden=state.online&&storageAvailable;
  $('#offline-help').textContent=storageAvailable?'Server toko tidak tersambung. Pilihan tetap tersimpan di perangkat ini.':'Penyimpanan browser tidak tersedia. Biarkan halaman terbuka agar pilihan tidak hilang.';
  $('#queue').innerHTML=state.queue.length?grouped(state.queue).map(p=>`<article class="queue-row">${thumb(p)}<div class="product-info"><b>${p.name}</b><span class="variant">${p.colour} · ${p.size}</span>${p.error?`<p class="tag-error">${escape(p.error)}</p>`:''}<button class="text-button remove-choice" data-remove="${p.sku}" aria-label="Keluarkan ${p.name} ${p.size}">Keluarkan</button></div><div class="row-qty">${p.quantity}<small>potong</small></div></article>`).join(''):'<div class="empty"><span aria-hidden="true">▱</span><b>Belum ada barang dipilih</b><p>Isi jumlah per ukuran di daftar artikel. Barang terpilih muncul di sini.</p></div>';
}
function renderCatalogue(){
  const groups=new Map();
  for(const p of products){
    if(search&&!`${p.name} ${p.colour} ${p.sku} ${p.size}`.toLowerCase().includes(search.toLowerCase()))continue;
    const groupKey=p.sku.slice(0,9);
    if(!groups.has(groupKey))groups.set(groupKey,[]);groups.get(groupKey).push(p);
  }
  $('#search-empty').hidden=!!groups.size;
  $('#catalogue').innerHTML=[...groups.values()].map(variants=>{
    const p=variants[0];return `<article class="article-choice"><div class="article-title">${thumb(p)}<div><h3>${p.name}</h3><span>${p.colour} · artikel ${p.sku.slice(0,8)}</span></div></div><div class="variant-head" aria-hidden="true"><span>Ukuran</span><span>${places[state.from]}</span><span>${places[state.to]}</span><span>Pindahkan</span></div>${variants.map(p=>{
      const stock=balances(state,p.sku);const quantity=state.queue.find(row=>row.sku===p.sku)?.quantity??0;const invalid=invalidInputs.get(p.sku);
      return `<div class="variant-choice${quantity?' chosen':''}" data-variant="${p.sku}"><b class="size-label">${p.size}</b><span class="source-stock" aria-label="${stock[state.from]} tersedia di ${places[state.from]}">${stock[state.from]}<small>tersedia</small></span><span class="destination-stock" aria-label="${stock[state.to]} di ${places[state.to]}">${stock[state.to]}</span><div class="quantity-control"><button type="button" data-delta="-1" data-sku="${p.sku}" aria-label="Kurangi ${p.name} ${p.size}"${!quantity?' disabled':''}>−</button><input type="number" inputmode="numeric" min="0" max="${stock[state.from]}" step="1" id="qty-${p.sku}" data-quantity="${p.sku}" value="${escape(invalid?invalid.value:quantity||'')}" placeholder="0" aria-label="Jumlah ${p.name} ${p.colour} ${p.size}" aria-describedby="error-${p.sku}"${invalid?' aria-invalid="true"':''}${!stock[state.from]?' disabled':''}><button type="button" data-delta="1" data-sku="${p.sku}" aria-label="Tambah ${p.name} ${p.size}"${quantity>=stock[state.from]?' disabled':''}>+</button></div><p class="quantity-error" id="error-${p.sku}" role="alert"${invalid?'':' hidden'}>${invalid?escape(invalid.message):''}</p></div>`;
    }).join('')}</article>`;
  }).join('');
}
function renderStockAndHistory(){
  const b=balances(state);
  $('#pool-summary').innerHTML=Object.entries(places).map(([place,label])=>`<article class="pool-card"><h2>${label}</h2><div class="pool-number">${b[place]} <span class="small">potong</span></div><button class="button secondary" data-route="${place}"${state.queue.length||invalidInputs.size?' disabled':''}>Pindah dari sini →</button></article>`).join('');
  $('#stock-table').innerHTML=products.map(p=>{const b=balances(state,p.sku);return `<tr><td><div class="stock-product">${thumb(p)}<div><b>${p.name}</b><span>${p.colour} · ${p.size}</span><span>${p.sku}</span></div></div></td><td class="number">${b.warehouse}</td><td class="number">${b.floor}</td><td class="number">${b.reject}</td><td class="number">${b.warehouse+b.floor+b.reject}</td><td></td></tr>`;}).join('');
  $('#history').innerHTML=state.history.length?state.history.map(event=>`<article class="panel history-event"><div class="event-head"><div><b>${event.id} · ${places[event.from]} → ${places[event.to]}</b><p>${new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(event.at))} WIB · ${event.actor}</p></div><span class="event-status">✓ ${totalQuantity(event.rows)} potong berhasil</span></div>${grouped(event.rows).map(p=>`<div class="history-product"><span>${p.name}<br><small>${p.colour} · ${p.size}</small></span><b>${p.quantity} potong</b></div>`).join('')}${event.note?`<p class="history-note">${escape(event.note)}</p>`:''}</article>`).join(''):'<section class="panel empty"><span aria-hidden="true">↔</span><b>Belum ada perpindahan</b><p>Perpindahan yang berhasil tercatat per artikel, ukuran, dan jumlah.</p><button class="button secondary" data-tab="move">Pilih barang</button></section>';
}
function render(){renderSummary();renderCatalogue();renderStockAndHistory();$('#note').value=state.note;if(state.note)$('#note-details').open=true;}
function switchTab(next){
  tab=next;const titles={move:['Pindahkan barang','Pilih artikel, isi jumlah per ukuran, lalu konfirmasi saat barang sudah sampai.'],stock:['Stok per lokasi','Lihat jumlah per SKU, warna, dan ukuran pada tiga lokasi toko.'],history:['Riwayat perpindahan','Jumlah yang berhasil dipindahkan tercatat bersama arah, waktu, dan operator.'],research:['Riset & keputusan UX','Pola pemindahan barang tanpa scan, disesuaikan untuk toko ini.']};
  $('#page-title').textContent=titles[next][0];$('#page-caption').textContent=titles[next][1];
  for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==`view-${next}`;
  $('#mobile-actionbar').hidden=next!=='move';
  for(const button of document.querySelectorAll('[data-tab]')){button.classList.toggle('active',button.dataset.tab===next);if(button.closest('nav'))button.setAttribute('aria-current',button.dataset.tab===next?'page':'false');}
  $('#notice').hidden=true;render();
}
function editQuantity(sku,raw){
  const result=setQuantity(state,sku,raw);
  if(result.ok)invalidInputs.delete(sku);else invalidInputs.set(sku,{value:raw,message:result.message});
  const field=$(`#qty-${sku}`);const error=$(`#error-${sku}`);const row=document.querySelector(`[data-variant="${sku}"]`);
  if(field){field.setAttribute('aria-invalid',result.ok?'false':'true');if(error){error.hidden=result.ok;error.textContent=result.ok?'':result.message;}if(row){const quantity=state.queue.find(line=>line.sku===sku)?.quantity??0;row.classList.toggle('chosen',!!quantity);row.querySelector('[data-delta="-1"]').disabled=!quantity;row.querySelector('[data-delta="1"]').disabled=quantity>=balances(state,sku)[state.from];}}
  save();renderSummary();return result;
}
$('#catalogue').addEventListener('input',event=>{if(event.target.dataset.quantity)editQuantity(event.target.dataset.quantity,event.target.value);});
$('#product-search').addEventListener('input',()=>{search=$('#product-search').value;renderCatalogue();});
for(const id of ['from','to'])$(`#${id}`).addEventListener('change',()=>{const result=setRoute(state,$('#from').value,$('#to').value);if(!result.ok)notice(result.message,'error');save();render();});
$('#note').addEventListener('input',()=>{state.note=$('#note').value;save();});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.tab)switchTab(button.dataset.tab);
  if(button.dataset.delta){const sku=button.dataset.sku;const quantity=Math.max(0,(state.queue.find(row=>row.sku===sku)?.quantity??0)+Number(button.dataset.delta));const result=editQuantity(sku,String(quantity));if(result.ok)$(`#qty-${sku}`).value=quantity||'';}
  if(button.dataset.remove){setQuantity(state,button.dataset.remove,0);invalidInputs.delete(button.dataset.remove);save();render();notice('Varian dikeluarkan dari pilihan. Saldo belum berubah.');}
  if(button.dataset.route){const from=button.dataset.route;const result=setRoute(state,from,from==='floor'?'warehouse':'floor');if(result.ok){save();switchTab('move');}else notice(result.message,'error');}
});
$('#demo-five').addEventListener('click',()=>{invalidInputs.clear();state.queue=[];setQuantity(state,products[0].sku,Math.min(3,balances(state,products[0].sku)[state.from]));setQuantity(state,products[1].sku,Math.min(2,balances(state,products[1].sku)[state.from]));search='';$('#product-search').value='';save();render();notice(`Contoh ${totalQuantity(state.queue)} potong diisi. Saldo belum berubah.`,'success');});
$('#demo-over').addEventListener('click',()=>{search='';$('#product-search').value='';renderCatalogue();const sku=products[0].sku;const quantity=balances(state,sku)[state.from]+1;$(`#qty-${sku}`).value=quantity;editQuantity(sku,String(quantity));notice('Jumlah melebihi stok ditolak. Perbaiki isian sebelum melanjutkan.','error');});
$('#offline').addEventListener('change',()=>{state.online=!$('#offline').checked;save();renderSummary();notice(state.online?'Server toko kembali tersambung. Tinjau pilihan dan coba ulang.':'Server toko offline. Jumlah tetap tersimpan; saldo belum berubah.',state.online?'':'error');});
$('#partial').addEventListener('change',()=>{state.failNext=$('#partial').checked;save();notice(state.failNext?'Simulasi aktif: satu varian akan ditolak saat konfirmasi.':'Simulasi kegagalan dinonaktifkan.');});
function review(){
  if(!state.queue.length||invalidInputs.size)return;
  const q=totalQuantity(state.queue);const b=balances(state);
  $('#review-body').innerHTML=`<div class="review-route"><span>${places[state.from]}</span><span>→</span><span>${places[state.to]}</span></div><p class="review-total"><b>${q} potong</b> · ${state.queue.length} varian ukuran</p>${grouped(state.queue).map(p=>{const stock=balances(state,p.sku);return `<div class="review-item"><div>${p.name}<span>${p.colour} · ukuran ${p.size}</span><span>${places[state.from]} ${stock[state.from]} → ${stock[state.from]-p.quantity} · ${places[state.to]} ${stock[state.to]} → ${stock[state.to]+p.quantity}</span></div><b>${p.quantity} potong</b></div>`;}).join('')}<div class="review-balances">Total ${places[state.from]}: ${b[state.from]} → ${b[state.from]-q}<br>Total ${places[state.to]}: ${b[state.to]} → ${b[state.to]+q}<br>Total toko tetap ${totalStock(state)} potong.</div>${state.note?`<p class="history-note">Catatan: ${escape(state.note)}</p>`:''}${!state.online?'<p class="review-warning">Server toko tidak tersambung. Konfirmasi belum tersedia.</p>':''}`;
  $('#arrived').checked=false;$('#arrived').disabled=!state.online;$('#confirm').disabled=true;$('#confirm').textContent=`Pindahkan ${q} potong`;$('#review-dialog').showModal();
}
$('#review').addEventListener('click',review);$('#review-mobile').addEventListener('click',review);
$('#arrived').addEventListener('change',()=>{$('#confirm').disabled=!$('#arrived').checked||!state.online;});
$('#close-review').addEventListener('click',()=>$('#review-dialog').close());$('#back-edit').addEventListener('click',()=>$('#review-dialog').close());
$('#confirm').addEventListener('click',()=>{if(!$('#arrived').checked||!state.online)return;$('#confirm').disabled=true;const result=commit(state);save();$('#review-dialog').close();render();notice(result.message,result.ok?'success':'error');});
$('#clear-draft').addEventListener('click',()=>$('#clear-dialog').showModal());$('#cancel-clear').addEventListener('click',()=>$('#clear-dialog').close());
$('#confirm-clear').addEventListener('click',()=>{state.queue=[];state.note='';invalidInputs.clear();save();$('#clear-dialog').close();render();notice('Pilihan dikosongkan. Saldo stok tidak berubah.');});
$('#reset').addEventListener('click',()=>{state=createState();invalidInputs.clear();search='';$('#product-search').value='';save();render();notice('Data contoh dikembalikan ke awal.');});
switchTab('move');if(state.queue.length)notice(`Pilihan ${totalQuantity(state.queue)} potong dipulihkan. Saldo belum berubah untuk pilihan yang tersisa.`);
