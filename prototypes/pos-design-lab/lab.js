import { products, concepts, makeState, totals, addTag, takePayment } from './model.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => 'Rp ' + n.toLocaleString('id-ID');
let version = Math.max(0, Math.min(5, Number(new URL(location.href).searchParams.get('v')) || 0));
let states = concepts.map(() => makeState());
let s = states[version], modalKind = '', priorFocus;
const paths = {
 scan:'M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M8 8v8m4-8v8m4-8v8',
 arrow:'M5 12h14m-5-5 5 5-5 5', back:'M19 12H5m5-5-5 5 5 5',
 bag:'M5 8h14l1 12H4L5 8Zm4 0V6a3 3 0 0 1 6 0v2',
 user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
 tag:'m3 3 8 0 10 10-8 8L3 11V3Zm5 4h.01',
 clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
 grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
 more:'M5 12h.01M12 12h.01M19 12h.01',
 check:'m5 12 4 4L19 6', x:'m6 6 12 12M6 18 18 6',
 lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
 receipt:'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6',
 cash:'M2 5h20v14H2V5Zm13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
 card:'M2 5h20v14H2V5Zm0 5h20M6 15h3',
 search:'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
 star:'m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
 plus:'M12 5v14M5 12h14', history:'M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v6l4 2',
};
const icon = n => `<svg class="ico icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.grid}"/></svg>`;
const button = (label, action, cls='', extra='') => `<button type="button" class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
function garment(p) {
 const shapes = {tee:'M24 12 38 7l8 6 8-6 14 5 17 17-15 14-8-7v45H30V36l-8 7L7 29Z',shirt:'M24 12 38 7l8 6 8-6 14 5 17 17-15 14-8-7v45H30V36l-8 7L7 29Z',pants:'M26 8h42l5 74H51l-5-46-5 46H19Z',dress:'M34 8h8l4 8 4-8h8l3 26 17 46H14l17-46Z',bag:'M21 27h50l5 54H16Zm12 0V19a13 13 0 0 1 26 0v8'};
 return `<svg viewBox="0 0 92 92" class="garment" aria-hidden="true"><path d="${shapes[p.shape]}" fill="${p.color}" stroke="${p.color}" stroke-width="2" stroke-linejoin="round"/>${['tee','shirt'].includes(p.shape)?'<path d="M38 7q8 20 16 0" fill="none" stroke="#ffffff60" stroke-width="2"/>':''}${p.shape==='shirt'?'<path d="M46 21v60" stroke="#ffffff60" stroke-width="1.5"/>':''}</svg>`;
}
function lab() {
 $('#lab').innerHTML = `<div class="lab-top"><a href="?v=0" class="lab-brand">central<span>/</span><strong>POS design lab</strong></a><span class="prototype-label"><i></i> Prototipe interaktif · data contoh</span>${button(icon('grid')+' Bandingkan','compare','quiet')}${button(icon('history')+' Reset versi','reset','quiet')}</div><nav class="version-nav" aria-label="Pilih versi desain">${concepts.map((c,i)=>`<button data-version="${i}" class="version-tab ${i===version?'active':''}" aria-current="${i===version?'page':'false'}"><span>${String(i).padStart(2,'0')}</span>${c.name}${i===1?'<small>Rekomendasi</small>':''}</button>`).join('')}</nav><div class="concept-caption"><span><strong>${concepts[version].title}</strong> ${concepts[version].desc}</span><span>${concepts[version].for}</span></div>`;
}
function header() {
 if (version===0) return `<header class="topbar"><span class="brand"><span class="brand-mark">c.</span>central</span><div class="top-right"><button class="top-tool" data-action="lock">${icon('lock')}Lock</button><span class="top-sep"></span><span class="badge plain">Kasir 1</span><span class="avatar" title="Dian">DI</span><button class="btn primary lg" data-action="shift">Finish shift</button></div></header>`;
 return `<header class="pos-header"><div class="wordmark"><span>c.</span>central<small>POINT OF SALE</small></div><div class="store-meta"><strong>Central · Bandung</strong><span>Kasir 01 <b>·</b> Senin, 12 Oktober 2026</span></div><div class="header-end"><span class="online"><i></i> Terhubung</span>${button(icon('history')+' Riwayat','history','quiet')}${button(icon('lock'),'lock','icon-only','aria-label="Kunci kasir"')}<button class="cashier" data-action="shift"><span>DI</span><div><strong>Dian</strong><small>Shift 09.00–17.00</small></div></button></div></header>`;
}
function scan() {
 return `<div class="scan-module"><form data-form="scan" class="scan-box">${icon('scan')}<input id="scan" name="scan" autocomplete="off" aria-label="Scan tag atau cari barang" placeholder="Scan tag atau cari barang…"><kbd>F2</kbd><button type="submit" aria-label="Proses scan">${icon('arrow')}</button></form><div class="scan-sub"><span><i class="live-dot"></i>Siap menerima tag RFID</span>${button('Coba scan tag','demo','text-button')}</div></div>`;
}
function customer(compact=false) {
 return `<button class="member-card ${compact?'compact':''} ${s.member?'connected':''}" data-action="member"><span class="member-avatar">${s.member?'RW':icon('user')}</span><span><strong>${s.member?'Rina Wati':'Tambahkan pelanggan'}</strong><small>${s.member?'Member Gold · 1.250 poin':'Opsional · nomor member atau telepon'}</small></span>${icon(s.member?'check':'plus')}</button>`;
}
function perks() {
 return `<div class="perk-row">${button(icon('tag')+(s.coupon?'HEMAT50K ✓':'Kupon'),'coupon',s.coupon?'selected':'')}${button(icon('bag')+(s.bag?'Paper bag ✓':'Tas belanja'),'bag',s.bag?'selected':'')}</div>`;
}
function cart(table=false) {
 if(!s.items.length) return `<div class="empty-cart">${icon('scan')}<h2>Siap untuk pelanggan berikutnya</h2><p>Scan tag barang untuk memulai transaksi.</p>${button('Coba scan tag contoh','demo','primary')}</div>`;
 if(table) return `<div class="table-scroll"><table class="cart-table"><thead><tr><th>No.</th><th>Barang / SKU</th><th>Varian</th><th>Tag RFID</th><th class="right">Harga</th><th></th></tr></thead><tbody>${s.items.map((p,i)=>`<tr><td class="muted">${String(i+1).padStart(2,'0')}</td><td><strong>${p.name}</strong><small>${p.sku}</small></td><td>${p.detail}</td><td><span class="tag-code">…${p.tag.slice(-8)}</span></td><td class="right num"><strong>${money(p.price)}</strong></td><td>${button(icon('x'),'remove','icon-only',`data-id="${p.id}" aria-label="Hapus ${p.name}"`)}</td></tr>`).join('')}</tbody></table></div>`;
 return `<div class="item-list">${s.items.map((p,i)=>`<article class="item ${s.last===p.id?'just-added':''}"><div class="product-thumb" style="--swatch:${p.color}">${garment(p)}</div><div class="item-copy"><span class="item-kicker">${p.sku}</span><strong>${p.name}</strong><span>${p.detail} <b>·</b> 1 unit</span><small class="tag-note">${icon('check')} Tag …${p.tag.slice(-6)}</small></div><div class="item-price"><strong>${money(p.price)}</strong>${button(icon('x'),'remove','icon-only',`data-id="${p.id}" aria-label="Hapus ${p.name}"`)}</div></article>`).join('')}</div>`;
}
function amounts(large=true) {
 const t=totals(s);
 return `<div class="amounts"><div><span>Subtotal <small>(${s.items.length} barang)</small></span><strong>${money(t.subtotal)}</strong></div>${s.coupon?`<div class="savings"><span>Kupon HEMAT50K</span><strong>−${money(t.discount)}</strong></div>`:''}${s.bag?`<div><span>Paper bag</span><strong>${money(3000)}</strong></div>`:''}${s.coupon&&!t.discount?'<p class="inline-error">Kupon berlaku mulai Rp 300.000.</p>':''}<div class="sum-total ${large?'large':''}"><span>Total belanja</span><strong>${money(t.total)}</strong></div></div>`;
}
function checkout(label='Lanjut pembayaran') {
 return button(`<span>${label}</span><span>${icon('arrow')}<kbd>F8</kbd></span>`,'checkout','primary checkout',!s.items.length?'disabled':'');
}
function footer() { return `<footer class="pos-footer"><span><i class="live-dot"></i> Simulasi lokal <b>·</b> ${s.items.length} tag unik di keranjang</span><span><kbd>F2</kbd> Scan <kbd>F8</kbd> Bayar <kbd>F9</kbd> Tersimpan <kbd>Esc</kbd> Kembali</span></footer>`; }
function toolsRow() { return `<div class="tools-row">${button(icon('clock')+' Simpan dulu','hold','',!s.items.length?'disabled':'')}${button('Tersimpan <span class="count-pill">'+s.held.length+'</span>','held')}${button(icon('more'),'more','icon-only','aria-label="Alat transaksi lainnya"')}</div>`; }
function summary() { return `<aside class="summary-panel"><div class="panel-heading"><h2>Ringkasan</h2><span class="eyebrow">#DEMO-012</span></div>${customer()}${perks()}<div class="summary-space"><div class="calm-note">${icon('check')}<span>Setiap barang punya tag unik.<br>Jumlah mengikuti hasil scan.</span></div></div>${amounts()}${checkout()}<p class="payment-hint">Tunai · Debit · QRIS · Voucher</p></aside>`; }
function baseline() {
 const t=totals(s);
 return `<div id="app" data-screen="sale">${header()}<main class="workspace"><section class="pane-left"><div class="block"><form class="scan-row" data-form="scan"><div class="scan-field">${icon('scan')}<input id="scan" name="scan" aria-label="Scan tag atau cari barang" placeholder="Scan a tag or search items" autocomplete="off"><button class="scan-go" aria-label="Scan">${icon('arrow')}</button></div></form><p class="baseline-demo">Data contoh · <button data-action="demo">Coba scan tag</button></p></div><div class="block"><div class="block-head"><span class="label">Coupon & member</span></div><form class="inline-form" data-form="coupon"><div class="field-wrap"><input class="plain" name="coupon" placeholder="Coupon code" aria-label="Coupon code"></div><button class="btn">Apply</button></form>${s.coupon?'<div class="chips"><button class="chip on" data-action="coupon">HEMAT50K ×</button></div>':''}<div class="inline-form" style="margin-top:8px"><div class="field-wrap"><input class="plain" aria-label="Member number" id="baseline-member" placeholder="Member number" value="${s.member?'M00125':''}"></div></div></div><div class="spacer"></div><div class="utility"><div class="utility-row">${[['clock','Hold','hold'],['receipt','Held','held'],['bag','Bags','bag'],['scan','From handheld','demo']].map(([i,l,a])=>`<button class="util" data-action="${a}">${icon(i)}${l}</button>`).join('')}</div><div class="utility-row">${[['back','Return','returns'],['x','Void','void'],['star','Redeem points','points'],['cash','Shift & cash','shift']].map(([i,l,a])=>`<button class="util" data-action="${a}">${icon(i)}${l}</button>`).join('')}</div></div></section><section class="pane-right"><div class="cart-head"><h2>Basket <span class="badge plain">${s.items.length} items</span></h2></div><div class="cart-list no-bar">${s.items.length?s.items.map(p=>`<div class="cart-row"><div class="cart-main"><div class="cart-copy"><div class="cart-meta"><span>${p.sku}</span><span> · …${p.tag.slice(-8)}</span></div><p>${p.name}</p></div><span class="cart-total num">${money(p.price)}</span><button class="icon-btn" data-action="remove" data-id="${p.id}" aria-label="Hapus ${p.name}">${icon('x')}</button></div></div>`).join(''):'<div class="empty"><h3>Ready for a new sale</h3><p>Scan the first tag to start.</p></div>'}</div><div class="totals"><div class="total-line"><span class="muted">Subtotal</span><span>${money(t.subtotal)}</span></div>${s.coupon?`<div class="total-line cut"><span>HEMAT50K</span><span>−${money(t.discount)}</span></div>`:''}${s.bag?'<div class="total-line"><span>Paper bag</span><span>Rp 3.000</span></div>':''}<div class="grand"><span>TOTAL</span><strong>${money(t.total)}</strong></div></div><div class="payment-panel"><div class="label">Payment</div><div class="baseline-methods">${['Tunai','Debit','QRIS','Voucher'].map(m=>`<button class="btn" data-action="checkout" data-method="${m}" ${!s.items.length?'disabled':''}>${icon(m==='Tunai'?'cash':'card')}${m}</button>`).join('')}</div></div><div class="action-bar"><button class="btn danger" data-action="void">Cancel sale</button><button class="btn primary lg" data-action="checkout" ${!s.items.length?'disabled':''}>Pay ${money(t.total)} →</button></div></section></main><div class="statusbar"><span>● Node connected · demo</span><span class="right">Kasir 1 · Web POS</span></div></div>`;
}
function focus() { return `<div class="sale-layout focus-layout"><section class="basket-panel"><div class="panel-heading"><div><span class="eyebrow">TRANSAKSI BARU</span><h1>Belanja pelanggan <span class="number-badge">${s.items.length}</span></h1></div>${toolsRow()}</div>${scan()}${cart()}<div class="basket-bottom">${icon('scan')} Semua barang di atas sudah teridentifikasi</div></section>${summary()}</div>`; }
function catalogue() {
 const rows=products.filter(p=>(s.category==='Semua'||p.kind===s.category)&&(!s.search||`${p.name} ${p.sku} ${p.detail}`.toLowerCase().includes(s.search.toLowerCase())));
 return `<div class="category-tabs" aria-label="Kategori produk">${['Semua','Atasan','Bawahan','Dress','Aksesori'].map(c=>button(c,'category',s.category===c?'active':'',`data-category="${c}"`)).join('')}</div><div class="product-grid">${rows.map(p=>`<button class="product-card" data-action="product" data-id="${p.id}"><div class="product-art" style="background:${p.color}18">${garment(p)}<span>${p.kind}</span></div><div class="product-info"><strong>${p.name}</strong><small>${p.detail}</small><b>${money(p.price)}</b></div></button>`).join('')||'<div class="empty-cart"><h2>Barang tidak ditemukan</h2><p>Coba nama atau SKU yang lain.</p></div>'}</div>`;
}
function touch() {return `<div class="sale-layout touch-layout"><section class="catalogue-panel"><div class="panel-heading"><div><span class="eyebrow">KATALOG TOKO</span><h1>Temukan barang</h1></div>${button(icon('clock')+' Tersimpan '+s.held.length,'held')}</div>${scan()}<div class="catalogue-content">${catalogue()}</div><p class="catalogue-note">Pilih barang untuk cek harga. Scan tag untuk menambah ke keranjang.</p></section><aside class="touch-basket"><div class="panel-heading"><h2>Keranjang <span class="number-badge">${s.items.length}</span></h2>${button(icon('clock'),'hold','icon-only','aria-label="Simpan transaksi"')}</div>${customer(true)}${cart()}${perks()}${amounts(false)}${checkout('Bayar sekarang')}</aside></div>`;}
function steps() {return `<nav class="stepper" aria-label="Langkah transaksi">${['Barang','Pelanggan','Pembayaran'].map((n,i)=>`<button data-action="step" data-step="${i+1}" class="${s.step===i+1?'active':''} ${s.step>i+1?'complete':''}" ${s.payments.length?'disabled':''}><span>${s.step>i+1?icon('check'):i+1}</span>${n}</button>`).join('')}</nav>`;}
function guided() {
 return `<div class="guided-layout">${steps()}<div class="guided-heading"><span class="eyebrow">LANGKAH ${String(s.step).padStart(2,'0')} DARI 03</span><h1>${s.step===1?'Scan barang belanjaan.':'Kenali pelanggan Anda.'}</h1><p>${s.step===1?'Periksa barang dan varian sebelum melanjutkan.':'Tambahkan member dan kupon, atau langsung lanjut bayar.'}</p></div><section class="guided-card">${s.step===1?`${scan()}${cart()}`:`<div class="guided-customer">${customer()}<div class="guided-options"><div>${icon('tag')}<h2>Punya kupon?</h2><p>Gunakan kupon pelanggan sebelum bayar.</p>${button(s.coupon?'HEMAT50K diterapkan':'Tambahkan kupon','coupon')}</div><div>${icon('bag')}<h2>Perlu tas belanja?</h2><p>Paper bag · Rp 3.000 per tas.</p>${button(s.bag?'Tas sudah ditambahkan':'Tambahkan tas','bag')}</div></div></div>`}</section><div class="guided-bottom"><div>${button(icon('back')+(s.step===1?' Simpan dulu':' Kembali'),s.step===1?'hold':'step-back','quiet')}<span>${s.items.length} barang <b>·</b> <strong>${money(totals(s).total)}</strong></span></div>${button(s.step===1?'Lanjut ke pelanggan '+icon('arrow'):'Lanjut pembayaran '+icon('arrow'),'step-next','primary',!s.items.length?'disabled':'')}</div></div>`;
}
function express() {return `<div class="express-layout"><div class="express-command"><div><span class="eyebrow">TRANSAKSI #DEMO-012</span><h1>Kasir cepat</h1></div>${scan()}${button(icon('clock')+' Tersimpan '+s.held.length,'held')}</div><div class="express-info">${customer(true)}${perks()}${button('Simpan transaksi','hold','quiet')}</div><section class="express-table">${cart(true)}<div class="express-table-note"><span>${s.items.length} tag unik · Satu baris untuk setiap barang</span>${button('+ Simulasikan scan','demo','text-button')}</div></section><div class="express-checkout"><div class="express-shortcuts"><span><kbd>F2</kbd> Scan / cari</span><span><kbd>F9</kbd> Tersimpan</span>${button(icon('more')+' Alat lainnya','more','quiet')}</div><div class="express-money"><span>${s.coupon?'Diskon '+money(totals(s).discount):'Total belanja'}</span><strong>${money(totals(s).total)}</strong></div>${checkout('Bayar')}</div></div>`;}
function service() {return `<div class="service-layout"><aside class="client-panel"><span class="eyebrow">PELANGGAN HARI INI</span><div class="client-profile"><div class="profile-circle">${s.member?'RW':icon('user')}</div><h2>${s.member?'Rina Wati':'Selamat datang'}</h2><p>${s.member?'Member Gold · M00125':'Mulai pengalaman belanja yang lebih personal.'}</p>${button(s.member?'Ganti pelanggan':'Hubungkan member','member')}</div>${s.member?'<div class="loyalty-card"><span>Poin tersedia</span><strong>1.250 <small>poin</small></strong><p>Poin contoh, bukan saldo akun asli.</p></div>':'<div class="loyalty-card"><span>Member central</span><strong>Belanja lebih berarti.</strong><p>Hubungkan member untuk mencatat pembelian.</p></div>'}<div class="service-benefits"><h3>Lengkapi belanja</h3>${button(icon('tag')+(s.coupon?'Kupon HEMAT50K ✓':'Tambahkan kupon'),'coupon')}${button(icon('bag')+(s.bag?'Paper bag ditambahkan ✓':'Paper bag · Rp 3.000'),'bag')}</div><div class="client-tools">${toolsRow()}</div></aside><section class="service-basket"><div class="panel-heading"><div><span class="eyebrow">PILIHAN PELANGGAN</span><h1>Belanja <span class="number-badge">${s.items.length}</span></h1></div></div>${scan()}${cart()}</section><aside class="service-payment"><span class="eyebrow">SELESAIKAN BELANJA</span><h2>Pembayaran</h2>${amounts(false)}${paymentForm(true)}</aside></div>`;}
function paymentForm(inline=false) {
 const t=totals(s);
 return `<div class="payment-form ${inline?'inline-payment':''}"><label class="field-label">Metode pembayaran</label><div class="method-options">${['Tunai','Debit','QRIS','Voucher'].map(m=>button(icon(m==='Tunai'?'cash':m==='QRIS'?'scan':'card')+m,'method',s.method===m?'active':'',`data-method="${m}"`)).join('')}</div>${s.method==='Debit'?`<div class="bank-options">${['BCA','Mandiri','BRI'].map(b=>button(b,'bank',s.bank===b?'active':'',`data-bank="${b}"`)).join('')}</div>`:''}${s.method!=='Tunai'?`<label class="input-label">${s.method==='Debit'?'Kode approval EDC':s.method==='Voucher'?'Kode voucher':'Nomor referensi QRIS'}<input id="reference" value="${esc(s.reference)}" autocomplete="off" placeholder="Masukkan referensi contoh"></label><p class="payment-help">Konfirmasikan pembayaran pelanggan sebelum mencatat.</p>`:''}<label class="input-label">${s.method==='Tunai'?'Uang diterima':'Nominal pembayaran'}<div class="currency-field"><span>Rp</span><input id="amount" inputmode="numeric" autocomplete="off" placeholder="${t.due.toLocaleString('id-ID')}" value="${s.amount?Number(s.amount).toLocaleString('id-ID'):''}" aria-label="Nominal pembayaran"></div></label><div class="cash-presets">${[...new Set([t.due,Math.ceil(t.due/50000)*50000,Math.ceil(t.due/100000)*100000])].filter(n=>n>0).map((n,i)=>button(i===0?'Uang pas':money(n),'preset','',`data-amount="${n}"`)).join('')}${t.due>1?button('½ Split','preset','',`data-amount="${Math.ceil(t.due/2)}"`):''}</div>${!inline&&s.method==='Tunai'?`<div class="payment-numpad">${['1','2','3','4','5','6','7','8','9','000','0','⌫'].map(n=>button(n,'key','',`data-key="${n}"`)).join('')}</div>`:''}<div id="payment-feedback" class="payment-feedback" role="status">${paymentFeedback()}</div>${s.payments.length?`<div class="tender-list">${s.payments.map(p=>`<div><span>${icon('check')}${p.method}</span><strong>${money(p.amount)}</strong></div>`).join('')}<div><span>Sisa tagihan</span><strong>${money(t.due)}</strong></div></div>`:''}<p class="inline-error" id="payment-error" role="alert">${esc(s.error)}</p>${button('Catat pembayaran '+icon('arrow'),'pay','primary checkout',!s.items.length?'disabled':'')}<small class="simulation-note">Simulasi · tidak menarik dana atau mencetak struk.</small></div>`;
}
function paymentFeedback() {
 const t=totals(s), a=Number(s.amount)||0;
 return s.method==='Tunai'&&a>=t.due?`<span>Kembalian</span><strong>${money(a-t.due)}</strong>`:a>0&&a<t.due?`<span>Sisa setelah pembayaran ini</span><strong>${money(t.due-a)}</strong>`:`<span>Sisa yang perlu dibayar</span><strong>${money(t.due)}</strong>`;
}
function paymentPage() {
 return `<div class="payment-page">${version===3?steps():''}<div class="payment-heading">${button(icon('back')+' Kembali ke keranjang','back','quiet',s.payments.length?'disabled':'')}<span class="eyebrow">TRANSAKSI #DEMO-012</span></div><div class="payment-layout"><section class="payment-main"><span class="eyebrow">LANGKAH TERAKHIR</span><h1>Pembayaran</h1><p class="muted">Pilih metode, masukkan nominal, lalu catat pembayaran.</p>${paymentForm()}</section><aside class="payment-receipt"><div class="receipt-brand">central<span>Ringkasan belanja</span></div><div class="receipt-items">${s.items.map(p=>`<div><span>${p.name}<small>${p.detail} · 1 unit</small></span><strong>${money(p.price)}</strong></div>`).join('')}</div>${amounts()}<div class="receipt-customer">${icon('user')}${s.member?'Rina Wati · Gold member':'Pelanggan umum'}</div><p class="receipt-safe">${icon('lock')} Transaksi contoh untuk evaluasi desain</p></aside></div></div>`;
}
function success() {
 const r=s.receipts.at(-1);
 return `<section class="success-page"><div class="success-mark">${icon('check')}</div><span class="eyebrow">TRANSAKSI CONTOH SELESAI</span><h1>Pembayaran tercatat.</h1><p>${r.items.length} barang · ${r.id} · ${r.member?'Rina Wati':'Pelanggan umum'}</p><div class="success-card"><div><span>Total belanja</span><strong>${money(r.total)}</strong></div><div class="success-change"><span>Kembalian</span><strong>${money(r.change)}</strong></div><small>${r.change?'Serahkan kembalian kepada pelanggan.':'Pembayaran pas. Tidak ada kembalian.'}</small></div><div class="success-actions">${button(icon('receipt')+' Lihat struk','receipt')}${button('Transaksi berikutnya '+icon('arrow'),'next','primary')}</div><p class="simulation-note">Simulasi berhasil · tidak ada transaksi yang dikirim ke toko.</p></section>`;
}
function render() {
 document.body.dataset.version=version;
 $('#source-style').disabled=version!==0||s.stage!=='sale';
 lab();
 if(version===0&&s.stage==='sale') $('#screen').innerHTML=baseline();
 else $('#screen').innerHTML=`<div class="design-shell ${concepts[version].tone}">${header()}${s.stage==='success'?success():s.stage==='payment'?paymentPage():[null,focus,touch,guided,express,service][version]()}${footer()}</div>`;
}
function toast(msg) { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.classList.remove('show'),4200); }
function openModal(title,content,kind='') {
 priorFocus=document.activeElement;
 modalKind=kind;
 $('#dialog').innerHTML=`<div class="modal-heading"><div><span class="eyebrow">${kind==='compare'?'DESIGN LAB':'CENTRAL · PROTOTYPE'}</span><h2>${title}</h2></div>${button(icon('x'),'close','icon-only','aria-label="Tutup dialog"')}</div>${content}`;
 if(!$('#dialog').open) $('#dialog').showModal();
}
function closeModal() {$('#dialog').close();modalKind='';priorFocus?.focus();}
function productModal(p) {
 openModal('Detail barang',`<div class="detail-product"><div class="product-art">${garment(p)}</div><div><span class="eyebrow">${p.sku}</span><h2>${p.name}</h2><p>${p.detail}</p><strong>${money(p.price)}</strong></div></div><div class="info-note">Pencarian SKU hanya untuk cek harga. Barang masuk keranjang setelah tag unik terbaca.</div><div class="tag-sample"><span>Tag contoh</span><code>${p.tag}</code></div>${button(icon('scan')+' Simulasikan scan tag ini','scan-product','primary full',`data-id="${p.id}" ${s.items.some(i=>i.id===p.id)?'disabled':''}`)}${s.items.some(i=>i.id===p.id)?'<p class="simulation-note">Tag contoh ini sudah berada di keranjang.</p>':''}`,'product');
}
function startCheckout(method) {
 if(!s.items.length)return toast('Scan barang terlebih dahulu.');
 if(method)s.method=method;
 s.error='';s.stage='payment';s.step=3;render(); $('#amount')?.focus();
}
function resetBasket(seed=false) {
 const {held,receipts}=s;
 states[version]=makeState(seed);s=states[version];s.held=held;s.receipts=receipts;
}
function showReceipt() {
 const r=s.receipts.at(-1);
 if(!r)return toast('Belum ada transaksi selesai.');
 openModal('Struk contoh',`<div class="paper-receipt"><h2>central</h2><p>Bandung · Kasir 01 · Dian<br>${r.id}<br>SIMULASI — BUKAN BUKTI PEMBAYARAN</p>${r.items.map(p=>`<div><span>${p.name}<small>${p.detail}</small></span><strong>${money(p.price)}</strong></div>`).join('')}<div><span>Diskon</span><strong>−${money(r.discount)}</strong></div><div><span>Tas belanja</span><strong>${money(r.bag?3000:0)}</strong></div><div class="receipt-grand"><span>Total</span><strong>${money(r.total)}</strong></div>${r.payments.map(p=>`<div><span>${p.method}</span><strong>${money(p.amount)}</strong></div>`).join('')}<div><span>Kembalian</span><strong>${money(r.change)}</strong></div></div>`,'receipt');
}
function action(a,b) {
 switch(a) {
 case 'reset': states[version]=makeState();s=states[version];closeModal();render();toast('Versi ini kembali ke skenario awal.');break;
 case 'compare':openModal('Satu POS, enam pendekatan.',`<p class="modal-intro">Pilih cara kerja yang paling cocok untuk kasir. Setiap versi memiliki keranjang contoh sendiri.</p><div class="comparison-grid">${concepts.map((c,i)=>`<button class="comparison-card" data-version="${i}"><div class="mini-layout mini-${i}"><i></i><i></i><i></i><i></i></div><span class="eyebrow">${i===0?'BASELINE':'ALTERNATIF '+i}</span><h3>${c.name}</h3><p>${c.desc}</p><small>${c.for}</small></button>`).join('')}</div><p class="simulation-note">Baseline merekonstruksi layar kasir dari till.tsx dan CSS POS saat ini. Data, autentikasi, dan integrasi disimulasikan.</p>`,'compare');break;
 case 'close':closeModal();break;
 case 'demo':openModal('Simulasikan scan RFID',`<p class="modal-intro">Satu tag = satu barang. Tag yang sudah terbaca tidak bisa ditambahkan dua kali.</p><div class="demo-products">${products.map(p=>`<button data-action="scan-product" data-id="${p.id}" ${s.items.some(i=>i.id===p.id)?'disabled':''}><div class="product-thumb">${garment(p)}</div><span><strong>${p.name}</strong><small>${p.detail} · …${p.tag.slice(-6)}</small></span><b>${s.items.some(i=>i.id===p.id)?'Sudah dibaca':'+ Scan'}</b></button>`).join('')}</div>`,'demo');break;
 case 'scan-product': {const p=products.find(p=>p.id===b.dataset.id),err=addTag(s,p.tag);closeModal();render();toast(err||p.name+' ditambahkan · 1 tag terbaca.');break;}
 case 'product':productModal(products.find(p=>p.id===b.dataset.id));break;
 case 'category':s.category=b.dataset.category;render();break;
 case 'member':openModal('Hubungkan pelanggan',`<form data-form="member-search"><label class="input-label">Nomor member, nama, atau telepon<input id="member-search" name="member" placeholder="Coba Rina atau M00125" autocomplete="off"></label><div id="member-results"><button type="button" class="member-result" data-action="choose-member"><span class="member-avatar">RW</span><span><strong>Rina Wati</strong><small>M00125 · Gold · 1.250 poin</small></span>${icon('plus')}</button></div></form>${s.member?button('Lepaskan member dari transaksi','clear-member','quiet full'):''}<p class="simulation-note">Direktori member contoh.</p>`,'member');break;
 case 'choose-member':s.member='Rina Wati';closeModal();render();toast('Rina Wati terhubung ke transaksi.');break;
 case 'clear-member':s.member=null;closeModal();render();break;
 case 'coupon':openModal('Kupon belanja',`<p class="modal-intro">Contoh: <strong>HEMAT50K</strong> memberi potongan Rp 50.000 untuk belanja minimal Rp 300.000.</p><form data-form="coupon"><label class="input-label">Kode kupon<input name="coupon" placeholder="HEMAT50K" autocomplete="off" value="${s.coupon?'HEMAT50K':''}"></label><p id="coupon-error" class="inline-error" role="alert"></p><button class="button primary full">Terapkan kupon</button></form>${s.coupon?button('Hapus kupon','clear-coupon','quiet full'):''}`,'coupon');break;
 case 'clear-coupon':s.coupon=false;closeModal();render();break;
 case 'bag':s.bag=!s.bag;render();toast(s.bag?'Paper bag ditambahkan · Rp 3.000.':'Tas belanja dihapus.');break;
 case 'remove':s.selected=b.dataset.id;openModal('Hapus barang dari keranjang?',`<div class="info-note">Persetujuan supervisor diperlukan. Pastikan barang dikembalikan secara fisik.</div><p class="modal-intro"><strong>${esc(s.items.find(p=>p.id===s.selected).name)}</strong></p><label class="input-label">Alasan<select id="remove-reason"><option>Pelanggan batal membeli</option>Varian tidak sesuai</option>Barang rusak</option></select></label>${button('Simulasikan persetujuan supervisor','approve-remove','primary full')}`,'approval');break;
 case 'approve-remove':s.items=s.items.filter(p=>p.id!==s.selected);s.selected=null;closeModal();render();toast('Penghapusan disetujui dalam simulasi.');break;
 case 'hold':if(!s.items.length)return toast('Belum ada barang untuk disimpan.');if(s.payments.length)return toast('Selesaikan pembayaran yang sudah dicatat.');s.held.push({items:structuredClone(s.items),member:s.member,coupon:s.coupon,bag:s.bag,id:Date.now()});resetBasket();render();toast('Transaksi disimpan. Lanjutkan dari menu Tersimpan.');break;
 case 'held':openModal('Transaksi tersimpan',s.held.length?`<div class="held-list">${s.held.map((h,i)=>`<div><span><strong>${h.member||'Pelanggan umum'}</strong><small>${h.items.length} barang · ${money(totals({...h,payments:[]}).total)}</small></span>${button('Lanjutkan','resume','',`data-index="${i}"`)}</div>`).join('')}</div>`:'<div class="empty-cart"><h2>Belum ada transaksi tersimpan</h2><p>Gunakan “Simpan dulu” untuk melayani pelanggan lain.</p></div>','held');break;
 case 'resume':{const h=s.held.splice(Number(b.dataset.index),1)[0];if(s.items.length)s.held.push({items:structuredClone(s.items),member:s.member,coupon:s.coupon,bag:s.bag,id:Date.now()});Object.assign(s,h,{payments:[],stage:'sale',step:1});closeModal();render();toast('Transaksi dilanjutkan. Keranjang sebelumnya ikut disimpan.');break;}
 case 'checkout':startCheckout(b.dataset.method);break;
 case 'step':if(s.payments.length)break;if(Number(b.dataset.step)===3)startCheckout();else{s.step=Number(b.dataset.step);s.stage='sale';render();}break;
 case 'step-next':if(s.step===1){s.step=2;render();}else startCheckout();break;
 case 'step-back':s.step=1;render();break;
 case 'back':if(s.payments.length)return toast('Selesaikan pembayaran yang sudah dicatat.');s.stage='sale';s.step=version===3?2:1;render();break;
 case 'method':s.method=b.dataset.method;s.reference='';s.error='';render();break;
 case 'bank':s.bank=b.dataset.bank;render();break;
 case 'preset':s.amount=b.dataset.amount;s.error='';render();break;
 case 'key':s.amount=b.dataset.key==='⌫'?s.amount.slice(0,-1):String(Number((s.amount+b.dataset.key).slice(0,10)));render();break;
 case 'pay':{s.error=takePayment(s)||'';if(s.error){render();return;}const t=totals(s);if(t.due===0){s.receipts.push({...structuredClone(s),...t,id:'DEMO-'+String(s.receipts.length+1).padStart(4,'0'),receipts:undefined,held:undefined});s.stage='success';}if(t.due)s.stage='payment';render();if(t.due)toast('Pembayaran sebagian dicatat. Sisa '+money(t.due)+'.');break;}
 case 'next':resetBasket();render();$('#scan')?.focus();break;
 case 'receipt':showReceipt();break;
 case 'history':openModal('Riwayat simulasi',s.receipts.length?`<div class="held-list">${s.receipts.map(r=>`<div><span><strong>${r.id}</strong><small>${r.items.length} barang · ${r.member||'Pelanggan umum'}</small></span><strong>${money(r.total)}</strong></div>`).join('')}</div>${button('Lihat struk terakhir','receipt','full')}`:'<div class="empty-cart"><h2>Belum ada transaksi selesai</h2><p>Bayar keranjang contoh untuk melihat riwayat.</p></div>','history');break;
 case 'more':openModal('Alat transaksi',`<div class="more-grid">${button(icon('history')+' Riwayat','history')}${button(icon('back')+' Retur','returns')}${button(icon('x')+' Batalkan transaksi','void')}${button(icon('cash')+' Shift & kas','shift')}${button(icon('star')+' Tukar poin','points')}</div>`,'more');break;
 case 'void':if(!s.items.length)return toast('Keranjang sudah kosong.');openModal('Batalkan transaksi?',`<p class="modal-intro">${s.items.length} barang akan dikeluarkan dari keranjang. Pembatalan memerlukan persetujuan supervisor.</p>${button('Simulasikan persetujuan & batalkan','approve-void','danger full')}`,'void');break;
 case 'approve-void':resetBasket();closeModal();render();toast('Transaksi contoh dibatalkan.');break;
 case 'lock':openModal('Kasir terkunci',`<div class="locked">${icon('lock')}<h2>Dian · Kasir 01</h2><p>Keranjang tetap tersimpan selama layar terkunci.</p>${button('Buka kunci simulasi','close','primary full')}</div>`,'lock');break;
 case 'shift':openModal('Shift Dian',`<div class="shift-summary"><span>Senin, 12 Oktober 2026 · 09.00–17.00</span><h3>Kasir 01 · Central Bandung</h3><div><span>Transaksi contoh selesai</span><strong>${s.receipts.length}</strong></div><div><span>Penjualan simulasi</span><strong>${money(s.receipts.reduce((a,r)=>a+r.total,0))}</strong></div><div><span>Transaksi tersimpan</span><strong>${s.held.length}</strong></div></div><p class="info-note">Layar ini hanya ringkasan prototipe. Rekonsiliasi kas dan tutup shift tetap mengikuti aplikasi produksi.</p>`,'shift');break;
 case 'returns': case 'points':openModal(a==='returns'?'Retur barang':'Tukar poin',`<div class="info-note">${a==='returns'?'Retur adalah alur tersendiri di POS saat ini, dengan pencarian struk dan persetujuan.':'Penukaran poin adalah alur tersendiri dengan validasi member.'} Eksplorasi ini memprototipekan transaksi penjualan; alur ini belum disimulasikan.</div>${button('Kembali ke transaksi','close','primary full')}`,'scope');break;
 }
}
document.addEventListener('click',e=>{
 const v=e.target.closest('[data-version]');if(v){version=Number(v.dataset.version);s=states[version];closeModal();const url=new URL(location.href);url.searchParams.set('v',version);history.replaceState({},'',url);render();return;}
 const b=e.target.closest('[data-action]');if(b&&!b.disabled)action(b.dataset.action,b);
});
document.addEventListener('submit',e=>{
 const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();const values=new FormData(f);
 if(f.dataset.form==='coupon') {const code=String(values.get('coupon')).trim().toUpperCase();if(code!=='HEMAT50K'){if($('#coupon-error'))$('#coupon-error').textContent='Kode tidak ditemukan. Coba HEMAT50K.';else toast('Kupon tidak ditemukan. Coba HEMAT50K.');return;}s.coupon=true;closeModal();render();toast('Kupon diterapkan sesuai minimum belanja.');}
 if(f.dataset.form==='scan') {const q=String(values.get('scan')).trim();if(!q)return;if(q.toUpperCase().startsWith('E200')){const err=addTag(s,q);render();toast(err||'Tag ditambahkan ke keranjang.');$('#scan')?.focus();}else{const matches=products.filter(p=>`${p.name} ${p.sku} ${p.detail}`.toLowerCase().includes(q.toLowerCase()));if(matches.length===1)productModal(matches[0]);else if(version===2){s.search=q;render();}else openModal('Hasil cek harga',matches.length?`<div class="demo-products">${matches.map(p=>`<button data-action="product" data-id="${p.id}"><div class="product-thumb">${garment(p)}</div><span><strong>${p.name}</strong><small>${p.detail}</small></span><b>${money(p.price)}</b></button>`).join('')}</div>`:'<div class="empty-cart"><h2>Barang tidak ditemukan</h2><p>Coba “linen”, “tee”, atau SKU contoh.</p></div>','search');}}
});
document.addEventListener('input',e=>{
 if(e.target.id==='amount'){s.amount=e.target.value.replace(/\D/g,'').slice(0,10);$('#payment-feedback').innerHTML=paymentFeedback();}
 if(e.target.id==='reference')s.reference=e.target.value;
 if(e.target.id==='baseline-member')s.member=e.target.value.trim()||null;
 if(e.target.id==='scan'&&version===2){s.search=e.target.value;$('.catalogue-content').innerHTML=catalogue();}
 if(e.target.id==='member-search'){const q=e.target.value.toLowerCase();$('#member-results').innerHTML=!q||'rina wati m00125 081234567890'.includes(q)?`<button type="button" class="member-result" data-action="choose-member"><span class="member-avatar">RW</span><span><strong>Rina Wati</strong><small>M00125 · Gold · 1.250 poin</small></span>${icon('plus')}</button>`:'<p class="modal-intro">Member tidak ditemukan. Coba “Rina”.</p>';}
});
document.addEventListener('keydown',e=>{
 if($('#dialog').open)return;
 if(e.key==='F2'){e.preventDefault();$('#scan')?.focus();}
 if(e.key==='F8'&&s.stage==='sale'){e.preventDefault();startCheckout();}
 if(e.key==='F9'&&s.stage==='sale'){e.preventDefault();action('held',{});}
 if(e.key==='Escape'&&s.stage==='payment'){e.preventDefault();action('back',{});}
 if(e.key==='Enter'&&['amount','reference'].includes(e.target.id)){e.preventDefault();action('pay',{});}
});
$('#dialog').addEventListener('cancel',e=>{if(modalKind==='lock')e.preventDefault();});
render();
