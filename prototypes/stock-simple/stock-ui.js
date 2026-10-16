(() => {
  'use strict';
  const D=StockDemo;
  let isMove=location.hash==='#check'?false:location.hash==='#movement'?true:document.body.dataset.page==='movement';
  const $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons={
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', move:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
    warehouse:'<path d="m3 10 9-6 9 6v11H3V10Z"/><path d="M8 21V11h8v10M8 15h8M8 18h8"/>',
    shop:'<path d="M4 10v11h16V10M3 4h18l1 6a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2l1-6ZM8 21v-6h8v6"/>',
    clipboard:'<rect x="5" y="5" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="m8 14 3 3 5-6"/>',
    check:'<path d="m5 12 4 4L19 6"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>', box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7 5l10 5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>', warning:'<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5m0 3v1"/>',
    undo:'<path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5"/>'
  };
  const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.box}</svg>`;
  const paths={shirt:'M31 12 42 8 50 16 58 8 69 12 86 26 91 70 79 72 73 39 73 91 27 91 27 39 21 72 9 70 14 26Z',tee:'M31 14 41 10Q50 18 59 10L69 14 88 29 80 41 72 36 72 90 28 90 28 36 20 41 12 29Z',pants:'M29 8H71L76 93H58L50 34 42 93H24Z'};
  const thumb=p=>`<span class="thumb"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="${paths[p.shape]}" fill="${p.hex}" stroke="#00000018" stroke-width="1.5" stroke-linejoin="round"/></svg></span>`;
  const swatch=p=>`<i class="swatch" style="background:${p.hex}"></i>`;
  const time=at=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(at).replace('pukul','·');
  const fullName=p=>`${p.name}, ${p.color}, ukuran ${p.size}`;
  const signed=n=>n>0?`+${n}`:String(n);
  const state={from:'warehouse',to:'floor',place:'warehouse',draft:new Map(),query:'',onlySelected:false,filter:'all',success:null};
  let modalAction=null,toastTimer=null;
  function entries(){return [...state.draft].map(([id,d])=>({id,qty:Number(d.raw),revision:d.revision,raw:d.raw})).filter(l=>l.raw!=='' && (!isMove||l.qty!==0||!Number.isFinite(l.qty)));}
  function errorFor(id){
    const draft=state.draft.get(id); if(!draft||draft.raw==='') return '';
    const q=Number(draft.raw);
    if(!/^\d+$/.test(draft.raw)||!Number.isSafeInteger(q)) return 'Masukkan jumlah bulat, mulai dari 0.';
    if(isMove&&q>D.state.stock[id][state.from]) return `Tersedia ${D.state.stock[id][state.from]} pcs. Kurangi jumlahnya.`;
    if(!isMove&&q>9999) return 'Periksa jumlahnya. Maksimal 9.999 pcs.';
    if(!isMove&&draft.revision!==D.revision(id,state.place)) return 'Ada perpindahan baru. Hitung ulang, lalu isi kembali.';
    return '';
  }
  function stats(){const list=entries();return {list,count:list.length,total:list.reduce((sum,l)=>sum+(Number.isFinite(l.qty)?l.qty:0),0),valid:list.length>0&&list.every(l=>!errorFor(l.id))};}
  function shell(){
    $('#app').innerHTML=`<div class="prototype"><strong><i class="demo-dot"></i>Prototipe interaktif <span class="proto-extra">· data contoh, tersimpan di browser ini</span></strong><button data-action="reset">Ulangi demo</button></div>
      <header class="appbar"><div class="bar-inner"><div class="brand"><div class="mark">c.</div><div><strong>Toko Cikupa</strong><small>Pengelolaan stok</small></div></div>
      <nav class="nav" aria-label="Prototipe stok"><a href="#movement" data-view="movement" class="${isMove?'active':''}" ${isMove?'aria-current="page"':''}>${icon('move')}Pindahkan barang</a><a href="#check" data-view="check" class="${!isMove?'active':''}" ${!isMove?'aria-current="page"':''}>${icon('clipboard')}Cek stok fisik</a></nav>
      <div class="user"><span>Maya</span><span class="avatar">M</span></div></div></header><main class="main" id="main"></main><footer class="bottom-bar" id="bottom"></footer>`;
    render();
  }
  function render(){
    if(state.success) return renderSuccess();
    $('#bottom').hidden=false;
    const title=isMove?'Pindahkan barang':'Cek stok fisik';
    $('#main').innerHTML=`<div class="heading"><div><h1>${title}</h1><p>${isMove?'Pilih tujuan, lalu isi jumlah barang.':'Hitung barang. Stok tercatat tetap.'}</p></div><button class="button history-button" data-action="history" aria-label="${isMove?'Riwayat perpindahan':'Riwayat pengecekan'}">${icon('history')}<span>Riwayat</span></button></div>
      ${isMove?movementTop():checkTop()}
      ${isMove?`<div class="section-top"><div class="step-label"><span class="step-num">2</span>Berapa barang yang dipindahkan?</div><span class="hint">Isi jumlah per warna dan ukuran.</span></div>`:''}
      <div class="toolbar"><div class="search">${icon('search')}<input type="search" id="search" aria-label="Cari nama, kode, warna, atau ukuran barang" placeholder="Cari nama, kode, warna, atau ukuran…" value="${esc(state.query)}" autocomplete="off"><button class="search-clear" data-action="clear-search" aria-label="Hapus pencarian" ${state.query?'':'hidden'}>${icon('close')}</button></div>${isMove?`<label class="filter-toggle"><input type="checkbox" id="selected-only" ${state.onlySelected?'checked':''}>Yang dipilih saja</label>`:''}</div>
      ${!isMove?`<div class="all-results"><h2 id="list-heading">${filterLabel()}</h2><button class="text-button" data-action="all">Tampilkan semua barang</button></div>`:''}<div id="results" class="${isMove?'product-grid':'check-grid'}"></div><div id="result-count" class="result-count"></div>`;
    renderResults();renderBottom();
  }
  function movementTop(){
    return `<div class="step-label"><span class="step-num">1</span>Barang mau dipindahkan ke mana?</div><div class="route-options" role="group" aria-label="Arah perpindahan">${[['warehouse','floor','Ke area jual','Ambil dari gudang toko','shop'],['floor','warehouse','Ke gudang toko','Ambil dari area jual','warehouse']].map(([from,to,label,sub,ico])=>`<button class="route-option ${state.to===to?'active':''}" data-route="${to}" aria-pressed="${state.to===to}"><span class="route-icon">${icon(ico)}</span><span class="route-copy"><strong>${label}</strong><small>${sub}</small></span><span class="radio" aria-hidden="true"></span></button>`).join('')}</div><div class="direction">${icon('box')}<span>Dari <strong>${D.places[state.from]}</strong></span>${icon('arrow')}<span>ke <strong>${D.places[state.to]}</strong></span></div>`;
  }
  function filterLabel(){return {all:'Semua barang',unchecked:'Barang yang belum dicek',match:'Hasil hitung sesuai',gap:'Barang dengan selisih',stale:'Barang yang perlu dicek ulang'}[state.filter];}
  function checkTop(){
    const counts={unchecked:0,match:0,gap:0,stale:0};D.catalog.forEach(p=>counts[D.status(p.id,state.place).kind]++);
    return `<div class="location-row"><div class="location-switch" role="group" aria-label="Lokasi yang dicek">${['warehouse','floor'].map(k=>`<button class="${state.place===k?'active':''}" data-place="${k}" aria-pressed="${state.place===k}">${icon(k==='warehouse'?'warehouse':'shop')}${D.places[k]}</button>`).join('')}</div><span class="location-note">Pastikan kamu menghitung di <strong>${D.places[state.place].toLowerCase()}</strong>.</span></div>
    <div class="status-tabs" role="group" aria-label="Saring berdasarkan hasil pengecekan">${[['unchecked','Belum dicek'],['match','Sesuai'],['gap','Selisih'],['stale','Perlu cek ulang']].map(([kind,label])=>`<button class="status-tab ${kind} ${state.filter===kind?'active':''}" data-filter="${kind}" aria-pressed="${state.filter===kind}"><span class="label"><i class="dot"></i>${label}</span><b>${counts[kind]}</b></button>`).join('')}</div>`;
  }
  function filtered(){
    const q=state.query.trim().toLocaleLowerCase('id');
    return D.catalog.filter(p=>(!q||`${p.name} ${p.code} ${p.color} ${p.size}`.toLocaleLowerCase('id').includes(q))&&(!isMove||!state.onlySelected||state.draft.has(p.id))&&(isMove||state.filter==='all'||D.status(p.id,state.place).kind===state.filter));
  }
  function renderResults(){
    const products=filtered();
    if(isMove){
      const groups=new Map();for(const p of products){if(!groups.has(p.code))groups.set(p.code,[]);groups.get(p.code).push(p);}
      $('#results').innerHTML=[...groups.values()].map(list=>`<section class="product"><div class="product-head">${thumb(list[0])}<div><h2>${list[0].name}</h2><p>${list[0].code}</p></div><span class="variant-count">${list.length} varian</span></div><div class="col-labels"><span>Warna · ukuran</span><span>Tersedia</span><span>Pindah (pcs)</span></div>${list.map(moveRow).join('')}</section>`).join('');
    } else $('#results').innerHTML=products.map(checkCard).join('');
    if(!products.length) $('#results').innerHTML=`<div class="empty">${icon(isMove?'box':'clipboard')}<h3>${state.query?'Barang tidak ditemukan':isMove?'Belum ada barang dipilih':'Tidak ada barang di kategori ini'}</h3><p>${state.query?'Coba nama, kode, warna, atau ukuran lain.':isMove?'Matikan filter ini, lalu isi jumlah barang.':'Pilih kategori lain atau tampilkan semua barang.'}</p><button class="text-button" data-action="clear-filters">Tampilkan semua barang</button></div>`;
    $('#result-count').textContent=`${products.length} dari ${D.catalog.length} varian barang`;
  }
  function stepper(p,blank=false){
    const raw=state.draft.get(p.id)?.raw??(blank?'':'0'), qty=Number(raw)||0;
    const max=isMove?D.state.stock[p.id][state.from]:9999;
    return `<div class="stepper"><button data-adjust="${p.id}" data-delta="-1" aria-label="Kurangi jumlah ${esc(fullName(p))}" ${qty<=0?'disabled':''}>−</button><input id="qty-${p.id}" data-qty="${p.id}" inputmode="numeric" pattern="[0-9]*" value="${esc(raw)}" placeholder="—" aria-label="${isMove?'Jumlah yang dipindahkan':'Hasil hitung fisik'} ${esc(fullName(p))}" aria-describedby="feedback-${p.id}" ${max===0&&isMove?'disabled':''}><button data-adjust="${p.id}" data-delta="1" aria-label="Tambah jumlah ${esc(fullName(p))}" ${qty>=max?'disabled':''}>+</button></div>`;
  }
  function moveRow(p){
    const q=Number(state.draft.get(p.id)?.raw)||0,b=D.state.stock[p.id];
    return `<div class="variant ${q>0?'selected':''}" data-row="${p.id}"><div class="variant-line"><div class="variant-name">${swatch(p)}<span>${p.color} <span class="size">${p.size}</span></span></div><div class="stock-count ${b[state.from]===0?'zero':''}">${b[state.from]||'Habis'}</div>${stepper(p)}</div><div id="feedback-${p.id}">${feedback(p)}</div></div>`;
  }
  function feedback(p){
    const draft=state.draft.get(p.id),error=errorFor(p.id),q=Number(draft?.raw)||0,b=D.state.stock[p.id];
    if(error) return `<div class="inline-error" role="alert">${error}</div>`;
    if(isMove&&q>0) return `<div class="preview-line"><span>${D.places[state.from]} ${b[state.from]} → <b>${b[state.from]-q}</b></span><span>${D.places[state.to]} ${b[state.to]} → <b>${b[state.to]+q}</b></span></div>`;
    if(!isMove&&draft&&draft.raw!=='') return `<div class="pending-line">${q===0?'Dicatat: tidak ada barang (0 pcs)':'Hasil hitung sudah diisi'} · belum disimpan</div>`;
    return '';
  }
  function checkCard(p){
    const status=D.status(p.id,state.place), seen=status.seen;
    let message='Hitung barang di lokasi ini untuk membuat catatan pertama.';
    if(status.kind==='match') message='Hasil hitung sama dengan stok tercatat.';
    if(status.kind==='gap') message=`Ditemukan ${Math.abs(status.diff)} pcs ${status.diff<0?'lebih sedikit':'lebih banyak'}. Hitung ulang untuk memastikan.`;
    if(status.kind==='stale') message='Ada perpindahan setelah cek terakhir. Hitung ulang untuk mengetahui kondisi terbaru.';
    return `<article class="check-card ${state.draft.has(p.id)?'editing':''}" data-row="${p.id}"><div class="check-head">${thumb(p)}<div class="check-title"><h3>${p.name}</h3><p>${swatch(p)}${p.color} · ${p.size}</p></div><span class="badge ${status.kind}">${status.kind==='match'?icon('check'):status.kind==='stale'?icon('clock'):''}${status.label}</span></div>
      <div class="check-numbers"><div class="check-number"><span>Stok tercatat sekarang</span><strong>${D.state.stock[p.id][state.place]}<em>pcs</em></strong></div><div class="check-number"><span>Hasil hitung terakhir</span>${seen?`<strong>${seen.qty}<em>pcs</em></strong>`:'<div class="missing">Belum ada catatan</div>'}</div></div>
      <p class="check-meta">${seen?`Dicek ${time(seen.at)} WIB · ${seen.who}`:'Belum pernah dicek'}</p><p class="check-message ${status.kind}">${message}</p>
      <div class="count-entry"><label for="qty-${p.id}">Hasil hitung baru<small>Isi 0 jika tidak ada barang.</small></label><div class="count-tools"><button class="clear-count" data-clear="${p.id}" aria-label="Kosongkan hasil hitung ${esc(fullName(p))}" ${state.draft.has(p.id)?'':'hidden'}>${icon('close')}</button>${stepper(p,true)}</div></div><div id="feedback-${p.id}">${feedback(p)}</div></article>`;
  }
  function renderBottom(){
    const s=stats();
    $('#bottom').innerHTML=`<div class="bottom-inner"><div class="bottom-copy"><strong>${isMove?(s.count?`${s.total} pcs dari ${s.count} varian`:'Belum ada barang dipilih'):(s.count?`${s.count} hasil hitung siap disimpan`:'Belum ada hasil hitung baru')}</strong><p>${isMove?`${D.places[state.from]} → ${D.places[state.to]}`:s.count?`Lokasi: ${D.places[state.place]} · stok tercatat tetap`:'Kolom kosong berarti belum dihitung.'}</p></div>${s.count?'<button class="button subtle" data-action="clear-draft">Kosongkan</button>':''}<button class="button primary" data-action="review" ${s.valid?'':'disabled'}>${isMove?'Cek perpindahan':'Cek hasil hitung'}${icon('arrow')}</button></div>`;
  }
  function setDraft(id,raw,rerender=false){
    if(raw==='' || (isMove && raw==='0')) state.draft.delete(id);
    else state.draft.set(id,{raw,revision:D.revision(id,state.place)});
    if(rerender){const row=$(`[data-row="${id}"]`);if(row)row.outerHTML=isMove?moveRow(D.product(id)):checkCard(D.product(id));}
    else {
      const row=$(`[data-row="${id}"]`), p=D.product(id);if(row){
        row.classList.toggle(isMove?'selected':'editing',state.draft.has(id));
        $(`#feedback-${id}`).innerHTML=feedback(p);
        const q=Number(raw)||0,max=isMove?D.state.stock[id][state.from]:9999;
        row.querySelector('[data-delta="-1"]').disabled=q<=0;
        row.querySelector('[data-delta="1"]').disabled=q>=max;
        row.querySelector('input').setAttribute('aria-invalid',Boolean(errorFor(id)));
        const clear=row.querySelector('[data-clear]');if(clear)clear.hidden=!state.draft.has(id);
      }
    }
    renderBottom();
  }
  function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
  function closeDialog(){if($('#dialog').open)$('#dialog').close();modalAction=null;}
  function dialog(title,subtitle,body,footer,action){
    const el=$('#dialog');if(el.open)el.close();modalAction=action;
    el.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="close-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div><div class="dialog-body">${body}<div id="dialog-error" class="dialog-error" role="alert" hidden></div></div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
    el.setAttribute('aria-labelledby','dialog-title');el.showModal();
  }
  function confirmDiscard(next,title='Kosongkan isian?'){
    if(!state.draft.size){next();return;}
    dialog(title,'Isian saat ini belum disimpan.',`<p>Kalau dilanjutkan, ${isMove?'pilihan barang':'hasil hitung yang baru diisi'} akan dikosongkan.</p>`,`<button class="button" data-action="close-dialog">Tetap di sini</button><button class="button primary" data-action="modal-confirm">Kosongkan & lanjut</button>`,()=>{state.draft.clear();closeDialog();next();});
  }
  function reviewItem(l,record=null){
    const p=D.product(l.id),b=record?.before||D.state.stock[l.id];
    return `<div class="review-item"><div class="top"><strong>${p.name}</strong><b>${l.qty} pcs</b></div><div class="detail">${swatch(p)}${p.color} · Ukuran ${p.size}</div>${isMove?`<div class="review-after"><span>${D.places[state.from]}: ${b[state.from]} → <b>${b[state.from]-l.qty}</b></span><span>${D.places[state.to]}: ${b[state.to]} → <b>${b[state.to]+l.qty}</b></span></div>`:`<div class="review-after"><span>Tercatat: ${b[state.place]} pcs</span><b>${l.qty===b[state.place]?'Sesuai':`Selisih ${signed(l.qty-b[state.place])} pcs`}</b></div>`}</div>`;
  }
  function review(){
    const s=stats();if(!s.valid)return;
    const lines=s.list.map(l=>({...l}));
    const route=isMove?`<div class="dialog-route"><div><span>DARI</span><strong>${D.places[state.from]}</strong></div>${icon('arrow')}<div><span>KE</span><strong>${D.places[state.to]}</strong></div></div>`:`<div class="notice">${icon('warehouse')}<span>Hasil penghitungan di <strong>${D.places[state.place]}</strong>.</span></div>`;
    dialog(isMove?'Cek perpindahannya':'Cek hasil hitungnya',isMove?'Pastikan barang dan jumlahnya sudah benar.':'Simpan jumlah yang benar-benar ditemukan.',`${route}${lines.map(l=>reviewItem(l)).join('')}<div class="dialog-summary"><span>${isMove?'Total dipindahkan':'Hasil hitung baru'}</span><strong>${isMove?`${s.total} pcs`:`${s.count} varian`}</strong></div><div class="notice">${icon('info')}<span>${isMove?'Simpan setelah barang selesai dipindahkan ke lokasi tujuan.':'Catatan pengecekan diperbarui. <strong>Stok tercatat tidak berubah.</strong>'}</span></div>`,`<button class="button" data-action="close-dialog">Ubah jumlah</button><button class="button primary" data-action="modal-confirm">${icon('check')}${isMove?'Simpan perpindahan':'Simpan hasil hitung'}</button>`,()=>{
      try {
        if(isMove){const result=D.move(lines,state.from,state.to);state.success={kind:'move',result};}
        else {const result=D.observe(lines,state.place);state.success={kind:'check',result};}
        state.draft.clear();closeDialog();render();window.scrollTo({top:0});
        if(!D.storageAvailable)toast('Browser tidak mengizinkan penyimpanan. Data hanya tersedia selama halaman terbuka.');
      }catch(error){$('#dialog-error').hidden=false;$('#dialog-error').textContent=error.message;}
    });
  }
  function renderSuccess(){
    $('#bottom').hidden=true;
    const s=state.success;
    if(s.kind==='move'){
      const r=s.result,total=r.lines.reduce((n,l)=>n+l.qty,0);
      $('#main').innerHTML=`<section class="success-panel"><div class="success-icon">${icon('check')}</div><div class="eyebrow">Perpindahan tersimpan</div><h1>${total} pcs sudah dicatat<br>ke ${D.places[r.to].toLowerCase()}.</h1><p>${D.places[r.from]} → ${D.places[r.to]} · ${time(r.at)} WIB</p><div class="success-list">${r.lines.map(l=>`<div class="review-item"><div class="top"><strong>${D.product(l.id).name}</strong><b>${l.qty} pcs</b></div><div class="detail">${D.product(l.id).color} · Ukuran ${D.product(l.id).size}</div></div>`).join('')}</div><div class="notice">${icon('clipboard')}<span>Hasil cek fisik sebelumnya ditandai <strong>perlu cek ulang</strong> untuk barang dan lokasi yang berubah.</span></div><div class="actions"><button class="button primary" data-action="new">Pindahkan barang lagi${icon('arrow')}</button><button class="button" data-action="undo-last">Batalkan perpindahan</button></div></section>`;
    } else {
      const list=s.result, gaps=list.filter(x=>x.qty!==x.expected).length;
      $('#main').innerHTML=`<section class="success-panel"><div class="success-icon">${icon('check')}</div><div class="eyebrow">Pengecekan tersimpan</div><h1>${list.length} hasil hitung<br>berhasil dicatat.</h1><p>${D.places[state.place]} · ${time(list[0].at)} WIB · Maya</p><div class="success-list"><div class="dialog-summary"><span>Sesuai dengan stok tercatat</span><strong>${list.length-gaps} varian</strong></div><div class="dialog-summary"><span>Perlu diperiksa karena selisih</span><strong>${gaps} varian</strong></div></div><div class="notice">${icon('info')}<span><strong>Stok tercatat tetap.</strong> ${gaps?'Hitung ulang barang yang selisih. Jika tetap berbeda, sampaikan kepada penanggung jawab toko.':'Waktu dan hasil hitung terbaru sudah tersedia di daftar barang.'}</span></div><div class="actions"><button class="button primary" data-action="new">${gaps?'Lihat barang selisih':'Lanjut cek barang'}${icon('arrow')}</button><button class="button" data-action="show-all-after-save">Lihat semua barang</button></div></section>`;
    }
  }
  function history(){
    const content=isMove?D.state.history.map(r=>`<div class="history-item ${r.undone?'undone':''}"><h3>${r.lines.reduce((n,l)=>n+l.qty,0)} pcs · ${D.places[r.from]} → ${D.places[r.to]}</h3><p>${time(r.at)} WIB · ${r.who}${r.undone?' · Dibatalkan':''}</p><div class="detail-lines">${r.lines.map(l=>`${D.product(l.id).name} · ${D.product(l.id).color} ${D.product(l.id).size} — ${l.qty} pcs`).join('<br>')}</div></div>`).join(''):D.state.checks.map(r=>`<div class="history-item"><h3>${r.lines.length} hasil hitung · ${D.places[r.place]}</h3><p>${time(r.at)} WIB · Maya</p><div class="detail-lines">${r.lines.map(l=>`${D.product(l.id).name} · ${D.product(l.id).color} ${D.product(l.id).size} — ditemukan ${l.qty} pcs (tercatat saat cek: ${l.expected})`).join('<br>')}</div></div>`).join('');
    dialog(isMove?'Riwayat perpindahan':'Riwayat pengecekan','Aktivitas yang kamu simpan dalam demo ini.',content||'<div class="empty"><h3>Belum ada aktivitas baru</h3><p>Aktivitas yang disimpan akan muncul di sini.</p></div>','',null);
  }
  document.addEventListener('input',e=>{
    if(e.target.matches('[data-qty]')){setDraft(e.target.dataset.qty,e.target.value);return;}
    if(e.target.id==='search'){state.query=e.target.value;renderResults();$('.search-clear').hidden=!state.query;}
  });
  document.addEventListener('change',e=>{if(e.target.id==='selected-only'){state.onlySelected=e.target.checked;renderResults();}});
  document.addEventListener('focusin',e=>{if(e.target.matches('[data-qty]'))e.target.select();});
  document.addEventListener('keydown',e=>{if(e.target.matches('[data-qty]')&&e.key==='Enter'){e.preventDefault();e.target.blur();if(stats().valid)review();}});
  document.addEventListener('click',e=>{
    const link=e.target.closest('.nav a');
    if(link){e.preventDefault();const next=()=>{isMove=link.dataset.view==='movement';state.success=null;state.query='';state.onlySelected=false;state.filter='all';document.body.dataset.page=isMove?'movement':'check';document.title=`${isMove?'Pindahkan barang':'Cek stok fisik'} · Toko Cikupa`;window.history.replaceState(null,'',link.href);shell();window.scrollTo({top:0});};if(state.draft.size)confirmDiscard(next,'Buka halaman lain?');else next();return;}
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.adjust){const id=b.dataset.adjust,delta=b.dataset.delta,q=Math.max(0,Math.min(isMove?D.state.stock[id][state.from]:9999,(Number(state.draft.get(id)?.raw)||0)+Number(delta)));setDraft(id,String(q),true);const next=$(`[data-row="${id}"] [data-delta="${delta}"]`);(next&&!next.disabled?next:$(`#qty-${id}`))?.focus({preventScroll:true});return;}
    if(b.dataset.clear){setDraft(b.dataset.clear,'',true);return;}
    if(b.dataset.route){const to=b.dataset.route;if(to===state.to)return;confirmDiscard(()=>{state.to=to;state.from=to==='floor'?'warehouse':'floor';state.onlySelected=false;render();},'Ganti tujuan perpindahan?');return;}
    if(b.dataset.place){const place=b.dataset.place;if(place===state.place)return;confirmDiscard(()=>{state.place=place;state.filter='all';render();},'Pindah lokasi pengecekan?');return;}
    if(b.dataset.filter){state.filter=state.filter===b.dataset.filter?'all':b.dataset.filter;render();return;}
    switch(b.dataset.action){
      case 'close-dialog':closeDialog();break;
      case 'modal-confirm':if(modalAction)modalAction();break;
      case 'review':review();break;
      case 'history':history();break;
      case 'clear-search':state.query='';$('#search').value='';$('.search-clear').hidden=true;renderResults();$('#search').focus();break;
      case 'clear-filters':state.query='';state.onlySelected=false;state.filter='all';render();break;
      case 'all':state.filter='all';render();break;
      case 'clear-draft':confirmDiscard(()=>render());break;
      case 'new':{
        if(!isMove){state.filter=state.success.result.some(x=>x.qty!==x.expected)?'gap':'unchecked';}
        state.success=null;state.query='';state.onlySelected=false;render();window.scrollTo({top:0});break;
      }
      case 'show-all-after-save':state.success=null;state.filter='all';state.query='';render();window.scrollTo({top:0});break;
      case 'undo-last':{
        const r=state.success.result;
        dialog('Batalkan perpindahan ini?','Pastikan barang dikembalikan ke lokasi asal.',`<div class="notice">${icon('undo')}<span>${r.lines.reduce((n,l)=>n+l.qty,0)} pcs akan dicatat kembali dari <strong>${D.places[r.to]}</strong> ke <strong>${D.places[r.from]}</strong>.</span></div>`,`<button class="button" data-action="close-dialog">Kembali</button><button class="button primary" data-action="modal-confirm">Ya, batalkan</button>`,()=>{try{D.undo(r.id);state.success=null;closeDialog();render();toast('Perpindahan dibatalkan. Stok dikembalikan.');}catch(error){$('#dialog-error').hidden=false;$('#dialog-error').textContent=error.message;}});break;
      }
      case 'reset':dialog('Ulangi demo dari awal?','Berlaku untuk kedua prototipe.',`<p>Perpindahan dan hasil hitung yang kamu buat dalam demo ini akan dihapus. Data contoh awal akan ditampilkan lagi.</p>`,`<button class="button" data-action="close-dialog">Kembali</button><button class="button primary" data-action="modal-confirm">Ulangi demo</button>`,()=>{D.reset();state.draft.clear();state.success=null;state.query='';state.filter='all';state.onlySelected=false;state.from='warehouse';state.to='floor';state.place='warehouse';closeDialog();render();toast('Data contoh sudah dikembalikan.');});break;
    }
  });
  window.addEventListener('storage',e=>{
    if(e.key!==D.key)return;D.reload();const hadDialog=$('#dialog').open;closeDialog();
    if(state.success)state.success=null;render();
    toast(hadDialog?'Data berubah dari halaman lain. Periksa kembali sebelum menyimpan.':'Data diperbarui dari halaman lain.');
  });
  window.addEventListener('beforeunload',e=>{if(state.draft.size){e.preventDefault();e.returnValue='';}});
  shell();
})();
