/* Retail POS design prototype — one script drives the desktop and tablet shells.
   Layout, wording and flow follow pos-electron (renderer/routes/index.tsx):
   a header, a left work pane (scan · member · diskon · utilitas), a right
   transaction pane (keranjang · total · pembayaran · aksi), and payment as its
   own full page rather than a dialog.
   Stock is RFID-tagged, so a cart line counts the tags that were actually read:
   quantity is never typed up or down, units are added by a tag and removed one
   tag at a time with supervisor approval. */
const $=s=>document.querySelector(s);
const rupiah=n=>'Rp '+Math.round(n).toLocaleString('id-ID');
const number=n=>n.toLocaleString('id-ID');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
 scan:'<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 8v8M10 8v8M14 8v8M17 8v8"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 user:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
 'user-plus':'<circle cx="9" cy="8" r="3"/><path d="M2 21v-2a7 7 0 0 1 12-5M18 11v6M15 14h6"/>',
 tag:'<path d="M3 3h7l11 11-7 7L3 10z"/><circle cx="7" cy="7" r="1"/>',
 card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h3"/>',
 cash:'<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
 wallet:'<path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2Z"/><circle cx="17" cy="14" r="1"/>',
 qr:'<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 14v3M14 21h3M20 20h1v1"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
 x:'<path d="m6 6 12 12M6 18 18 6"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 minus:'<path d="M5 12h14"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 chev:'<path d="m6 9 6 6 6-6"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 hold:'<path d="M9 5v14M15 5v14"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
 print:'<path d="M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
 wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01"/>',
 receipt:'<path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2zM9 9h6M9 13h6"/>',
 return:'<path d="M9 4 4 9l5 5M4 9h9a7 7 0 0 1 0 14"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
 rfid:'<path d="M3 8a9 9 0 0 1 0 8M21 8a9 9 0 0 0 0 8M6 10a5 5 0 0 1 0 4M18 10a5 5 0 0 0 0 4"/><rect x="9" y="6" width="6" height="12" rx="2"/>',
 bag:'<path d="M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2"/>',
 box:'<path d="M3 8 12 3l9 5v8l-9 5-9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
 camera:'<path d="M3 8h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13" r="4"/>',
 store:'<path d="M4 9h16l-1 11H5ZM3 9l2-5h14l2 5M9.5 9a2.5 2.5 0 0 0 5 0"/>',
 monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6M12 17v4"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 moon:'<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
 'eye-off':'<path d="m3 3 18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 8.3C3.9 9.9 2 12 2 12s4 6 10 6c1.3 0 2.5-.3 3.6-.7"/>',
 alert:'<path d="M12 4 2 20h20ZM12 10v5M12 18h.01"/>',
 shield:'<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7zM8 12l3 3 5-6"/>',
 split:'<path d="M12 21V11M12 11 5 4M12 11l7-7M5 9V4h5M14 4h5v5"/>',
 logout:'<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
 circle:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[n]||paths.circle}</svg>`;
const garment=p=>`<span class="swatch" style="background:${p.bg};color:${p.color}"><svg viewBox="0 0 40 44" fill="none" aria-hidden="true">${p.type==='pants'?'<path d="M10 5h20l-2 34h-9l1-23-1 23h-9L10 5Z" fill="currentColor" opacity=".85"/>':'<path d="m12 5-9 7 5 9 5-3v21h14V18l5 3 5-9-9-7c-2 6-14 6-16 0Z" fill="currentColor" opacity=".85"/>'}</svg></span>`;

const PRODUCTS=[
{id:'p1',name:'Kaos Polos Hitam',sku:'SKU-TH-001',barcode:'8991234000101',variant:'Hitam · L',price:89000,cost:41000,color:'#6b7078',bg:'#eff0f2',type:'shirt',floor:14,warehouse:30},
{id:'p2',name:'Kemeja Oxford Biru',sku:'SKU-KM-002',barcode:'8991234000202',variant:'Biru · L',price:249000,cost:132000,color:'#9baec3',bg:'#edf1f6',type:'shirt',floor:8,warehouse:20},
{id:'p3',name:'Kaos Polos Putih',sku:'SKU-TH-002',barcode:'8991234000102',variant:'Putih · L',price:89000,cost:41000,color:'#c6c1b6',bg:'#f4f2ee',type:'shirt',floor:12,warehouse:24},
{id:'p4',name:'Celana Chino Khaki',sku:'SKU-CL-001',barcode:'8991234000401',variant:'Khaki · 32',price:229000,cost:139000,color:'#b7a78c',bg:'#f3f0ea',type:'pants',floor:0,warehouse:12},
{id:'p5',name:'Celana Jeans Biru',sku:'SKU-CL-002',barcode:'8991234000402',variant:'Biru · 30',price:299000,cost:171000,color:'#788da8',bg:'#edf1f6',type:'pants',floor:0,warehouse:0},
{id:'p6',name:'Kemeja Flannel Merah',sku:'SKU-KM-001',barcode:'8991234000201',variant:'Merah · M',price:199000,cost:104000,color:'#b38383',bg:'#f6eeee',type:'shirt',floor:7,warehouse:18},
{id:'p7',name:'Jaket Hoodie Abu',sku:'SKU-JK-001',barcode:'8991234000301',variant:'Abu · XL',price:279000,cost:158000,color:'#9da1a7',bg:'#eff0f2',type:'shirt',floor:5,warehouse:10},
{id:'p8',name:'Jaket Bomber Hitam',sku:'SKU-JK-002',barcode:'8991234000302',variant:'Hitam · L',price:349000,cost:201000,color:'#747980',bg:'#eff0f2',type:'shirt',floor:6,warehouse:8},
{id:'bag-free',name:'KANTONG GRATIS',sku:'BAG-FREE',barcode:'BAG-FREE',variant:'Tas belanja · gratis',price:0,cost:600,color:'#adb4be',bg:'#f3f5f8',type:'bag',floor:999,warehouse:0},
{id:'bag-paid',name:'KANTONG',sku:'BAG-PAID',barcode:'BAG-PAID',variant:'Tas belanja · berbayar',price:2000,cost:600,color:'#adb4be',bg:'#f3f5f8',type:'bag',floor:999,warehouse:0},
];
const MEMBERS=[{id:'m1',name:'Rina Wati',phone:'081234567890',points:2500,tier:'Gold',visits:14,spend:4380000},{id:'m2',name:'Budi Santoso',phone:'081234567891',points:800,tier:'Silver',visits:5,spend:1120000},{id:'m3',name:'Dewi Lestari',phone:'081234567892',points:8500,tier:'Platinum',visits:31,spend:12750000}];
const BANKS=['BCA','Mandiri','BNI','BRI'];
const METHODS={
 cash:{label:'Tunai di Kasir',icon:'cash',helper:'Gunakan nominal cepat, kembalian dihitung di panel kiri.'},
 debit:{label:'Kartu Debit',icon:'card',helper:'Pastikan bank dan nominal benar sebelum menutup struk EDC.'},
 credit:{label:'Kartu Kredit',icon:'card',helper:'Cocokkan nomor approval EDC dengan nominal yang direkam.'},
 qris:{label:'Pembayaran QRIS',icon:'qr',helper:'Tunggu konfirmasi nominal terbayar sebelum menyelesaikan.'},
};
const tablet=document.body.dataset.device==='tablet';

/* Every unit carries the tag it was read from — that is what makes a line
   countable but not editable. Barcode-entered units have no tag and stay
   flagged as manual. */
let tagSeq=4100,manualSeq=0;
const nextTag=p=>'A0'+p.barcode.replace(/\D/g,'').slice(-8).padStart(8,'0')+String(++tagSeq).padStart(14,'0');
const unitsFor=(p,n,extra={})=>Array.from({length:n},()=>({tag:nextTag(p),...extra}));
const unitLabel=u=>u.tag?u.tag:u.manual?'Tanpa tag · barang darurat':'Tanpa tag · input barcode';

const state={
 view:'sale',cart:[],member:null,memberMiss:'',coupon:null,points:0,held:[],receipts:[],
 shift:true,openingCash:500000,offline:false,rfid:true,seenTags:new Set(),stats:{raw:0,unique:0,queue:0,added:0},
 locked:false,pendingApproval:null,returnState:null,stockPending:null,unknownCode:'',
 payMethod:'cash',cash:'',payRef:'',bank:'BCA',parts:[],checkoutError:'',
 modal:null,expanded:null,showCost:false,success:null,lastReceipt:null,
};
state.cart=[{id:'p1',qty:2,units:unitsFor(PRODUCTS[0],2)},{id:'p2',qty:1,units:unitsFor(PRODUCTS[1],1)},{id:'p3',qty:1,units:unitsFor(PRODUCTS[2],1)}];
state.stats.raw=7;state.stats.unique=4;state.stats.added=4;

const product=id=>PRODUCTS.find(p=>p.id===id);
const totals=(cart=state.cart)=>{const subtotal=cart.reduce((n,l)=>n+product(l.id).price*l.qty,0);const voucher=state.coupon?Math.min(subtotal,state.coupon.percent?Math.round(subtotal*state.coupon.percent/100):state.coupon.amount):0;const discount=Math.min(subtotal,voucher+state.points*100);return{subtotal,discount,ppn:Math.round((subtotal-discount)*11/111),total:subtotal-discount,qty:cart.reduce((n,l)=>n+l.qty,0)}};
function paidAmount(){return state.parts.reduce((n,p)=>n+p.amount,0)}
function remaining(){return Math.max(0,totals().total-paidAmount())}
function changeDue(){return state.parts.filter(p=>p.method==='cash').reduce((n,p)=>n+Math.max(0,(p.tendered||p.amount)-p.amount),0)}
const methodLabel=p=>p.method==='cash'?'Tunai':p.method==='qris'?'QRIS':`${p.method==='debit'?'Debit':'Credit'} ${p.bank||''}`.trim();
const btn=(label,action,ico,extra='',cls='btn')=>`<button class="${cls}" data-action="${action}" ${extra}>${ico?icon(ico):''}${label}</button>`;
function toast(message){const el=$('#toast');if(!el)return;el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,3200)}

/* ── header, banners, status bar ───────────────────────────────────────── */
const clock=()=>new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function header(){return `<header class="topbar">
 <a class="brand" href="index.html" aria-label="POS design previews"><span class="brand-mark">r.</span>retail <span class="muted" style="font-weight:400;font-size:12px;margin-left:3px">POS</span></a>
 <nav class="top-nav" aria-label="Navigasi POS">${[['sale','Transaksi'],['history','Riwayat'],['shift','Shift kasir']].map(([v,l])=>`<button data-view="${v}" class="${state.view===v||(v==='sale'&&state.view==='payment')?'active':''}">${l}</button>`).join('')}</nav>
 <div class="top-right">
  <span class="store hide-md">${icon('bag')}<span>Pekanbaru Sudirman <span class="store-id">· POS-01 · Kasir 01</span></span></span>
  <button class="badge ${state.offline?'bad':'ok'}" data-action="connection" style="cursor:pointer" aria-label="Status koneksi">${state.offline?'Offline':'Terhubung'}</button>
  <button class="icon-btn" data-action="lock" aria-label="Kunci kasir">${icon('lock')}</button>
  <span class="avatar" title="Ahmad Fadli · kasir demo">AF</span>
 </div></header>`}
function banners(){let out='';
 if(state.offline)out+=`<div class="banner bad">${icon('alert')}<span class="grow">Backend toko tidak terhubung. Scan dan pembayaran dihentikan sampai koneksi kembali.</span>${btn('Coba lagi','toggle-offline','',' ','btn ghost')}</div>`;
 if(!state.shift)out+=`<div class="banner warn">${icon('alert')}<span class="grow">Shift kasir belum dibuka. Buka shift untuk mulai menerima transaksi.</span>${btn('Buka shift','shift-dialog','',' ','btn ghost')}</div>`;
 return out}
function footer(){return `<footer class="statusbar">
 <span><i class="dot" style="background:#5fa680"></i>${state.shift?'Shift aktif · Ahmad Fadli':'Shift belum dibuka'}</span>
 <span class="hide-sm">Scanner barcode siap</span>
 <button data-action="rfid">RFID ${state.rfid?'aktif':'standby'} · ${state.seenTags.size} tag sesi ini</button>
 <span class="right"><span class="num" id="clock">${clock()}</span><span class="hide-sm">Prototype · data contoh</span><a href="${tablet?'desktop':'tablet'}.html">${tablet?'Versi desktop':'Versi tablet'} ↗</a></span></footer>`}

/* ── left pane: scan, member, diskon, utilitas ─────────────────────────── */
function scanBlock(){const busy=state.offline||!state.shift;return `<div class="block">
 <form class="scan-row" id="scan-form">
  <div class="scan-field">${icon('scan')}<input id="scan-input" autocomplete="off" ${busy?'disabled':''} placeholder="Scan barcode / SKU, atau dekatkan tag RFID…" aria-label="Scan barcode, SKU atau tag RFID"><button class="scan-go" type="submit" aria-label="Tambahkan">${icon('arrow')}</button></div>
  <button class="scan-cam" type="button" data-action="camera" title="Scan via kamera (F6)" aria-label="Scan via kamera">${icon('camera')}</button>
 </form>
 <p class="scan-tip">Tips: ketik <kbd>3*8991234000101</kbd> untuk 3 unit · ${tablet?'ketuk ikon kamera untuk memindai':'<kbd>F6</kbd> kamera'} · RFID: <span style="color:${state.rfid&&!state.offline?'var(--success)':'var(--warning)'}">${state.offline?'reader terputus':state.rfid?'R3S connected — dekatkan tag':'R3S standby'}</span></p>
 <div class="rfid-strip"><span>Raw hit <strong class="num">${state.stats.raw}</strong></span><span>EPC unik <strong class="num">${state.stats.unique}</strong></span><span>Antrean <strong class="num">${state.stats.queue}</strong></span><span>Masuk cart <strong class="num">${state.stats.added}</strong></span></div>
</div>`}
function memberBlock(){if(state.member){const m=state.member;return `<div class="block">
 <div class="block-head"><span class="label">Member</span><button class="btn ghost" data-action="remove-member" style="min-height:26px;padding:0 8px;font-size:11px">Lepas</button></div>
 <div class="customer"><span class="avatar">${m.name.split(' ').map(w=>w[0]).join('')}</span><div class="who"><strong>${esc(m.name)}</strong><span>${esc(m.phone)} · ${m.tier}</span></div><span class="badge">${number(m.points)} poin</span></div>
 <div class="member-stats"><div><small>Poin tersedia</small><strong class="num">${number(m.points)}</strong></div><div><small>Kunjungan</small><strong class="num">${m.visits} kali</strong></div></div>
 <button class="btn" style="width:100%;margin-top:8px" data-action="points">${icon('tag')}${state.points?`${number(state.points)} poin dipakai · ${rupiah(state.points*100)}`:'Tukar poin member'}</button>
</div>`}
 return `<div class="block">
 <div class="block-head"><span class="label">Member</span><span class="muted" style="font-size:11px">Opsional</span></div>
 <form class="inline-form" id="member-form"><div class="field-wrap">${icon('user')}<input id="member-phone" type="tel" autocomplete="off" placeholder="No. HP member…" aria-label="Nomor HP member"></div><button class="btn" type="submit">Cari</button></form>
 ${state.memberMiss?`<div class="notice" style="margin-top:8px">Nomor <strong class="num">${esc(state.memberMiss)}</strong> belum terdaftar.<div style="margin-top:8px">${btn('Daftarkan member baru','register-member','user-plus')}</div></div>`:`<div class="chips">${MEMBERS.map(m=>`<button class="chip" data-member="${m.id}">${icon('user')}${esc(m.name.split(' ')[0])} · ${m.tier}</button>`).join('')}</div>`}
</div>`}
function discountBlock(){const t=totals();return `<div class="block">
 <div class="block-head"><span class="label">Diskon & voucher</span>${t.discount?`<span class="badge ok">− ${rupiah(t.discount)}</span>`:''}</div>
 ${state.coupon?`<div class="applied"><span>${icon('tag')} <strong>${esc(state.coupon.code)}</strong> ${state.coupon.percent?`· ${state.coupon.percent}%`:''}</span><button class="icon-btn" data-action="remove-coupon" aria-label="Lepas voucher">${icon('x')}</button></div>`
 :`<form class="inline-form" id="voucher-form"><div class="field-wrap"><input class="plain" id="voucher-code" autocomplete="off" placeholder="Kode voucher…" aria-label="Kode voucher"></div><button class="btn" type="submit">Terapkan</button></form>
   <div class="chips"><button class="chip" data-voucher="HEMAT50K">HEMAT50K</button><button class="chip" data-voucher="DISC10PCT">DISC10PCT</button></div>`}
</div>`}
function utility(){return `<div class="utility">
 <div class="utility-row">
  ${btn('Cari / Harga','lookup','search','','util')}
  ${btn('Kantong','bags','bag','','util')}
  ${btn('Retur','return','return','','util')}
  <button class="util" data-action="held">${icon('hold')}Ditahan${state.held.length?`<span class="count">${state.held.length}</span>`:''}</button>
 </div>
 <div class="utility-row two">
  ${btn('Kas saya','shift','wallet','','util')}
  ${btn(state.shift?'Tutup shift':'Buka shift','shift-dialog','logout','','util strong')}
 </div></div>`}

/* ── right pane: keranjang, total, pembayaran, aksi ────────────────────── */
function cartBlock(){const t=totals();
 if(!state.cart.length)return `<div class="empty">${icon('scan')}<h3>Siap untuk transaksi baru</h3><p>Scan tag RFID atau barcode. Setiap tag yang terbaca menjadi satu unit di keranjang.</p>${btn('Cari produk','lookup','search')}</div>`;
 return `<div class="cart-list no-bar">${state.cart.map(l=>{const p=product(l.id),open=state.expanded===l.id;return `<div class="cart-row">
  <div class="cart-main">
   ${garment(p)}
   <div class="cart-copy">
    <div class="cart-meta"><span class="num">${p.sku}</span>${p.type==='bag'?`<span class="flag">${p.price?'KANTONG':'KANTONG GRATIS'}</span>`:''}${l.units.some(u=>!u.tag)?`<span class="flag manual">${icon('alert')}TANPA TAG</span>`:''}${l.units.some(u=>u.gudang)?`<span class="flag gudang">${icon('box')}GUDANG</span>`:''}</div>
    <p>${esc(p.name)}</p><small>${esc(p.variant)} · ${rupiah(p.price)} / unit</small>
    ${state.showCost?`<small style="display:block">HPP ${rupiah(p.cost)} · margin ${rupiah(p.price-p.cost)} (${p.price?((p.price-p.cost)/p.price*100).toFixed(1):'0.0'}%)</small>`:''}
   </div>
   <button class="units" data-units="${l.id}" aria-expanded="${open}" title="Lihat tag per unit">${icon('rfid')}<strong class="num">${l.qty}</strong> unit ${icon('chev')}</button>
   <span class="cart-total num">${rupiah(p.price*l.qty)}</span>
   <button class="icon-btn" data-remove="${l.id}" aria-label="Hapus ${esc(p.name)} dari transaksi">${icon('x')}</button>
  </div>
  ${open?`<div class="unit-list">${l.units.map((u,i)=>`<div class="unit-line"><span class="epc num">${u.tag?esc(u.tag):unitLabel(u)}</span>${u.gudang?`<span class="badge plain">gudang</span>`:''}<button class="icon-btn" style="width:24px;height:24px" data-unit="${l.id}:${i}" title="Lepas unit ini" aria-label="Lepas unit ${i+1}">${icon('x')}</button></div>`).join('')}<p class="unit-note">Satu tag = satu barang fisik. Jumlah hanya berubah saat tag dibaca atau dilepas.</p></div>`:''}
 </div>`}).join('')}</div>`}
function cartHead(){const t=totals();return `<div class="cart-head">
 <h2>Keranjang <span class="badge plain">${t.qty} unit · ${state.cart.length} artikel</span></h2>
 <div style="display:flex;gap:2px"><button class="btn ghost" data-action="cost" style="min-height:28px;padding:0 8px;font-size:11px">${icon(state.showCost?'eye-off':'eye')}${state.showCost?'Sembunyikan HPP':'Lihat HPP'}</button><button class="icon-btn" data-action="clear" aria-label="Batalkan transaksi" ${!state.cart.length?'disabled':''}>${icon('trash')}</button></div></div>`}
function totalsBlock(){const t=totals();return `<div class="totals">
 <div class="total-line"><span class="muted">Subtotal</span><span class="num">${rupiah(t.subtotal)}</span></div>
 ${t.discount?`<div class="total-line cut"><span>Diskon${state.coupon?` (${esc(state.coupon.code)})`:''}${state.points?` + ${number(state.points)} poin`:''}</span><span class="num">− ${rupiah(t.discount)}</span></div>`:''}
 <div class="grand"><span>TOTAL</span><strong class="num">${rupiah(t.total)}</strong></div>
 <div class="total-line"><span class="muted" style="font-size:11.5px">Termasuk PPN 11%</span><span class="muted num" style="font-size:11.5px">${rupiah(t.ppn)}</span></div>
</div>`}
function paidBlock(){if(!state.parts.length)return '';return `<div class="paid-list">${state.parts.map(p=>`<div class="paid-line"><span class="method-chip">${icon(METHODS[p.method].icon)}${methodLabel(p)}</span><span class="num">${rupiah(p.amount)}</span></div>`).join('')}<div class="paid-line"><span class="muted">Sisa</span><strong class="num">${rupiah(remaining())}</strong></div></div>`}
function actionBar(){if(!state.cart.length)return '';const due=remaining(),settled=!due&&state.parts.length;return `<div class="action-bar">
 ${btn(`Batal <kbd>F8</kbd>`,'clear','x',state.parts.length?'disabled title="Transaksi dengan pembayaran tercatat tidak bisa dibatalkan"':'')}
 <button class="btn" data-action="hold-current" title="Tahan transaksi" aria-label="Tahan transaksi">${icon('hold')}</button>
 <button class="pay" data-action="pay" ${state.offline||!state.shift?'disabled':''}><span>${settled?`${icon('check')}Selesaikan transaksi`:`${icon('cash')}Bayar ${rupiah(due)}`}</span><kbd>F10</kbd></button>
</div>`}
function workspace(){return `<main class="workspace">
 <section class="pane-left">${scanBlock()}${memberBlock()}${discountBlock()}<div class="spacer"></div>${utility()}</section>
 <section class="pane-right">${cartHead()}${cartBlock()}${totalsBlock()}${paidBlock()}${actionBar()}</section>
</main>`}

/* ── payment page — the pos-electron payment mode, not a dialog ────────── */
function denominations(amount){const denoms=[100000,50000,20000,10000,5000,2000,1000,500,200,100];const out=[];let rest=Math.round(amount);
 for(const d of denoms){if(rest>=d){const count=Math.floor(rest/d);out.push([d,count]);rest-=count*d}}
 return out.length?`<div class="denoms"><span class="label">Kembalikan</span>${out.map(([d,c])=>`<div class="denom"><span>${c}× ${rupiah(d)}</span><span class="num">${rupiah(d*c)}</span></div>`).join('')}</div>`:''}
function presetValues(due){return [due,Math.ceil(due/50000)*50000,Math.ceil(due/100000)*100000,500000,1000000].filter((v,i,a)=>a.indexOf(v)===i&&v>=due).slice(0,4)}
/* Cash rounds up to the notes a customer is likely to hand over; a card or QRIS
   may never exceed the balance, so its shortcuts are the full amount and a half
   split instead. */
function presetButtons(due){const half=Math.round(due/2/1000)*1000;
 const items=state.payMethod==='cash'?presetValues(due).map(v=>[v,rupiah(v)])
  :[[due,`Lunas · ${rupiah(due)}`],...(half>0&&half<due?[[half,`Split ½ · ${rupiah(half)}`]]:[])];
 return `<div class="presets">${items.map(([v,label])=>`<button data-cash="${v}" class="${String(v)===String(state.cash)?'on':''}">${label}</button>`).join('')}</div>`}
function paymentPage(){const t=totals(),due=remaining(),settled=due===0,meta=METHODS[state.payMethod],card=['debit','credit'].includes(state.payMethod);
 return `<main class="pay-page">
 <section class="pay-main"><div class="pay-main-inner">
  <div class="method-card"><span class="method-art">${icon(meta.icon)}</span><div><strong>${meta.label}</strong><p>${meta.helper}</p></div></div>
  ${settled?`<div class="pay-done"><span class="seal">${icon('check')}</span><h3>Nominal sudah lunas</h3>
   ${changeDue()?`<p>Kembalian <strong class="num">${rupiah(changeDue())}</strong> — rincian pecahannya ada di panel kanan.</p>`:'<p>Tidak ada kembalian. Selesaikan transaksi untuk mencetak struk demo.</p>'}</div>`:`
  <div><span class="label">Metode pembayaran</span>
   <div class="method-grid" style="margin-top:8px">${Object.keys(METHODS).map(m=>`<button class="method" data-method="${m}" aria-pressed="${state.payMethod===m}">${icon(METHODS[m].icon)}${m==='qris'?'QRIS':m==='cash'?'Tunai':m==='debit'?'Debit':'Credit'}</button>`).join('')}</div></div>
  ${card?`<div><span class="label">Bank</span><div class="chips">${BANKS.map(b=>`<button class="chip ${state.bank===b?'on':''}" data-bank="${b}">${b}</button>`).join('')}</div></div>`:''}
  ${state.payMethod!=='cash'?`<label class="field">Referensi ${card?'EDC':'QRIS'}<input id="pay-reference" autocomplete="off" placeholder="Misalnya: DEMO-001" value="${esc(state.payRef)}"></label>`:''}
  <div><span class="label">Nominal</span><div class="amount-field" style="margin-top:8px"><span class="rp">Rp</span><input id="cash-amount" type="number" inputmode="numeric" min="1" step="1" value="${esc(state.cash)}" placeholder="0" aria-label="Nominal pembayaran"></div></div>
  ${state.payMethod==='cash'?`<div class="numpad">${['7','8','9','4','5','6','1','2','3','⌫','0','000'].map(k=>`<button data-digit="${k}" class="${k==='⌫'?'del':''}">${k}</button>`).join('')}</div>`:''}
  ${presetButtons(due)}`}
  <p class="error" id="payment-error" role="alert">${esc(state.checkoutError)}</p>
  <div class="pay-cta">${settled
   ?`<button class="btn primary" data-action="complete">${icon('check')}Selesaikan transaksi <kbd>Enter</kbd></button>`
   :`<button class="btn primary" data-action="tender">${icon('wallet')}Bayar <span id="tender-label" class="num">${state.cash?rupiah(Number(state.cash)||0):''}</span> <kbd>Enter</kbd></button>`}</div>
 </div></section>
 <aside class="pay-side">
  <button class="pay-back" data-action="back-to-cart">${icon('back')}Kembali ke keranjang<kbd style="margin-left:auto">Esc</kbd></button>
  <div class="pay-summary">
   <div class="total-line"><span class="muted">Item</span><span>${t.qty} unit</span></div>
   <div class="total-line"><span class="muted">Subtotal</span><span class="num">${rupiah(t.subtotal)}</span></div>
   ${t.discount?`<div class="total-line cut"><span>Diskon</span><span class="num">− ${rupiah(t.discount)}</span></div>`:''}
   <div class="grand" style="margin-top:4px"><span>TOTAL</span><strong class="num">${rupiah(t.total)}</strong></div>
  </div>
  <div class="pay-scroll no-bar">
   <span class="label">Barang</span>
   <div class="pay-items">${state.cart.map(l=>{const p=product(l.id);return `<div class="pay-item"><span><strong class="num">${l.qty}×</strong> ${esc(p.name)}</span><span class="num">${rupiah(p.price*l.qty)}</span></div>`}).join('')}</div>
   <span class="label" style="margin-top:4px">Pembayaran</span>
   ${state.parts.length?state.parts.map(p=>`<div class="recorded"><span>${icon('check')}${methodLabel(p)}${p.ref?`<small class="muted">${esc(p.ref)}</small>`:''}</span><strong class="num">${rupiah(p.amount)}</strong></div>`).join(''):'<p class="muted" style="font-size:12px;padding:6px 0">Belum ada pembayaran.</p>'}
   ${!settled&&state.parts.length?'<p class="split-hint">← Boleh ganti metode untuk membayar sisa</p>':''}
  </div>
  <div class="pay-due ${settled?'settled':''}">
   ${settled?`<div class="due-line change"><span>Kembalian</span><strong class="num">${rupiah(changeDue())}</strong></div>${changeDue()?denominations(changeDue()):''}`
   :`<div class="due-line rest"><span>Sisa</span><strong class="num">${rupiah(due)}</strong></div>`}
  </div>
 </aside>
</main>`}

/* ── riwayat & shift ──────────────────────────────────────────────────── */
function historyView(){const total=state.receipts.reduce((n,r)=>n+r.total,0);return `<main class="page"><div class="page-inner">
 <div class="page-head"><div><span class="label">Kasir / riwayat</span><h1>Riwayat transaksi</h1><p>Transaksi demo pada sesi ini.</p></div>${btn('Kembali ke kasir','sale','back')}</div>
 <div class="stats"><div class="stat"><small>Transaksi selesai</small><strong class="num">${state.receipts.length}</strong></div><div class="stat"><small>Total penjualan</small><strong class="num">${rupiah(total)}</strong></div><div class="stat"><small>Transaksi ditahan</small><strong class="num">${state.held.length}</strong></div></div>
 ${state.receipts.length?`<div class="rows">${state.receipts.map(r=>`<button class="row-item" data-receipt="${r.id}"><div class="grow"><h3 class="num">${r.id}</h3><p>${r.time} · ${r.qty} unit · ${r.member?esc(r.member.name):'Pelanggan umum'}</p></div><strong class="num">${rupiah(r.total)}</strong>${icon('arrow')}</button>`).join('')}</div>`:`<div class="empty">${icon('receipt')}<h3>Belum ada transaksi</h3><p>Selesaikan pembayaran demo untuk melihat struknya di sini.</p></div>`}
</div></main>`}
function shiftView(){const cash=state.receipts.reduce((n,r)=>n+r.payments.filter(p=>p.method==='cash').reduce((s,p)=>s+p.amount,0),0);return `<main class="page"><div class="page-inner">
 <div class="page-head"><div><span class="label">Kasir / shift</span><h1>Kas &amp; shift kasir</h1><p>Ahmad Fadli · Pekanbaru Sudirman · POS-01</p></div>${btn('Kembali ke kasir','sale','back')}</div>
 <div class="stats"><div class="stat"><small>Modal awal kas</small><strong class="num">${rupiah(state.openingCash)}</strong></div><div class="stat"><small>Tunai diterima</small><strong class="num">${rupiah(cash)}</strong></div><div class="stat"><small>Kas seharusnya</small><strong class="num">${rupiah(state.openingCash+cash)}</strong></div></div>
 <div><div class="kv"><span class="muted">Status shift</span><span class="badge ${state.shift?'ok':'warn'}">${state.shift?'Aktif':'Ditutup'}</span></div><div class="kv"><span class="muted">Transaksi selesai</span><span class="num">${state.receipts.length}</span></div><div class="kv"><span class="muted">Transaksi ditahan</span><span class="num">${state.held.length}</span></div><div class="kv"><span class="muted">Tag RFID terbaca</span><span class="num">${state.seenTags.size}</span></div></div>
 <div style="display:flex;gap:8px">${btn(state.shift?'Tutup shift':'Buka shift','shift-dialog','logout')}${btn('Status koneksi & perangkat','connection','wifi')}</div>
</div></main>`}

/* ── overlays: sukses & kunci ──────────────────────────────────────────── */
function overlays(){let out='';
 if(state.success){const s=state.success;out+=`<div class="overlay" data-action="dismiss-success"><div class="overlay-card">
  <span class="seal">${icon('check')}</span><h3>Transaksi selesai</h3>
  <p class="overlay-total num">${rupiah(s.total)}</p>
  ${s.change?`<div class="overlay-change"><small>Kembalian</small><strong class="num">${rupiah(s.change)}</strong></div>`:''}
  ${s.points?`<p class="muted" style="font-size:12.5px">+${number(s.points)} poin diperoleh</p>`:''}
  <button class="btn" style="width:100%" data-action="print">${icon('print')}Lihat / cetak struk</button>
  <p class="muted" style="font-size:11.5px">Scan barang berikutnya, atau tutup panel ini.</p>
 </div></div>`}
 if(state.locked)out+=`<div class="overlay"><div class="overlay-card">
  <span class="seal">${icon('lock')}</span><h3>Kasir terkunci</h3>
  <p class="muted" style="font-size:12.5px">Ahmad Fadli · POS-01. Di aplikasi, buka dengan PIN atau sidik jari kasir.</p>
  ${btn('Simulasikan buka kunci','unlock','','','btn primary')}
 </div></div>`;
 return out}

function render(){
 const focus=document.activeElement?.id;
 $('#app').dataset.screen=state.view;
 $('#app').innerHTML=header()+banners()+(state.view==='payment'?paymentPage():state.view==='history'?historyView():state.view==='shift'?shiftView():workspace())+footer()+overlays();
 const next=focus&&$('#'+focus)?focus:state.view==='payment'&&remaining()?'cash-amount':state.view==='sale'?'scan-input':null;
 if(next){const el=$('#'+next);el?.focus?.();if(next==='cash-amount')el?.select?.()}
}

/* ── modals ───────────────────────────────────────────────────────────── */
function showModal(title,sub,body,foot,width){const dlg=$('#modal');if(width)dlg.style.width=width;else dlg.style.width='';
 dlg.innerHTML=`<header class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${sub}</p></div><button class="icon-btn" data-action="close" aria-label="Tutup">${icon('x')}</button></header><div class="modal-content">${body}</div><footer class="modal-foot">${foot||btn('Tutup','close')}</footer>`;
 dlg.setAttribute('aria-labelledby','modal-title');if(!dlg.open)dlg.showModal()}
function closeModal(){if(state.locked){toast('Buka kunci kasir terlebih dahulu');return}const dlg=$('#modal');if(dlg.open)dlg.close();state.modal=null}
function stockLabel(p){return p.floor>0?`<span class="badge ok">Display ${p.floor}</span>`:p.warehouse>0?`<span class="badge warn">Gudang ${p.warehouse}</span>`:'<span class="badge bad">Stok habis</span>'}
function lookupRows(q=''){const rows=PRODUCTS.filter(p=>`${p.name} ${p.sku} ${p.barcode} ${p.variant}`.toLowerCase().includes(q.toLowerCase()));
 return rows.length?rows.map(p=>`<button class="pick" data-add="${p.id}" ${p.floor<1&&p.warehouse<1?'disabled':''}>${garment(p)}<div class="grow"><strong>${esc(p.name)}</strong><small>${esc(p.variant)} · ${esc(p.sku)}</small></div>${stockLabel(p)}<strong class="num">${rupiah(p.price)}</strong></button>`).join(''):'<p class="muted">Produk tidak ditemukan.</p>'}
function lookup(q=''){state.modal='lookup';showModal('Cari produk & harga','Cari berdasarkan nama, SKU, atau barcode.',`<label class="field">Nama / kode produk<input id="lookup-query" type="search" autocomplete="off" placeholder="Misalnya: Oxford, SKU-KM-002…" value="${esc(q)}"></label><div class="pick-list" id="lookup-results">${lookupRows(q)}</div>`,`${btn('Kembali','close')}<span class="muted" style="font-size:11px">${PRODUCTS.length} produk contoh</span>`);$('#lookup-query')?.focus?.()}
function bags(){state.modal='bags';showModal('Tambahkan kantong','Kantong dicatat sebagai baris tersendiri, tanpa tag RFID.',`<div class="pick-list">${PRODUCTS.filter(p=>p.type==='bag').map(p=>`<button class="pick" data-add="${p.id}">${garment(p)}<div class="grow"><strong>${esc(p.name)}</strong><small>${esc(p.variant)}</small></div><strong class="num">${rupiah(p.price)}</strong></button>`).join('')}</div>`,btn('Kembali','close'),'480px')}
function points(){if(!state.member)return;state.modal='points';showModal('Tukar poin member',`${number(state.member.points)} poin tersedia · 1 poin = Rp 100`,`<label class="field">Jumlah poin<input id="points-value" type="number" min="100" step="100" placeholder="100" value="${state.points||''}"></label><div class="notice">Minimal 100 poin, kelipatan 100, maksimal 50% dari subtotal.</div><p class="error" id="points-error"></p>`,`${btn('Batal','close')}<span class="right">${state.points?btn('Lepas poin','remove-points'):''}${btn('Terapkan poin','apply-points','check','','btn primary')}</span>`,'480px');$('#points-value')?.focus?.()}
function held(){state.modal='held';showModal('Transaksi ditahan','Parkir keranjang sementara, lanjutkan saat pelanggan kembali.',
 state.held.length?`<div class="rows">${state.held.map((h,i)=>`<div class="row-item"><div class="grow"><h3>${h.member?esc(h.member.name):'Pelanggan umum'}</h3><p>${h.cart.reduce((n,l)=>n+l.qty,0)} unit · ditahan ${h.time}</p></div><button class="btn" data-resume="${i}" ${state.cart.length?'disabled':''}>Lanjutkan</button></div>`).join('')}</div>${state.cart.length?'<p class="muted" style="font-size:12px">Tahan atau kosongkan transaksi aktif sebelum melanjutkan keranjang lain.</p>':''}`
 :`<div class="empty">${icon('hold')}<h3>Belum ada transaksi ditahan</h3><p>Tekan ikon tahan di bar aksi untuk memarkir keranjang.</p></div>`,
 `${btn('Kembali','close')}<span class="right">${btn('Tahan transaksi ini','hold-current','hold',!state.cart.length?'disabled':'','btn primary')}</span>`)}
function rfid(){state.modal='rfid';showModal('RFID reader','Simulasi pembacaan tag — perangkat fisik tidak diakses.',
 `<div class="kv"><span class="muted">Status reader</span><span class="badge ${state.rfid?'ok':''}">${state.rfid?'Aktif':'Standby'}</span></div>
  <div class="kv"><span class="muted">Tag unik sesi ini</span><strong class="num">${state.seenTags.size}</strong></div>
  <div class="kv"><span class="muted">Masuk keranjang</span><strong class="num">${state.stats.added}</strong></div>
  <div class="notice">Satu tag mewakili satu barang fisik. Tag yang sama tidak pernah dihitung dua kali, dan jumlah tidak bisa dinaikkan tanpa tag baru.</div>`,
 `${btn(state.rfid?'Hentikan reader':'Aktifkan reader','toggle-rfid')}<span class="right">${btn('Simulasikan 2 tag','demo-rfid','rfid',!state.rfid?'disabled':'','btn primary')}</span>`,'520px')}
function connection(){state.modal='connection';showModal('Koneksi & perangkat','Status contoh untuk memeriksa pengalaman online dan offline.',
 `<div class="kv"><span class="muted">Server toko (edge)</span><span class="badge ${state.offline?'bad':'ok'}">${state.offline?'Terputus':'Terhubung · 12ms'}</span></div>
  <div class="kv"><span class="muted">Cloud sync</span><span class="badge ${state.offline?'warn':'ok'}">${state.offline?'Antre':'Sinkron'}</span></div>
  <div class="kv"><span class="muted">Scanner barcode</span><span>Siap</span></div>
  <div class="kv"><span class="muted">RFID reader R3S</span><span>${state.rfid?'Aktif':'Standby'}</span></div>
  <div class="notice">Data prototype hanya hidup di sesi ini. Tidak ada yang dikirim ke server.</div>`,
 `${btn('Tutup','close')}<span class="right">${btn(`Simulasikan ${state.offline?'online':'offline'}`,'toggle-offline','wifi')}</span>`,'520px')}
function shiftDialog(){state.modal='shift';const expected=state.openingCash+state.receipts.reduce((n,r)=>n+r.payments.filter(p=>p.method==='cash').reduce((s,p)=>s+p.amount,0),0);
 showModal(state.shift?'Tutup shift kasir':'Buka shift kasir',state.shift?'Hitung uang fisik di laci sebelum menutup shift.':'Masukkan modal awal sebelum menerima transaksi.',
 `${state.shift?`<div class="kv"><span class="muted">Kas seharusnya</span><strong class="num">${rupiah(expected)}</strong></div>`:''}
  <label class="field">${state.shift?'Kas terhitung':'Modal awal'}<input id="shift-cash" type="number" min="0" step="1" placeholder="Masukkan hasil hitung fisik"></label>
  <p class="error" id="shift-error"></p>
  ${state.shift&&state.cart.length?'<div class="notice warn">Selesaikan keranjang aktif dulu. Transaksi ditahan akan dibatalkan saat shift ditutup.</div>':''}`,
 `${btn('Kembali','close')}<span class="right">${btn(state.shift?'Tutup shift':'Buka shift','confirm-shift','check',state.shift&&state.cart.length?'disabled':'','btn primary')}</span>`,'520px');$('#shift-cash')?.focus?.()}
function receipt(r){state.modal='receipt';state.lastReceipt=r;
 showModal('Detail transaksi',`${r.id} · ${r.time} · data simulasi`,
 `<div class="receipt-lines">${r.cart.map(l=>`<div class="receipt-line"><span>${esc(product(l.id).name)} × ${l.qty}</span><strong class="num">${rupiah(product(l.id).price*l.qty)}</strong></div>`).join('')}
  <div class="divider"></div>
  ${r.discount?`<div class="receipt-line"><span>Diskon</span><strong class="num">− ${rupiah(r.discount)}</strong></div>`:''}
  <div class="receipt-line"><strong>Total</strong><strong class="num">${rupiah(r.total)}</strong></div>
  ${r.payments.map(p=>`<div class="receipt-line"><span>${methodLabel(p)}${p.ref?' · '+esc(p.ref):''}</span><span class="num">${rupiah(p.amount)}</span></div>`).join('')}
  <div class="receipt-line"><span>Kembalian</span><strong class="num">${rupiah(r.change)}</strong></div></div>`,
 `${btn('Preview struk','print','print')}<span class="right">${btn('Tutup','close','','','btn primary')}</span>`)}
function approve(reason,fn){state.pendingApproval=fn;state.modal='approval';
 showModal('Persetujuan supervisor',esc(reason),
 `<div class="empty" style="padding:18px 0">${icon('shield')}<p>Di aplikasi, tindakan ini meminta PIN atau sidik jari supervisor. Tombol di bawah hanya mensimulasikan persetujuan.</p></div>`,
 `${btn('Batal','close')}<span class="right">${btn('Simulasikan persetujuan','approve-demo','shield','','btn primary')}</span>`,'500px')}
function unknownSKU(sku){state.unknownCode=sku;state.modal='unknown';
 showModal('SKU belum terdaftar',esc(sku)+' · pencatatan barang darurat',
 `<label class="field">Nama barang<input id="unknown-name" placeholder="Nama barang"></label><label class="field">Harga jual<input id="unknown-price" type="number" min="1"></label><label class="field">Kategori<input id="unknown-category" placeholder="Contoh: Apparel"></label><p class="error" id="unknown-error"></p><div class="notice">Unit ini masuk tanpa tag RFID dan ditandai <strong>MANUAL</strong>. Perlu persetujuan supervisor.</div>`,
 `${btn('Batal','close')}<span class="right">${btn('Minta persetujuan','unknown-save','shield','','btn primary')}</span>`,'520px')}
function cameraScan(){state.modal='camera';showModal('Pindai dengan kamera','Simulasi kamera · perangkat tidak diakses.',
 `<div class="empty">${icon('camera')}<h3>Letakkan barcode di dalam bingkai</h3><p>Gunakan barang contoh untuk mencoba alurnya.</p></div>`,
 `${btn('Batal','close')}<span class="right">${btn('Pindai barang contoh','camera-demo','scan','','btn primary')}</span>`,'520px')}
function returnFlow(step=1){if(state.offline)return toast('Retur memerlukan koneksi server');
 state.modal='return';const r=state.returnState||{step:1};state.returnState=r;r.step=step;
 const titles=['Cari transaksi','Pilih barang retur','Barang pengganti','Ringkasan penukaran'];
 let body=`<div class="steps">${titles.map((t,i)=>`<span class="${i+1===step?'active':''}">${i+1}. ${t}</span>`).join('')}</div>`;
 if(step===1)body+=`<label class="field">Nomor transaksi / SKU / tag RFID<input id="return-code" placeholder="DEMO-0001"></label><div class="notice">Kosongkan isian untuk memuat <strong>CONTOH-001</strong>, transaksi contoh tanpa diskon.</div>`;
 if(step===2)body+=`<div class="kv"><span>Kaos Polos Hitam L · 1 unit · ${esc(r.code)}</span><strong class="num">${rupiah(89000)}</strong></div><label class="field">Alasan<select id="return-reason"><option>Ukuran tidak sesuai</option><option>Produk cacat</option><option>Salah barang</option></select></label><label class="field">Tujuan barang<select id="return-dest"><option>Gudang toko</option><option>Floor display</option><option>Barang reject</option></select></label>`;
 if(step===3)body+=`<label class="field">Barang pengganti<select id="return-product">${PRODUCTS.filter(p=>p.floor>0&&p.type!=='bag').map(p=>`<option value="${p.id}">${p.name} — ${rupiah(p.price)}</option>`).join('')}</select></label><div class="notice">Contoh alur penukaran 1 unit. Selisih negatif hangus sesuai kebijakan contoh.</div>`;
 if(step===4){const diff=product(r.replacement).price-89000;body+=`<div class="receipt-lines"><div class="receipt-line"><span>Barang kembali</span><strong>Kaos Polos Hitam L</strong></div><div class="receipt-line"><span>Pengganti</span><strong>${esc(product(r.replacement).name)}</strong></div><div class="receipt-line"><span>Tujuan</span><strong>${esc(r.dest)}</strong></div><div class="receipt-line"><span>${diff>=0?'Tambahan pembayaran':'Selisih hangus'}</span><strong class="num">${rupiah(Math.abs(diff))}</strong></div></div>${diff>0?'<label class="field">Metode top-up<select id="return-method"><option>Tunai</option><option>Debit · BCA</option><option>Credit · Mandiri</option><option>QRIS</option></select></label>':''}<div class="notice">Penukaran via barcode / SKU perlu persetujuan supervisor. Simulasi, tanpa refund nyata.</div>`}
 showModal('Retur & penukaran',titles[step-1],body,`${btn('Batal','close')}<span class="right">${btn(step===4?'Konfirmasi penukaran':'Lanjutkan','return-next','arrow','','btn primary')}</span>`,'720px')}

/* ── keranjang: unit masuk & keluar ────────────────────────────────────── */
function dropDiscounts(reason){if(state.coupon||state.points){state.coupon=null;state.points=0;toast(reason)}}
function addUnits(id,qty,extra={}){const line=state.cart.find(l=>l.id===id);
 const units=extra.tags?extra.tags.map(tag=>({tag,...extra.flags}))
  :Array.from({length:qty},()=>({tag:null,manual:!!extra.manual,seq:++manualSeq,...extra.flags}));
 if(line){line.units.push(...units);line.qty=line.units.length}else state.cart.push({id,qty:units.length,units});
 state.stats.added+=units.length}
function addProduct(id,qty=1,extra={}){if(state.offline){toast('Server offline. Penambahan barang diblokir.');return}
 if(!state.shift){toast('Buka shift kasir terlebih dahulu.');return}
 dropDiscounts('Diskon dilepas setelah keranjang berubah. Terapkan kembali.');
 addUnits(id,qty,extra);render();toast(`${product(id).name} · ${qty} unit ditambahkan`)}
function stockAdd(id,qty=1,extra={}){if(state.offline||!state.shift){toast('Pastikan server online dan shift aktif');return}
 const p=product(id);
 if(p.floor>0||p.type==='bag'){addProduct(id,qty,extra);return}
 if(p.warehouse>0){state.stockPending={id,qty};state.modal='gudang';
  showModal('Barang ada di gudang',esc(p.name),`<div class="notice warn">Display kosong, gudang menyimpan ${p.warehouse} unit. Pindahkan ke display, atau minta persetujuan supervisor untuk mengambil langsung.</div>`,
  `${btn('Batal','close')}<span class="right">${btn('Ambil dari gudang','warehouse-approve','shield')}${btn('Pindahkan ke display','move-stock','box','','btn primary')}</span>`,'560px');return}
 state.modal='soldout';showModal('Stok barang habis',esc(p.name),'<div class="notice warn">Display dan gudang kosong. Barang tidak dapat dijual.</div>',btn('Mengerti','close'),'480px')}
function changeQuantity(id,delta){const l=state.cart.find(l=>l.id===id);if(!l)return;
 if(delta<0)l.units.splice(delta,-delta);else addUnits(id,delta);
 l.qty=l.units.length;if(l.qty<=0)state.cart=state.cart.filter(x=>x.id!==id);
 if(state.expanded===id&&!state.cart.some(x=>x.id===id))state.expanded=null;
 dropDiscounts('Diskon dilepas setelah keranjang berubah.');render()}
function dropUnit(id,index){const l=state.cart.find(l=>l.id===id);if(!l)return;
 const[unit]=l.units.splice(index,1);l.qty=l.units.length;if(unit?.tag)state.seenTags.delete(unit.tag);
 if(!l.qty){state.cart=state.cart.filter(x=>x.id!==id);if(state.expanded===id)state.expanded=null}
 dropDiscounts('Diskon dilepas setelah keranjang berubah.');render();toast('Unit dilepas dari transaksi')}

/* ── pembayaran ───────────────────────────────────────────────────────── */
function paymentInput(){state.cash=$('#cash-amount')?.value||state.cash;state.payRef=$('#pay-reference')?.value||state.payRef;return Number(state.cash)}
function validateTender(part=false){const amount=paymentInput(),due=remaining();
 if(!due)return{amount:0,tendered:0};
 if(!Number.isSafeInteger(amount)||amount<=0){state.checkoutError='Masukkan nominal pembayaran yang valid.';return null}
 if(state.payMethod!=='cash'&&state.payRef.trim().length<4){state.checkoutError='Masukkan referensi pembayaran, minimal 4 karakter.';return null}
 if(part&&amount>=due){state.checkoutError='Nominal split harus lebih kecil dari sisa pembayaran.';return null}
 if(!part&&amount<due){state.checkoutError='Nominal belum cukup untuk melunasi sisa.';return null}
 if(state.payMethod!=='cash'&&amount>due){state.checkoutError='Nominal kartu / QRIS tidak boleh melebihi sisa pembayaran.';return null}
 state.checkoutError='';
 return{method:state.payMethod,bank:['debit','credit'].includes(state.payMethod)?state.bank:null,amount:part?amount:due,tendered:amount,ref:state.payRef}}
function recordTender(){const due=remaining();if(!due)return;
 const part=paymentInput()<due,tender=validateTender(part);
 if(!tender){render();return}
 state.parts.push(tender);state.payRef='';state.cash=remaining()?String(remaining()):'';state.checkoutError='';
 render();toast(remaining()?`${methodLabel(tender)} ${rupiah(tender.amount)} tercatat · sisa ${rupiah(remaining())}`:'Nominal lunas. Selesaikan transaksi.')}
function complete(){const tender=validateTender();if(!tender){render();return}
 const t=totals(),payments=[...state.parts,...(tender.amount?[tender]:[])];
 const change=payments.filter(p=>p.method==='cash').reduce((n,p)=>n+Math.max(0,(p.tendered||p.amount)-p.amount),0);
 const earned=state.member?Math.floor(t.total/10000):0;
 const record={id:'DEMO-'+String(state.receipts.length+1).padStart(4,'0'),time:new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),
  cart:state.cart.map(l=>({...l,units:l.units.map(u=>({...u}))})),member:state.member?{...state.member}:null,...t,payments,change,points:earned,returned:[]};
 state.receipts.unshift(record);state.lastReceipt=record;
 if(state.member)state.member.points=Math.max(0,state.member.points-state.points)+earned;
 state.cart=[];state.member=null;state.memberMiss='';state.coupon=null;state.points=0;state.parts=[];state.cash='';state.payRef='';state.expanded=null;
 state.seenTags.clear();state.view='sale';state.success={total:record.total,change,points:earned,id:record.id};
 render();setTimeout(()=>{if(state.success&&state.success.id===record.id){state.success=null;render()}},7000)}

/* ── actions ──────────────────────────────────────────────────────────── */
const actions={
 close:closeModal,lookup:()=>lookup(),bags,points,held,rfid,connection,camera:cameraScan,
 sale:()=>{closeModal();state.view='sale';render()},
 history:()=>{closeModal();state.view='history';render()},
 shift:()=>{closeModal();state.view='shift';render()},
 'shift-dialog':shiftDialog,return:()=>{state.returnState=null;returnFlow()},
 lock:()=>{state.locked=true;render()},unlock:()=>{state.locked=false;render()},
 cost:()=>{if(state.showCost){state.showCost=false;render();return}approve('Tampilkan HPP dan margin item',()=>{state.showCost=true;render()})},
 pay:()=>{if(!state.cart.length||!state.shift||state.offline)return;
  state.checkoutError='';state.cash=String(remaining());state.view='payment';render()},
 'back-to-cart':()=>{state.view='sale';state.checkoutError='';render()},
 tender:recordTender,complete,
 'remove-member':()=>{state.member=null;state.points=0;state.memberMiss='';closeModal();render()},
 'register-member':()=>{state.modal='register';const phone=state.memberMiss;
  showModal('Daftarkan member baru',`Nomor ${esc(phone)} · data contoh`,`<label class="field">Nama lengkap<input id="new-member-name" placeholder="Nama pelanggan"></label><p class="error" id="new-member-error"></p><div class="notice">Member baru hanya tersimpan di sesi prototype ini.</div>`,`${btn('Batal','close')}<span class="right">${btn('Daftarkan','save-member','user-plus','','btn primary')}</span>`,'480px');$('#new-member-name')?.focus?.()},
 'save-member':()=>{const name=$('#new-member-name').value.trim();if(!name){$('#new-member-error').textContent='Isi nama pelanggan.';return}
  const m={id:'m'+(MEMBERS.length+1),name,phone:state.memberMiss,points:0,tier:'Silver',visits:0,spend:0};MEMBERS.push(m);state.member=m;state.memberMiss='';closeModal();render();toast('Member baru terdaftar')},
 'apply-points':()=>{const n=Number($('#points-value').value);
  if(!Number.isSafeInteger(n)||n<100||n%100||n>state.member.points||n*100>totals().subtotal*.5){$('#points-error').textContent='Jumlah poin melebihi batas atau bukan kelipatan 100.';return}
  state.points=n;closeModal();render();toast(`${number(n)} poin ditukar`)},
 'remove-points':()=>{state.points=0;closeModal();render()},
 'remove-coupon':()=>{state.coupon=null;render()},
 clear:()=>{if(state.parts.length)return toast('Transaksi dengan pembayaran tercatat tidak dapat dibatalkan');
  if(!state.cart.length)return;state.modal='cancel';
  showModal('Batalkan transaksi','Seluruh unit, member, dan voucher dilepas dari transaksi ini.',
  `<div class="kv"><span>${totals().qty} unit</span><strong class="num">${rupiah(totals().total)}</strong></div><label class="field">Alasan<select id="cancel-reason"><option>Pelanggan batal</option><option>Kesalahan input</option><option>Barang tidak tersedia</option><option>Harga tidak sesuai</option></select></label>`,
  `${btn('Kembali','close')}<span class="right">${btn('Batalkan transaksi','confirm-clear','trash','','btn danger')}</span>`,'500px')},
 'confirm-clear':()=>{state.cart=[];state.member=null;state.coupon=null;state.points=0;state.expanded=null;state.seenTags.clear();closeModal();render();toast('Transaksi dibatalkan')},
 'hold-current':()=>{if(!state.cart.length)return;
  state.held.push({cart:state.cart.map(l=>({...l,units:l.units.map(u=>({...u}))})),member:state.member,coupon:state.coupon,points:state.points,time:new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})});
  state.cart=[];state.member=null;state.coupon=null;state.points=0;state.expanded=null;state.seenTags.clear();closeModal();render();toast('Transaksi ditahan')},
 'toggle-rfid':()=>{state.rfid=!state.rfid;render();rfid()},
 'demo-rfid':()=>{if(state.offline||!state.rfid)return toast('Reader memerlukan koneksi aktif');
  let added=0;[['A03400010100000000004201','p1'],['A03400020100000000004202','p6']].forEach(([tag,id])=>{
   state.stats.raw++;
   if(state.seenTags.has(tag))return;
   state.seenTags.add(tag);state.stats.unique++;
   dropDiscounts('Diskon dilepas setelah keranjang berubah.');
   addUnits(id,1,{tags:[tag]});added++});
  render();rfid();toast(added?`${added} tag unik ditambahkan`:'Tag duplikat diabaikan')},
 'toggle-offline':()=>{state.offline=!state.offline;closeModal();render()},
 'confirm-shift':()=>{const raw=$('#shift-cash').value,n=Number(raw);
  if(raw===''||!Number.isSafeInteger(n)||n<0){$('#shift-error').textContent='Masukkan nominal kas yang valid.';return}
  if(state.shift){const expected=state.openingCash+state.receipts.reduce((sum,r)=>sum+r.payments.filter(p=>p.method==='cash').reduce((s,p)=>s+p.amount,0),0);
   if(n!==expected){$('#shift-error').textContent=`Selisih ${rupiah(Math.abs(n-expected))}. Perlu rekonsiliasi supervisor. Shift tetap aktif.`;return}
   state.shift=false;state.held=[]}
  else{state.shift=true;state.openingCash=n}
  closeModal();render();toast(state.shift?'Shift kasir dibuka':'Shift kasir ditutup')},
 'approve-demo':()=>{const fn=state.pendingApproval;state.pendingApproval=null;closeModal();fn?.();toast('Persetujuan supervisor disimulasikan')},
 'move-stock':()=>{const{id,qty}=state.stockPending;const p=product(id);p.floor+=qty;p.warehouse-=Math.min(qty,p.warehouse);closeModal();addProduct(id,qty)},
 'warehouse-approve':()=>approve('Pengambilan stok langsung dari gudang',()=>addProduct(state.stockPending.id,state.stockPending.qty,{flags:{gudang:true}})),
 'unknown-save':()=>{const name=$('#unknown-name').value.trim(),price=Number($('#unknown-price').value),category=$('#unknown-category').value.trim();
  if(!name||!category||!Number.isSafeInteger(price)||price<=0){$('#unknown-error').textContent='Isi nama, kategori, dan harga yang valid.';return}
  approve('Buat barang darurat tanpa tag RFID',()=>{const id='custom-'+PRODUCTS.length;
   PRODUCTS.push({id,name,price,cost:0,sku:state.unknownCode,barcode:state.unknownCode,variant:category,color:'#9aa1ad',bg:'#eef0f4',type:'shirt',floor:1,warehouse:0});
   addProduct(id,1,{manual:true})})},
 'camera-demo':()=>{closeModal();stockAdd('p1')},
 'dismiss-success':()=>{state.success=null;render()},
 print:()=>{const r=state.lastReceipt;if(!r)return toast('Belum ada struk untuk dicetak');state.success=null;state.modal='print';
  showModal('Preview struk',`${r.id} · struk demo`,
  `<div class="slip"><div style="text-align:center;line-height:1.8"><strong style="font-size:18px;font-family:var(--serif)">RETAIL</strong><br>Pekanbaru Sudirman · POS-01<br>${r.id} · ${r.time}<br>DATA CONTOH — BUKAN BUKTI BAYAR</div><div class="divider"></div>
   ${r.cart.map(l=>`<div class="receipt-line"><span>${esc(product(l.id).name)}<br>${l.qty} × ${rupiah(product(l.id).price)}</span><strong>${rupiah(l.qty*product(l.id).price)}</strong></div>`).join('')}
   <div class="divider"></div><div class="receipt-line"><strong>TOTAL</strong><strong>${rupiah(r.total)}</strong></div>
   ${r.payments.map(p=>`<div class="receipt-line"><span>${methodLabel(p)}</span><span>${rupiah(p.amount)}</span></div>`).join('')}
   <div class="receipt-line"><span>Kembalian</span><span>${rupiah(r.change)}</span></div>
   <p style="text-align:center;margin-top:22px">Terima kasih sudah berbelanja.</p></div>`,
  btn('Selesai','close'),'480px');render()},
 'return-next':()=>{const r=state.returnState;
  if(r.step===1){r.code=$('#return-code').value.trim()||'CONTOH-001';
   const sale=state.receipts.find(s=>s.id===r.code);
   if(sale?.discount)return toast('Transaksi berdiskon tidak memenuhi kebijakan retur contoh');
   if(r.code!=='CONTOH-001')return toast('Demo penukaran memakai CONTOH-001. Kosongkan isian untuk memuatnya.');
   returnFlow(2)}
  else if(r.step===2){r.reason=$('#return-reason').value;r.dest=$('#return-dest').value;returnFlow(3)}
  else if(r.step===3){r.replacement=$('#return-product').value;returnFlow(4)}
  else approve('Konfirmasi penukaran via barcode / SKU',()=>{state.returnState=null;
   showModal('Penukaran selesai','Simulasi berhasil dicatat.',`<div class="empty">${icon('check')}<h3>Barang berhasil ditukar</h3><p>Tidak ada stok atau pembayaran nyata yang diubah.</p></div>`,btn('Selesai','close'),'480px')})},
};

/* ── events ───────────────────────────────────────────────────────────── */
function updateTenderHint(){const el=$('#tender-label');if(el)el.textContent=state.cash?rupiah(Number(state.cash)||0):''}
document.addEventListener('click',e=>{
 const action=e.target.closest('[data-action]');if(action){const fn=actions[action.dataset.action];if(fn){fn();return}}
 const view=e.target.closest('[data-view]');if(view){state.view=view.dataset.view;render();return}
 const units=e.target.closest('[data-units]');if(units){const id=units.dataset.units;state.expanded=state.expanded===id?null:id;render();return}
 const unit=e.target.closest('[data-unit]');if(unit){const[id,index]=unit.dataset.unit.split(':');approve('Lepas satu unit dari transaksi',()=>dropUnit(id,Number(index)));return}
 const remove=e.target.closest('[data-remove]');if(remove){const l=state.cart.find(l=>l.id===remove.dataset.remove);
  approve(`Hapus ${l?l.qty:1} unit ${product(remove.dataset.remove).name} dari transaksi`,()=>{state.cart=state.cart.filter(x=>x.id!==remove.dataset.remove);state.expanded=null;dropDiscounts('Diskon dilepas setelah keranjang berubah.');render()});return}
 const add=e.target.closest('[data-add]');if(add){closeModal();stockAdd(add.dataset.add);return}
 const mem=e.target.closest('[data-member]');if(mem){state.member=MEMBERS.find(m=>m.id===mem.dataset.member);state.memberMiss='';closeModal();render();toast(`Member ${state.member.name} terhubung`);return}
 const voucher=e.target.closest('[data-voucher]');if(voucher){applyVoucher(voucher.dataset.voucher);return}
 const method=e.target.closest('[data-method]');if(method){state.payMethod=method.dataset.method;state.payRef='';state.checkoutError='';state.cash=String(remaining());render();return}
 const bank=e.target.closest('[data-bank]');if(bank){state.bank=bank.dataset.bank;render();return}
 const cash=e.target.closest('[data-cash]');if(cash){state.cash=cash.dataset.cash;const el=$('#cash-amount');if(el)el.value=state.cash;render();return}
 const digit=e.target.closest('[data-digit]');if(digit){const k=digit.dataset.digit;
  state.cash=k==='⌫'?state.cash.slice(0,-1):String(Number((state.cash||'')+k)||'');
  const el=$('#cash-amount');if(el)el.value=state.cash;updateTenderHint();return}
 const resume=e.target.closest('[data-resume]');if(resume&&!state.cart.length){const[h]=state.held.splice(Number(resume.dataset.resume),1);
  state.cart=h.cart;state.member=h.member;state.coupon=h.coupon;state.points=h.points||0;closeModal();render();toast('Transaksi dilanjutkan');return}
 const rec=e.target.closest('[data-receipt]');if(rec){const r=state.receipts.find(r=>r.id===rec.dataset.receipt);if(r)receipt(r);return}
});
function applyVoucher(raw){const code=String(raw||'').trim().toUpperCase(),min=code==='HEMAT50K'?200000:150000;
 if(!['HEMAT50K','DISC10PCT'].includes(code)||totals().subtotal<min){toast('Gunakan HEMAT50K (min Rp 200.000) atau DISC10PCT (min Rp 150.000).');return}
 state.coupon=code==='HEMAT50K'?{code,amount:50000}:{code,percent:10};render();toast(`Voucher ${code} diterapkan`)}
function submitScan(){const input=$('#scan-input'),raw=(input?.value||'').trim();if(!raw)return;
 const match=raw.match(/^(\d+)\*(.+)$/),q=match?match[2]:raw,qty=match?Number(match[1]):1;
 if(!Number.isSafeInteger(qty)||qty<1){toast('Jumlah scan tidak valid');return}
 state.stats.raw+=qty;input.value='';
 const p=PRODUCTS.find(p=>p.barcode===q||p.sku===q);
 if(p)stockAdd(p.id,qty,{source:'barcode'});else unknownSKU(q)}
document.addEventListener('submit',e=>{
 if(e.target.id==='scan-form'){e.preventDefault();submitScan();return}
 if(e.target.id==='member-form'){e.preventDefault();const q=$('#member-phone').value.trim();if(!q)return;
  const m=MEMBERS.find(m=>m.phone===q||m.name.toLowerCase().includes(q.toLowerCase()));
  if(m){state.member=m;state.memberMiss=''}else state.memberMiss=q;
  render();toast(m?`Member ${m.name} terhubung`:'Member tidak ditemukan');return}
 if(e.target.id==='voucher-form'){e.preventDefault();applyVoucher($('#voucher-code').value);return}
});
document.addEventListener('input',e=>{const el=e.target;
 if(el.id==='lookup-query')$('#lookup-results').innerHTML=lookupRows(el.value);
 if(el.id==='cash-amount'){state.cash=el.value;updateTenderHint()}
 if(el.id==='pay-reference')state.payRef=el.value});
document.addEventListener('keydown',e=>{
 if(state.locked)return;
 if($('#modal').open){if(e.key==='Escape'){state.modal=null}return}
 if(e.key==='Enter'&&document.activeElement?.id==='scan-input'){e.preventDefault();submitScan();return}
 if(e.key==='Enter'&&state.view==='payment'){e.preventDefault();remaining()?recordTender():complete();return}
 if(e.key==='Escape'){if(state.success){actions['dismiss-success']();return}if(state.view==='payment'){actions['back-to-cart']();return}}
 if(e.key==='F1'){e.preventDefault();state.view='sale';render();$('#scan-input')?.focus?.()}
 if(e.key==='F3'){e.preventDefault();actions.return()}
 if(['F4','F5'].includes(e.key)){e.preventDefault();lookup()}
 if(e.key==='F6'){e.preventDefault();cameraScan()}
 if(['F2','F10'].includes(e.key)){e.preventDefault();state.view==='payment'?(remaining()?recordTender():complete()):actions.pay()}
 if(e.key==='F8'){e.preventDefault();actions.clear()}
 if(e.key==='F9'&&state.cart.length){e.preventDefault();const last=state.cart[state.cart.length-1];approve('Lepas unit terakhir yang discan',()=>changeQuantity(last.id,-1))}
 if(e.key==='F12'){e.preventDefault();shiftDialog()}});
$('#modal').addEventListener('cancel',()=>{state.modal=null});

if(typeof setInterval==='function')setInterval(()=>{const el=$('#clock');if(el)el.textContent=clock()},1000);
render();
