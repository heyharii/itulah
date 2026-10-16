/* Isolated interaction study. All financial records below are fictional, in-memory demo data. */
const menu = window.FINANCE_MENU;
const all = menu.groups.flatMap(g => g.items.map(i => ({ ...i, group: g.label, groupId: g.id })));
const versions = {
  familiar: { name: 'Grup familiar', count: 12, note: '12 grup tetap dikenal · isi grup berpindah ke area kerja', nav: menu.groups.map(g => [g.id, g.label, '›']) },
  workspace: { name: 'Workspace kerja', count: 8, note: '8 pintu kerja · transaksi, laporan, dan setup punya tempat', nav: [['overview','Overview','⌂'],['stores','Uang toko','▤'],['payables','Tagihan & utang','▱'],['money','Kas & bank','⇄'],['books','Pembukuan','≡'],['reports','Laporan','▥'],['closing','Tutup buku','✓'],['settings','Pengaturan','⚙']] },
  queue: { name: 'Antrean tugas', count: 6, note: '6 pintu kerja · mulai dari yang perlu ditangani', nav: [['inbox','Pekerjaan saya','⌂'],['transactions','Transaksi','⇄'],['reconciliation','Rekonsiliasi','≋'],['reports','Laporan','▥'],['closing','Tutup buku','✓'],['settings','Pengaturan','⚙']] }
};
const initialVariant = new URLSearchParams(location.search).get('v');
const state = { variant: versions[initialVariant] ? initialVariant : 'workspace', nav:'overview', page:'home', tab:'', path:'', scenario:'', step:0, role:'all', query:'', catalogGroup:'all', showHidden:false, paid:false, matched:false, storeReviewed:false, storePosted:false, closeChecks:new Set(), closed:false, receipts:[], activeInvoice:0, report:'pl', view:'all', history:[] };
const invoices = [
  {id:'PI-2610-0142', supplier:'PT Sinar Tekstil', description:'Pembelian kain · PO-2610-0088', total:12500000, credit:500000, date:'15 Okt 2026', due:'15 Okt 2026'},
  {id:'PI-2610-0137', supplier:'PT Karya Mandiri', description:'Perlengkapan toko', total:7450000, credit:0, date:'12 Okt 2026', due:'18 Okt 2026'},
  {id:'PI-2610-0131', supplier:'CV Prima Jaya', description:'Perawatan AC', total:3200000, credit:0, date:'10 Okt 2026', due:'21 Okt 2026'}
];
const paths = { invoice:'/finance/payables/bills', bkk:'/finance/cash-bank/bkk', bkm:'/finance/cash-bank/bkm', bank:'/finance/cash-bank/bank-reconciliation', stores:'/finance/stores', counts:'/finance/stores/cash-counts', close:'/finance/period-close', pl:'/finance/reports/profit-and-loss' };
const byPath = path => all.find(i => i.path === path);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rupiah = n => 'Rp ' + n.toLocaleString('id-ID');
const btn = (label, action, cls='quiet', data='') => `<button class="button ${cls}" data-action="${action}" ${data}>${label}</button>`;
const linkRoute = (path,label) => `<button class="link" data-route="${escape(path)}">${escape(label || byPath(path)?.label || path)}</button>`;
const normalItems = () => all.filter(i => !i.hidden);

// Explicit placement precedes broad group mapping. Names alone never identify a page.
function placement(item) {
  const p = item.path;
  if (item.hidden) {
    if (p === '/finance/payables/supplier-ledger') return { owner:'payables', tab:'Supplier', method:'Detail supplier', context:'Dibuka dari Supplier Bills; tetap kontekstual' };
    if (p === '/finance/payables/payments') return {owner:'money',tab:'Riwayat pembayaran',method:'Register pendukung',context:'Dari pembayaran tagihan; tetap kontekstual'};
    if (p.includes('bank-clearance')) return {owner:'money',tab:'Giro',method:'Detail pencairan',context:'Dari Giro atau Settlement EDC; tetap kontekstual'};
    return {owner:'money',tab:p.includes('/bkk')?'Bukti keluar':'Bukti masuk',method:p.endsWith('/new')?'Aksi buat bukti':'Detail bukti',context:'Dari register BKK/BKM; tetap kontekstual'};
  }
  if (p === '/finance/dashboard') return {owner:'overview',tab:'Overview',method:'Halaman utama'};
  if (p.includes('period-close') || p.includes('period-closing-voucher')) return {owner:'closing',tab:p.includes('voucher')?'Voucher penutupan':'Checklist',method:p.includes('voucher')?'Hasil penutupan':'Workspace penutupan'};
  if (p === '/finance/setup/periods') return {owner:'closing',tab:'Periode',method:'Kelola periode'};
  if (p.startsWith('/finance/accounting/accruals') || p.includes('/prepaids')) return {owner:'closing',tab:p.includes('prepaids')?'Prepaids':'Accruals akhir periode',method:'Tahap penyesuaian'};
  if (p.includes('/journal-templates')) return {owner:'books',tab:'Jurnal',method:'Template jurnal berulang'};
  if (p.includes('/bank-rules')) return {owner:'money',tab:'Rekonsiliasi',method:'Pengaturan aturan pencocokan'};
  if (p.includes('/asset-classes')) return {owner:'settings',tab:'Aset',method:'Master kategori aset'};
  if (p.startsWith('/finance/tax-setup/')) return {owner:'settings',tab:'Pajak',method:'Master pajak'};
  if (p === '/finance/accounting/chart-of-accounts' || p.startsWith('/finance/setup/') || p.startsWith('/finance/settings/')) return {owner:'settings',tab:p.includes('payment')||p.includes('mdr')||p.includes('giro')?'Pembayaran':'Akuntansi',method:'Pengaturan'};
  if (item.group === 'Stores' || p.includes('/receivables/')) return {owner:'stores',tab:p.includes('card-settlement')?'Settlement EDC':p.includes('employee')?'Uang muka karyawan':p.includes('aging')?'Piutang lain':p.includes('sales')?'Penjualan':p.includes('cash-counts')?'Pemeriksaan kas':p.includes('petty')?'Kas kecil':p.includes('float')?'Modal kasir':'Saldo toko',method:'Tampilan workspace toko'};
  if (item.group === 'Payables') return {owner:'payables',tab:p.includes('recurring')?'Tagihan berulang':p.includes('credit-notes')?'Credit note':p.includes('/accruals')?'Biaya belum ditagih':p.includes('projection')?'Rencana bayar':p.includes('loans')?'Pinjaman':p.includes('aging')?'Umur utang':p.includes('summary')?'Supplier':'Tagihan',method:p.includes('aging')||p.includes('summary')?'Tampilan utang':'Halaman kerja'};
  if (item.group === 'Inventory') return {owner:'books',tab:'Persediaan',method:'Tampilan '+item.label};
  if (item.group === 'Assets') return {owner:'books',tab:'Aset',method:item.label.includes('Register')||item.label.includes('Disposals')?'Laporan aset':'Halaman aset'};
  if (item.group === 'Tax') return {owner:'books',tab:'Pajak',method:p.includes('/reports/')?'Detail pemotongan':'Kewajiban pajak'};
  if (p.includes('journal-entries')) return {owner:'books',tab:'Jurnal',method:'Register jurnal'};
  if (item.group === 'Financial Reports') {
    const tab = /profit-and-loss|sales-by-division|dimension-results|expenses-by-month/.test(p)?'Laba rugi':p.includes('balance-sheet')?'Neraca':p.includes('cash-flow')||p.endsWith('/cash-bank')?'Arus kas':p.includes('general-ledger')?'Buku besar':p.includes('trial-balance')?'Neraca saldo':p.includes('equity')?'Perubahan ekuitas':'Rekonsiliasi bank';
    return {owner:'reports',tab,method:/by-unit|2-years|by-division|dimension-results|by-month/.test(p)?'Preset laporan; filter tetap tersedia':'Laporan'};
  }
  if (item.group === 'Payments' || item.group === 'Banking') return {owner:'money',tab:p.includes('giro')?'Giro':p.includes('bank-reconciliation')||p.includes('bank-transactions')?'Rekonsiliasi':p.includes('bank-accounts')?'Rekening':p.includes('petty-cash')?'Kas kecil HO':p.includes('deposits')?'Setoran':p.includes('dashboard')?'Ringkasan pembayaran':'Transaksi',method:p.endsWith('/bkk')?'Filter Keluar (BKK)':p.endsWith('/bkm')?'Filter Masuk (BKM)':p.includes('bank-transactions')?'Sumber mutasi sebelum pencocokan':'Tampilan workspace kas & bank'};
  throw new Error('Unmapped Finance path: ' + p);
}
function destination(item, variant=state.variant) {
  const m = placement(item);
  if (variant === 'familiar') return { ...m, nav:item.groupId, label:`${item.group} › ${item.label}` };
  const nav = variant === 'queue' ? ({overview:'inbox', stores:'reconciliation', payables:'transactions', money: /Rekonsiliasi|Settlement/.test(m.tab)?'reconciliation':'transactions', books:'transactions', reports:'reports', closing:'closing', settings:'settings'})[m.owner] : m.owner;
  return { ...m, nav, label:versions[variant].nav.find(n=>n[0]===nav)[1]+' › '+m.tab+' › '+m.method };
}
function pushHistory() { state.history.push({nav:state.nav,page:state.page,tab:state.tab,path:state.path,report:state.report,mainScroll:document.getElementById('main').scrollTop,windowScroll:window.scrollY}); if(state.history.length>30)state.history.shift(); }
function finishNavigation(){closeMenu();document.getElementById('main').scrollTop=0;window.scrollTo(0,0);document.getElementById('main').focus({preventScroll:true});}
function selectRoute(path, history=true) {
  const item=byPath(path); if(!item)return;
  if(history)pushHistory();
  const d=destination(item); state.nav=d.nav;state.tab=d.tab;state.path=path;
  state.page = path===paths.invoice?'bills':path===paths.bank||path.includes('bank-transactions')?'bank':path===paths.close||path.includes('closing-voucher')?'closing':path===paths.stores||path===paths.counts||path.endsWith('/stores/cash-on-hand')?'stores':path===paths.bkk||path===paths.bkm?'money':path.includes('/reports/profit-and-loss')||path.includes('/reports/balance-sheet')||path.includes('general-ledger')||path.includes('trial-balance')||path.includes('/reports/cash-flow')?'reports':'workspace';
  if(state.page==='reports') state.report=path.includes('balance-sheet')?'bs':path.includes('general-ledger')?'gl':path.includes('trial-balance')?'tb':path.includes('cash-flow')?'cf':'pl';
  state.view=path===paths.bkk?'out':path===paths.bkm?'in':'all';
  if(path===paths.invoice)state.step=0;
  if(path===paths.bank&&state.scenario==='pay')state.step=3;
  if(path===paths.counts&&state.scenario==='store')state.step=1;
  render();finishNavigation();
}
function selectNav(id, history=true) {
  if(history)pushHistory(); state.nav=id;state.path='';state.tab='';state.view='all';
  if(id==='catalog'){state.page='catalog';render();finishNavigation();return;}
  if(state.variant==='familiar'){
    const g=menu.groups.find(g=>g.id===id);
    const defaults={'Overview':'home','Stores':'stores','Payables':'bills','Payments':'money','Banking':'bank','Financial Reports':'reports','Closing':'closing'};
    state.page=defaults[g.label]||'workspace';
    const defaultPath={stores:paths.stores,bills:paths.invoice,money:paths.bkk,bank:paths.bank,reports:paths.pl,closing:paths.close}[state.page];
    state.path=defaultPath||'';
    state.tab=byPath(state.path)?.label||g.items.find(i=>!i.hidden&&!i.more)?.label||'';
  }else state.page=({overview:'home',inbox:'home',stores:'stores',payables:'bills',money:'money',books:'workspace',reports:'reports',closing:'closing',settings:'workspace',transactions:'bills',reconciliation:'bank'})[id]||'workspace';
  render();finishNavigation();
}
function currentTitle(){return versions[state.variant].nav.find(n=>n[0]===state.nav)?.[1]||'Semua halaman';}
function badge(n){return n?`<span class="badge">${n}</span>`:'';}
function renderSidebar(){
  const rows=versions[state.variant].nav.map(([id,label,icon])=>{
    const count=(id==='payables'||id==='group-3'||id==='transactions')&&!state.paid?1:(id==='money'||id==='group-6'||id==='reconciliation')&&!state.matched?1:0;
    return `<button class="nav-item ${state.nav===id?'active':''}" data-nav="${id}" ${state.nav===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-text">${escape(label)}</span>${badge(count)}</button>`;
  }).join('');
  document.getElementById('sidebar').innerHTML=`<div class="sidebar-head"><strong>Finance</strong><span class="muted">⌄</span></div>${state.variant==='queue'?`<label class="notice" for="role">Tampilan pekerjaan</label><select id="role" class="role-picker"><option value="all">Semua Finance</option><option value="treasury">Treasury</option><option value="accountant">Accounting</option><option value="store">Finance toko</option></select>`:''}<div class="sidebar-nav">${rows}</div><div class="sidebar-foot"><button class="nav-item ${state.nav==='catalog'?'active':''}" data-nav="catalog"><span class="nav-icon">⌕</span>Semua halaman</button><p>15 Oktober 2026<br>Prototype · data contoh</p></div>`;
  const role=document.getElementById('role');if(role)role.value=state.role;
}
function flowTrack(){
  if(!state.scenario)return '';
  const labels={pay:['Pilih tagihan','Siapkan BKK','Bukti tercatat','Cocokkan bank'],store:['Temukan selisih','Periksa hitungan','Catat koreksi','Periksa saldo'],close:['Periksa prasyarat','Selesaikan penyesuaian','Review laporan','Tutup periode']}[state.scenario];
  return `<div class="flow-track"><strong>Alur contoh</strong>${labels.map((x,i)=>`<span class="${i===state.step?'current':''}">${i+1}. ${x}</span>`).join('')}<button class="link" data-action="exit-flow">Selesai mencoba</button></div>`;
}
function page(title,desc,body,actions='',tabs=''){
  return `${flowTrack()}<header class="page-head"><div><div class="crumbs"><button data-action="home">Finance</button><span>›</span><span>${escape(currentTitle())}</span>${state.history.length?'<span>·</span><button data-action="back">Kembali</button>':''}</div><h1>${title}</h1>${desc?`<p>${desc}</p>`:''}</div><div class="actions">${actions}</div></header>${tabs}<div class="page-body">${body}</div>`;
}
function task(title,subtitle,amount,status,label,action,data='') {return `<div class="work-row"><div><strong>${title}</strong><small>${subtitle}</small></div>${amount?`<div class="amount">${amount}</div>`:''}${status?`<span class="status warn">${status}</span>`:''}${btn(label,action,'quiet',data)}</div>`;}
function home(){
  const queue=state.variant==='queue';
  const role=queue?state.role:'all';
  let tasks='';
  if((role==='all'||role==='treasury')&&!state.paid)tasks+=task('Bayar tagihan PT Sinar Tekstil','PI-2610-0142 · jatuh tempo hari ini',rupiah(12000000),'Perlu dibayar','Review tagihan','invoice','data-index="0"');
  if((role==='all'||role==='store')&&!state.storePosted)tasks+=task('Periksa selisih kas Bandung','Penutupan kas 14 Oktober · hitungan belum disepakati',rupiah(250000),'Perlu diperiksa','Periksa kas','start-store');
  if((role==='all'||role==='treasury')&&!state.matched)tasks+=task(state.paid?'Cocokkan pembayaran PT Sinar Tekstil':'Mutasi bank belum memiliki pasangan','BCA Operasional · 15 Oktober',rupiah(12000000),'Belum cocok','Buka rekonsiliasi','open-bank');
  if(role==='all'||role==='accountant')tasks+=task('Selesaikan tutup buku September','Pemeriksaan kas, penyesuaian, dan laporan', '',state.closed?'':'3 pemeriksaan',state.closed?'Lihat hasil':'Buka checklist','start-close');
  const navs=versions[state.variant].nav.filter(n=>!['overview','inbox','group-0'].includes(n[0]));
  const groupDescription={stores:'Saldo, kas kecil, penjualan, settlement',payables:'Tagihan, umur utang, dan rencana bayar',money:'BKK/BKM, giro, dan rekonsiliasi',books:'Jurnal, persediaan, aset, dan pajak',reports:'Laporan keuangan beserta variasinya',closing:'Checklist dan voucher penutupan',settings:'Akun, kebijakan posting, dan master',transactions:'Tagihan, bukti kas, jurnal, dan subledger',reconciliation:'Kas toko, settlement EDC, dan bank'};
  const catalog=navs.map(([id,label])=>`<button class="area-card" data-nav="${id}"><span><strong>${escape(label)}</strong><small>${escape(groupDescription[id]||menu.groups.find(g=>g.id===id)?.items.filter(i=>!i.hidden).map(i=>i.label).slice(0,3).join(' · ')||'Master dan pengaturan')}</small></span><span aria-hidden="true">→</span></button>`).join('');
  return page(queue?'Pekerjaan saya':'Overview',queue?'Antrean mengikuti pilihan pekerjaan. Semua halaman tetap bisa dijelajah.':'Pekerjaan yang membutuhkan tindak lanjut, lalu akses ke area Finance.',`<section class="section"><div class="section-title"><h2>${queue?'Perlu ditangani':'Perlu perhatian'}</h2><span class="muted">Data contoh · 15 Okt 2026</span></div><div class="work-list">${tasks||'<p class="empty">Antrean demo ini sudah selesai.</p>'}</div></section><section class="section"><div class="section-title"><h2>Area kerja</h2><button class="link" data-nav="catalog">Lihat semua halaman</button></div><div class="area-grid">${catalog}</div></section>`);
}
function tabs(items){
  const active=state.path||({bills:paths.invoice,stores:paths.stores,money:paths.bkk,bank:paths.bank,reports:paths.pl}[state.page]);
  return `<nav class="tabs" aria-label="Tampilan area kerja">${items.map(([label,path,action])=>`<button ${active===path?'aria-current="page"':''} ${action?`data-action="${action}"`:`data-route="${path}"`}>${label}</button>`).join('')}</nav>`;
}
function localTabs(){
  if(state.variant==='familiar'){
    const g=menu.groups.find(g=>g.id===state.nav);return g?tabs(g.items.filter(i=>!i.hidden).map(i=>[i.label,i.path])):'';
  }
  const owner=state.path?placement(byPath(state.path)).owner:state.nav;
  if(owner==='payables'||state.nav==='transactions')return tabs([['Tagihan',paths.invoice],['Rencana bayar','/finance/payables/projection'],['Supplier','/finance/reports/accounts-payable-summary'],['Pinjaman','/finance/financing/loans'],...(state.nav==='transactions'?[['Bukti kas',paths.bkk],['Jurnal','/finance/accounting/journal-entries']]:[])]);
  if(owner==='money')return tabs([['Transaksi',paths.bkk],['Rekonsiliasi',paths.bank],['Giro','/finance/cash-bank/giro'],['Rekening','/finance/cash-bank/bank-accounts']]);
  if(owner==='stores'||state.nav==='reconciliation')return tabs([['Saldo toko',paths.stores],['Pemeriksaan kas',paths.counts],['Penjualan','/finance/stores/sales'],['Settlement EDC','/finance/receivables/card-settlement'],...(state.nav==='reconciliation'?[['Bank',paths.bank]]:[])]);
  if(owner==='books')return tabs([['Jurnal','/finance/accounting/journal-entries'],['Persediaan','/finance/inventory/valuation'],['Aset','/finance/assets/capitalization'],['Pajak','/finance/tax/payables']]);
  return '';
}
function bills(){
  const due=invoices.reduce((n,i,j)=>n+(j===0&&state.paid?0:i.total-i.credit),0);
  const rows=invoices.map((i,j)=>task(`${escape(i.supplier)} <span class="muted">· ${i.id}</span>`,`${i.description} · jatuh tempo ${i.due}`,rupiah(j===0&&state.paid?0:i.total-i.credit),j===0&&!state.paid?'Jatuh tempo hari ini':'',j===0&&state.paid?'Lihat pembayaran':'Buka tagihan','invoice',`data-index="${j}"`)).join('');
  return page('Tagihan supplier','Tagihan, credit note, dan pembayaran tetap terhubung pada supplier yang sama.',`<dl class="figure-line"><div><dt>Belum dibayar</dt><dd>${rupiah(due)}</dd></div><div><dt>Jatuh tempo hari ini</dt><dd>${state.paid?'0':'1'} tagihan</dd></div></dl><div class="view-links">${linkRoute('/finance/payables/credit-notes','Credit note')}${linkRoute('/finance/payables/recurring-bills','Tagihan berulang')}${linkRoute('/finance/payables/accruals','Biaya belum ditagih')}${linkRoute('/finance/payables/aging','Umur utang')}</div><div class="work-list">${rows}</div>`, '',localTabs());
}
function stores(){
  return page(state.path===paths.counts?'Pemeriksaan kas toko':'Uang toko','Penjualan dan tiga saldo kas dibaca dalam konteks toko yang sama.',`<div class="toolbar"><label>Toko <select id="store-scope"><option>Bandung</option><option>Semua toko</option></select></label><span class="muted">14 Oktober 2026</span></div><dl class="figure-line"><div><dt>Cash on hand</dt><dd>${rupiah(state.storePosted?18500000:18750000)}</dd></div><div><dt>Petty cash</dt><dd>${rupiah(2000000)}</dd></div><div><dt>Cashier float</dt><dd>${rupiah(1500000)}</dd></div></dl><section class="section"><div class="section-title"><h2>Penutupan kas · Bandung</h2><span class="status ${state.storePosted?'good':'warn'}">${state.storePosted?'Saldo disesuaikan':'Ada selisih'}</span></div><div class="work-list">${task('Cash count CC-BDG-141026','Kas yang dihitung Rp 18.500.000 · buku Rp 18.750.000',rupiah(250000),state.storePosted?'':'Hitungan perlu review',state.storePosted?'Lihat koreksi':'Periksa hitungan','cash-count')}</div></section><section class="section"><div class="section-title"><h2>Tampilan toko</h2></div><div class="view-links">${linkRoute('/finance/stores/sales','Penjualan harian')}${linkRoute('/finance/stores/petty-cash','Kas kecil toko')}${linkRoute('/finance/stores/cashier-float','Modal kasir')}${linkRoute('/finance/receivables/card-settlement','Settlement kartu & EDC')}</div></section>`, '',localTabs());
}
function money(){
  const payment=state.paid?task('BKK-2610-0089 · PT Sinar Tekstil','Pelunasan PI-2610-0142 · BCA Operasional',rupiah(12000000),state.matched?'':'Belum cocok bank','Buka bukti','payment-detail'):'';
  const correction=state.storePosted?task('BKK-2610-0090 · Koreksi kas Bandung','Berdasarkan CC-BDG-141026 · pengurangan kas',rupiah(250000),'','Lihat koreksi','cash-count'):'';
  const receipts=state.receipts.map(r=>task(`${r.id} · ${escape(r.description)}`,'Penerimaan lain · BCA Operasional',rupiah(r.amount),'','Buka bukti','receipt-detail',`data-id="${r.id}"`)).join('');
  const visible=(state.view!=='in'?payment+correction:'')+(state.view!=='out'?receipts:'');
  return page('Transaksi kas & bank','Satu register bukti; jenis Masuk dan Keluar tetap jelas sebagai BKM dan BKK.',`<div class="toolbar"><label>Jenis bukti <select id="money-filter"><option value="all">Semua bukti</option><option value="out" ${state.view==='out'?'selected':''}>Keluar · BKK</option><option value="in" ${state.view==='in'?'selected':''}>Masuk · BKM</option></select></label></div><div class="work-list">${visible||'<p class="empty">Belum ada bukti di data demo ini. Bayar tagihan untuk membuat BKK atau catat penerimaan untuk membuat BKM.</p>'}</div><section class="section"><div class="view-links">${linkRoute(paths.invoice,'Bayar tagihan supplier')}${linkRoute('/finance/cash-bank/petty-cash','Kas kecil HO')}${linkRoute('/finance/cash-bank/deposits','Setoran toko')}${linkRoute('/finance/cash-bank/giro','Giro')}</div></section>`,btn('Catat penerimaan (BKM)','new-receipt','primary'),localTabs());
}
function bank(){
  return page('Rekonsiliasi bank','Mutasi menjadi sumber pencocokan. Aturan membantu mencari calon pasangan.',`<div class="toolbar"><label>Rekening <select><option>BCA Operasional · 1234</option></select></label><span class="muted">15 Oktober 2026</span><span class="spacer"></span>${linkRoute('/finance/cash-bank/bank-rules','Aturan bank')}</div><div class="columns"><section><div class="section-title"><h2>Mutasi bank</h2><span class="muted">1 baris contoh</span></div><div class="work-list"><div class="work-row"><div><strong>Transfer PT Sinar Tekstil</strong><small>15 Okt 2026 · debit rekening</small></div><div class="amount">−${rupiah(12000000)}</div></div></div></section><section><div class="section-title"><h2>${state.matched?'Pasangan terkonfirmasi':'Calon pasangan'}</h2></div>${state.paid?`<div class="work-list"><div class="work-row"><div><strong>BKK-2610-0089</strong><small>PT Sinar Tekstil · 15 Okt · ${rupiah(12000000)}</small></div></div></div><p class="notice">Nominal dan tanggal sama. Periksa bukti sebelum mengonfirmasi.</p><div class="actions">${btn('Periksa BKK','payment-detail')}${btn(state.matched?'Sudah dicocokkan':'Konfirmasi pasangan','match','primary',state.matched?'disabled':'')}</div>`:`<p class="notice">Belum ada BKK pada data demo ini. Review tagihan lalu catat pembayaran untuk melihat calon pasangan.</p>${btn('Buka tagihan','open-invoices')}`}</section></div>${state.matched?'<div class="context-note">Pembayaran dan mutasi bank terhubung. Status bukti juga berubah menjadi cocok bank.</div>':''}`, '',localTabs());
}
function closing(){
  const steps=[['cash','Kas dan bank sudah diperiksa','Pastikan selisih kas toko dan mutasi bank ditangani.','Review kas & bank','close-cash'],['adjust','Penyesuaian periode sudah direview','Accruals akhir periode, prepaids, dan jurnal penyesuaian.','Review penyesuaian','close-adjust'],['report','Laporan September sudah direview','Laba rugi, neraca, neraca saldo, dan buku besar.','Review laporan','close-report']];
  return page('Tutup buku','September 2026 · review prasyarat, lalu buat voucher penutupan.',`<div class="checks-summary"><span>${state.closeChecks.size} dari 3 pemeriksaan selesai</span><span class="status ${state.closed?'good':'warn'}">${state.closed?'Periode ditutup di demo':'Periode belum ditutup'}</span></div><div>${steps.map(([key,title,desc,label,action])=>`<div class="check"><span class="check-mark ${state.closeChecks.has(key)?'good':''}" aria-hidden="true">${state.closeChecks.has(key)?'✓':''}</span><div><strong>${title}</strong><small>${desc}</small></div>${btn(state.closeChecks.has(key)?'Lihat review':label,action)}</div>`).join('')}</div><div class="actions" style="margin-top:24px">${btn(state.closed?'Lihat voucher penutupan':'Review & tutup September','review-close','primary',state.closeChecks.size<3?'disabled':'')}${linkRoute('/finance/setup/periods','Kelola periode')}</div><div class="context-note">Checklist demo memakai konfirmasi review manual. Produksi perlu validasi prasyarat dan hak akses dari server.</div>`);
}
function reports(){
  const type=state.report, titles={pl:'Laba rugi',bs:'Neraca',gl:'Buku besar',tb:'Neraca saldo',cf:'Arus kas'};
  const reportTabs=tabs([['Laba rugi',paths.pl],['Neraca','/finance/reports/balance-sheet'],['Arus kas','/finance/reports/cash-flow'],['Buku besar','/finance/accounting/general-ledger'],['Neraca saldo','/finance/accounting/trial-balance']]);
  const rows=type==='pl'?[['Penjualan bersih',485000000,442000000],['Harga pokok penjualan',-291000000,-265200000],['Laba kotor',194000000,176800000],['Beban operasional',-121000000,-116000000],['Laba bersih',73000000,60800000]]:type==='bs'?[['Kas & bank',185000000,162000000],['Piutang settlement',32000000,29000000],['Persediaan',410000000,395000000],['Aset tetap bersih',280000000,284000000],['Liabilitas',-297000000,-293000000],['Ekuitas',610000000,577000000]]:type==='cf'?[['Kas awal',162000000,148000000],['Arus kas operasional',31000000,22000000],['Arus kas investasi',-8000000,-8000000],['Kas akhir',185000000,162000000]]:type==='tb'?[['Kas & bank',185000000,0],['Piutang settlement',32000000,0],['Persediaan',410000000,0],['Aset tetap bersih',280000000,0],['Liabilitas',0,297000000],['Ekuitas',0,610000000]]:[['Saldo awal BCA Operasional',162000000,0],['Penerimaan penjualan',35000000,0],['Pembayaran supplier',0,12000000],['Saldo akhir',185000000,0]];
  const isCompare=type==='pl'||type==='bs'||type==='cf';
  return page(titles[type],'September 2026 · data contoh untuk mencoba navigasi dan drill-down.',`<div class="toolbar"><label>Periode <select id="report-period"><option>September 2026</option></select></label>${isCompare?`<label>Bandingkan <select id="report-compare"><option value="previous">Bulan sebelumnya</option><option value="year">Tahun sebelumnya</option><option value="none">Tanpa perbandingan</option></select></label><label>Unit <select id="report-unit"><option>Semua unit</option><option>Bandung</option></select></label>`:`<label>Akun <select><option>Semua akun</option><option>Kas & bank</option></select></label>`}</div><div class="table-wrap"><table><thead><tr><th>${type==='gl'?'Transaksi':'Akun'}</th><th class="num">${isCompare?'September 2026':'Debit'}</th><th class="num" id="comparison-label">${isCompare?'Agustus 2026':'Kredit'}</th></tr></thead><tbody>${rows.map(([name,value,prev],j)=>`<tr class="${j===rows.length-1?'total':''}"><td><button class="link" data-action="report-drill" data-account="${name}">${name}</button></td><td class="num" data-value="${value}">${rupiah(value)}</td><td class="num comparison" data-base="${prev}">${rupiah(prev)}</td></tr>`).join('')}</tbody></table></div>${isCompare?`<section class="section"><div class="section-title"><h2>Tampilan tersimpan</h2></div><div class="view-links">${type==='pl'?linkRoute('/finance/reports/profit-and-loss-by-unit','Laba rugi per unit')+linkRoute('/finance/reports/sales-by-division','Penjualan per divisi')+linkRoute('/finance/reports/expenses-by-month','Beban per bulan'):type==='bs'?linkRoute('/finance/reports/balance-sheet-2-years','Neraca dua tahun'):linkRoute('/finance/reports/cash-bank','Kas & bank')}</div></section>`:''}`,state.scenario==='close'?btn('Kembali ke review tutup buku','close-report'):'' ,state.variant==='familiar'?localTabs():reportTabs);
}
function workspace(){
  const selected=state.path?byPath(state.path):null;
  const selectedPlacement=selected?placement(selected):null;
  let items;
  if(state.variant==='familiar')items=all.filter(i=>i.groupId===state.nav&&!i.hidden);
  else if(state.nav==='transactions')items=all.filter(i=>!i.hidden&&['payables','books','money'].includes(placement(i).owner));
  else if(state.nav==='reconciliation')items=all.filter(i=>!i.hidden&&['stores','money'].includes(placement(i).owner));
  else items=all.filter(i=>!i.hidden&&placement(i).owner===(selectedPlacement?.owner||state.nav));
  const groups=[...new Set(items.map(i=>placement(i).tab))];
  const body=groups.map(tab=>`<section class="section"><div class="section-title"><h2>${escape(tab)}</h2></div><div class="area-grid">${items.filter(i=>placement(i).tab===tab).map(i=>`<button class="area-card" data-action="inspect-route" data-path="${i.path}"><span><strong>${escape(i.label)}</strong><small>${escape(placement(i).method)}${i.more?' · sebelumnya hanya lewat ⌘K':''}</small></span><span>→</span></button>`).join('')}</div></section>`).join('');
  const context=selected?`<div class="context-note"><strong>${escape(selected.label)}</strong><br>${escape(destination(selected).label)}<br><code>${escape(selected.path)}</code><br>Lokasi tujuan dapat dijelajah di bawah. Isi halaman ini belum disimulasikan penuh.</div>`:'';
  return page(selected?escape(selected.label):escape(currentTitle()),'Pilih pekerjaan atau tampilan di dalam area ini.',context+body,'',localTabs());
}
function catalog(){
  const q=state.query.toLowerCase();
  const items=all.filter(i=>(state.showHidden||!i.hidden)&&(state.catalogGroup==='all'||i.group===state.catalogGroup)&&`${i.label} ${i.path} ${i.group} ${destination(i).label}`.toLowerCase().includes(q));
  return page('Semua halaman','Temukan halaman lama beserta tempatnya di versi yang sedang dicoba.',`<div class="toolbar"><input id="catalog-query" aria-label="Cari halaman lama atau tujuan baru" placeholder="Cari nama lama, pekerjaan, atau URL…" value="${escape(state.query)}"><select id="catalog-group" aria-label="Grup menu asal"><option value="all">Semua grup asal</option>${menu.groups.map(g=>`<option ${state.catalogGroup===g.label?'selected':''}>${g.label}</option>`).join('')}</select></div><div class="directory-count">${items.length} halaman · ${menu.counts.primary} menu utama + ${menu.counts.more} sebelumnya hanya ⌘K · ${menu.counts.hidden} rute kontekstual terpisah</div><div class="directory" id="directory-results">${directoryRows(items)}</div><label class="hidden-toggle"><input type="checkbox" id="show-hidden" ${state.showHidden?'checked':''}>Tampilkan juga 7 rute kontekstual / tersembunyi</label><p class="notice">Rute kontekstual tetap dibuka dari record atau aksi terkait. Daftar ini menjelaskan lokasinya; bukan mengaktifkannya sebagai menu baru.</p>`);
}
function directoryRows(items){return items.length?items.map(i=>`<div class="directory-row"><div><strong>${escape(i.label)}</strong><small>${escape(i.group)} · ${i.hidden?'Kontekstual':i.more?'Hanya ⌘K saat ini':'Menu utama saat ini'}</small></div><div><span>${escape(destination(i).label)}</span><small>${i.hidden?escape(placement(i).context):escape(i.path)}</small></div>${btn(i.hidden?'Lihat konteks':'Buka tujuan',i.hidden?'inspect-route':'open-route','quiet',`data-path="${i.path}"`)}</div>`).join(''):'<p class="empty">Halaman tidak ditemukan. Coba nama lain atau URL.</p>';}
function render(){
  document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===state.variant));
  document.getElementById('variant-summary').textContent=versions[state.variant].note;
  document.getElementById('scenario').value=state.scenario;
  renderSidebar();
  document.getElementById('main').innerHTML=({home,bills,stores,money,bank,closing,reports,workspace,catalog})[state.page]();
  if(state.page==='reports'&&document.getElementById('report-unit')){
    if(state.path.includes('by-unit'))document.getElementById('report-unit').value='Bandung';
    if(state.path.includes('2-years'))document.getElementById('report-compare').value='year';
    updateReport();
  }
  syncChrome();
}
function syncChrome(){document.documentElement.style.setProperty('--chrome',(document.querySelector('.prototype-bar').offsetHeight+document.querySelector('.experiment-bar').offsetHeight)+'px');}
function closeMenu(){document.querySelector('.app').classList.remove('menu-open');}
function notify(message){const t=document.querySelector('.toast');t.textContent=message;t.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.hidden=true,4500);}
let opener=null;
function dialog(title,body,footer='',onReady){
  const d=document.getElementById('dialog');if(!d.open)opener=document.activeElement;
  d.innerHTML=`<header class="dialog-head"><h1 id="dialog-title">${title}</h1>${btn('Tutup','close-dialog')}</header><div class="dialog-body">${body}</div>${footer?`<footer class="dialog-foot">${footer}</footer>`:''}`;
  if(!d.open)d.showModal();
  d.scrollTop=0;onReady?.();
}
function closeDialog(){document.getElementById('dialog').close();if(opener?.isConnected)opener.focus();}
function invoice(index=0){
  state.activeInvoice=index;const i=invoices[index],paid=index===0&&state.paid;
  dialog(i.id,`<p class="notice">Tagihan supplier · data contoh</p><dl class="facts"><div><dt>Supplier</dt><dd>${i.supplier}</dd></div><div><dt>Jatuh tempo</dt><dd>${i.due}</dd></div><div><dt>Total tagihan</dt><dd class="num">${rupiah(i.total)}</dd></div><div><dt>Credit note terpakai</dt><dd class="num">${rupiah(i.credit)}</dd></div><div><dt>Sisa dibayar</dt><dd class="num">${rupiah(paid?0:i.total-i.credit)}</dd></div><div><dt>Status</dt><dd>${paid?'Lunas · BKK-2610-0089':'Belum dibayar'}</dd></div></dl><h2>Dokumen terkait</h2><div class="work-list"><div class="work-row"><div>${i.description}</div>${linkRoute('/finance/reports/accounts-payable-summary','Riwayat supplier')}</div>${i.credit?`<div class="work-row"><div>CN-2610-0011 · koreksi harga</div><span class="num">${rupiah(i.credit)}</span></div>`:''}</div>`,btn('Kembali ke daftar','open-invoices')+(paid?btn('Lihat BKK','payment-detail','primary'):index===0?btn('Siapkan pembayaran (BKK)','prepare-payment','primary'):'<span class="muted">Alur pembayaran dicontohkan pada PI-2610-0142.</span>'));
}
function preparePayment(){
  state.step=1;render();
  const i=invoices[0],due=i.total-i.credit;
  dialog('Bayar tagihan · BKK',`<p class="notice">${i.id} → bukti kas keluar → rekonsiliasi bank</p><dl class="facts"><div><dt>Supplier</dt><dd>${i.supplier}</dd></div><div><dt>Sisa tagihan setelah credit note</dt><dd>${rupiah(due)}</dd></div></dl><form id="payment-form"><label class="field">Rekening sumber<select name="account"><option>BCA Operasional · 1234</option></select></label><label class="field">Tanggal bayar<input name="date" type="date" value="2026-10-15" required></label><label class="field">Jumlah pembayaran (Rp)<input name="amount" type="number" min="1" max="${due}" step="1" value="${due}" required><small>Maksimum ${rupiah(due)}. Tagihan yang sama tidak bisa dibayar dua kali di demo.</small></label><label class="field">Keterangan<input name="note" value="Pelunasan ${i.id}" required></label><div id="payment-error" class="error" role="alert" hidden></div></form>`,btn('Cancel','cancel-payment','danger')+'<button class="button primary" type="submit" form="payment-form">Catat pembayaran demo</button>');
}
function paymentDetail(){
  if(!state.paid){invoice(0);return;}
  dialog('BKK-2610-0089',`<p class="notice">Bukti pembayaran · data contoh · ${state.matched?'sudah cocok bank':'menunggu pencocokan bank'}</p><dl class="facts"><div><dt>Dibayar kepada</dt><dd>PT Sinar Tekstil</dd></div><div><dt>Nominal</dt><dd>${rupiah(12000000)}</dd></div><div><dt>Rekening</dt><dd>BCA Operasional · 1234</dd></div><div><dt>Tagihan sumber</dt><dd><button class="link" data-action="invoice" data-index="0">PI-2610-0142</button></dd></div></dl><h2>Jejak pekerjaan</h2><div class="history">Tagihan Rp 12.500.000 → credit note Rp 500.000 → pembayaran Rp 12.000.000 → ${state.matched?'bank cocok':'bank belum cocok'}</div>`,btn('Lihat register BKK','open-money')+btn('Buka rekonsiliasi bank','open-bank','primary'));
}
function cashCount(){
  state.step=state.storePosted?3:1;render();
  dialog('Cash count · Bandung',`<p class="notice">CC-BDG-141026 · 14 Oktober 2026</p><dl class="facts"><div><dt>Menurut buku</dt><dd>${rupiah(18750000)}</dd></div><div><dt>Hasil hitungan</dt><dd>${rupiah(18500000)}</dd></div><div><dt>Selisih kurang</dt><dd>${rupiah(250000)}</dd></div><div><dt>Keterangan petugas</dt><dd>Pengeluaran lokal belum dicatat.</dd></div></dl>${state.storePosted?'<div class="context-note">Koreksi BKK-2610-0090 sudah tercatat pada data demo. Saldo buku menjadi Rp 18.500.000.</div>':`<label class="hidden-toggle"><input id="count-reviewed" type="checkbox" ${state.storeReviewed?'checked':''}>Saya sudah memeriksa hitungan dan bukti pengeluaran.</label><p class="notice">Selisih kurang dicontohkan sebagai kas keluar (BKK). Selisih lebih perlu ditelusuri; jangan otomatis dianggap pendapatan.</p>`}`,state.storePosted?btn('Lihat saldo toko','open-stores','primary'):btn('Siapkan koreksi kas','prepare-correction','primary'));
}
function correction(){
  const reviewed=document.getElementById('count-reviewed');state.storeReviewed=reviewed?.checked||state.storeReviewed;
  if(!state.storeReviewed){notify('Periksa hitungan dan centang review terlebih dahulu.');return;}
  state.step=2;render();
  dialog('Koreksi kas · BKK',`<p class="notice">Kas keluar untuk pengeluaran yang belum tercatat · CC-BDG-141026</p><dl class="facts"><div><dt>Toko</dt><dd>Bandung</dd></div><div><dt>Jumlah keluar</dt><dd>${rupiah(250000)}</dd></div></dl><label class="field">Kategori pengeluaran<select><option>Perlengkapan toko</option></select></label><label class="field">Alasan koreksi<input id="correction-reason" value="Pengeluaran lokal belum dicatat" required></label><div class="context-note">Konfirmasi ini mencatat koreksi pada data demo setelah hitungan diperiksa.</div>`,btn('Cancel','cash-count','danger')+btn('Catat koreksi demo','post-correction','primary'));
}
function closeReview(key){
  const title={cash:'Review kas & bank',adjust:'Review penyesuaian',report:'Review laporan'}[key];
  state.step={cash:0,adjust:1,report:2}[key];render();
  const body=key==='cash'?`<p class="notice">Ringkasan contoh untuk September. Periksa workspace terkait sebelum menandai selesai.</p><div class="work-list"><div class="work-row"><div>Kas toko · ringkasan September</div>${linkRoute(paths.stores,'Buka kas toko')}</div><div class="work-row"><div>Mutasi dan ledger bank · September</div>${linkRoute(paths.bank,'Buka rekonsiliasi')}</div></div>`:key==='adjust'?`<p class="notice">Penyesuaian akhir September diperiksa terpisah dari biaya supplier yang belum ditagih.</p><div class="work-list"><div class="work-row"><div>Accrual sewa September · Rp 8.000.000</div>${linkRoute('/finance/accounting/accruals','Buka accruals akhir periode')}</div><div class="work-row"><div>Alokasi asuransi · Rp 1.200.000</div>${linkRoute('/finance/accounting/prepaids','Buka prepaids')}</div><div class="work-row"><div>Jurnal penyesuaian</div>${linkRoute('/finance/accounting/journal-entries','Buka jurnal')}</div></div>`:`<p class="notice">Review laporan keuangan September sebelum periode ditutup.</p><div class="area-grid">${[paths.pl,'/finance/reports/balance-sheet','/finance/accounting/trial-balance','/finance/accounting/general-ledger'].map(p=>`<button class="area-card" data-route="${p}"><span><strong>${byPath(p).label}</strong></span>→</button>`).join('')}</div>`;
  dialog(title,body,`<span class="muted">Konfirmasi review manual · demo</span>${btn('Tandai sudah direview','mark-close','primary',`data-key="${key}"`)}`);
}
function reviewClose(){
  if(state.closeChecks.size<3)return;
  state.step=3;render();
  if(state.closed){dialog('PCV-2609-0001',`<p class="notice">Voucher penutupan September 2026 · data contoh</p><dl class="facts"><div><dt>Periode</dt><dd>September 2026</dd></div><div><dt>Status</dt><dd>Ditutup di demo</dd></div><div><dt>Laba periode</dt><dd>${rupiah(73000000)}</dd></div></dl>`,btn('Lihat laporan','open-pl','primary'));return;}
  dialog('Tutup September 2026',`<p>Ketiga pemeriksaan sudah direview. Konfirmasi untuk membuat voucher penutupan pada data demo.</p><dl class="facts"><div><dt>Periode</dt><dd>September 2026</dd></div><div><dt>Laba periode (contoh)</dt><dd>${rupiah(73000000)}</dd></div></dl><p class="notice">Aksi ini hanya mengubah state prototype. Belum mengunci posting atau membentuk jurnal pada backend.</p>`,btn('Cancel','close-dialog','danger')+btn('Tutup periode demo','confirm-close','primary'));
}
function inspectRoute(path){
  const i=byPath(path),d=destination(i);
  dialog(escape(i.label),`<p class="notice">${i.hidden?'Rute kontekstual yang tetap dibuka melalui record atau aksi.':'Preview penempatan halaman. Isi halaman ini belum disimulasikan penuh.'}</p><dl class="facts"><div><dt>Asal</dt><dd>${escape(i.group)} › ${escape(i.label)}</dd></div><div><dt>Tujuan usulan</dt><dd>${escape(d.label)}</dd></div><div><dt>Perlakuan</dt><dd>${escape(d.method)}</dd></div><div><dt>Visibilitas saat ini</dt><dd>${i.hidden?'Tersembunyi / kontekstual':i.more?'Hanya lewat ⌘K':'Menu utama'}</dd></div></dl><code>${escape(i.path)}</code>${i.hidden?`<div class="context-note">${escape(d.context)}</div>`:''}${i.moved.length?`<p class="notice" style="margin-top:20px">${i.moved.length} alias URL lama tercatat di sumber. Perubahan navigasi perlu mempertahankan redirect yang sudah ada.</p>`:''}`,i.hidden?btn('Buka workspace induk','route-parent','primary',`data-path="${i.path}"`):btn('Buka area tujuan','open-route','primary',`data-path="${i.path}"`));
}
function compare(){
  dialog('Tiga cara menyederhanakan Finance',`<p class="notice">Audit source: 57 menu utama, 21 hanya lewat ⌘K, 7 rute tersembunyi. Jumlah di bawah adalah pintu navigasi utama; “Semua halaman” tetap menjadi utilitas.</p><div class="table-wrap"><table class="compare-table"><thead><tr><th></th><th>Grup familiar</th><th class="recommended">Workspace kerja</th><th>Antrean tugas</th></tr></thead><tbody><tr><th>Pintu utama</th><td>12</td><td class="recommended">8</td><td>6</td></tr><tr><th>Cara mencari</th><td>Pilih grup lama, lalu halaman.</td><td class="recommended">Pilih pekerjaan, lalu tampilan.</td><td>Pilih tugas yang perlu tindakan.</td></tr><tr><th>Bayar tagihan</th><td>Payables → invoice → BKK → Banking.</td><td class="recommended">Tagihan & utang → invoice → BKK → rekonsiliasi.</td><td>Pekerjaan saya → review tagihan → BKK → pasangan bank.</td></tr><tr><th>Yang berubah</th><td>Isi grup keluar dari sidebar. Nama dan struktur lama dipertahankan.</td><td class="recommended">BKK/BKM menjadi jenis bukti; laporan variasi menjadi preset; master ke Pengaturan.</td><td>Antrean berdasarkan pekerjaan; arsip tetap di Transaksi dan Semua halaman.</td></tr><tr><th>Keunggulan</th><td>Adaptasi paling ringan.</td><td class="recommended">Alamat stabil untuk semua pekerjaan.</td><td>Prioritas pekerjaan harian langsung terlihat.</td></tr><tr><th>Tradeoff</th><td>12 grup masih mencampur transaksi, laporan, dan master.</td><td class="recommended">Butuh konsolidasi tampilan dan penyelarasan istilah.</td><td>Bergantung pada kualitas antrean, ownership, dan status.</td></tr><tr><th>Cocok untuk</th><td>Transisi awal yang konservatif.</td><td class="recommended">Fondasi navigasi Finance.</td><td>Lapisan awal untuk tim dengan pembagian kerja jelas.</td></tr></tbody></table></div><div class="context-note"><strong>Usulan: fondasi Workspace kerja + antrean di Overview.</strong><br>8 alamat stabil untuk eksplorasi, dengan pintasan pekerjaan mendesak. Daftar 78 halaman non-hidden tetap dapat ditelusuri tanpa keyboard. Penggabungan halaman adalah usulan UI; bukan klaim backend sudah mendukung satu transaksi atau report engine.</div>`,btn('Coba Workspace kerja','choose-workspace','primary'));
}
function search(){
  dialog('Cari Finance',`<input id="global-query" class="search-input" placeholder="Cari nama halaman atau pekerjaan…" aria-label="Cari Finance"><div id="search-results"></div>`, '<span class="muted">78 halaman non-hidden · Escape untuk kembali</span>');
  updateSearch('');document.getElementById('global-query').focus();
}
function updateSearch(q){
  const items=normalItems().filter(i=>`${i.label} ${i.path} ${destination(i).label}`.toLowerCase().includes(q.toLowerCase()));
  document.getElementById('search-results').innerHTML=items.slice(0,12).map(i=>`<button class="search-result" data-route="${i.path}"><span>${escape(i.label)}<small>${escape(destination(i).label)}</small></span><span>↵</span></button>`).join('')||'<p class="empty">Tidak ada hasil.</p>';
}
function changeVariant(v){
  const oldPath=state.path,oldPage=state.page;state.variant=v;state.history=[];
  const url=new URL(location.href);url.searchParams.set('v',v);history.replaceState(null,'',url);
  if(oldPage==='catalog'){state.nav='catalog';state.page='catalog';render();}
  else if(oldPath)selectRoute(oldPath,false);
  else if(oldPage==='home')selectNav(versions[v].nav[0][0],false);
  else {
    const representative={bills:paths.invoice,stores:paths.stores,money:paths.bkk,bank:paths.bank,closing:paths.close,reports:paths.pl,workspace:'/finance/accounting/journal-entries'}[oldPage];
    selectRoute(representative||paths.invoice,false);
  }
}
function startScenario(s){
  closeDialog();state.scenario=s;state.step=0;
  if(s==='pay')selectRoute(paths.invoice);else if(s==='store')selectRoute(paths.stores);else if(s==='close')selectRoute(paths.close);else render();
}
const handlers={
  'home':()=>selectNav(versions[state.variant].nav[0][0]),
  'menu':()=>document.querySelector('.app').classList.toggle('menu-open'),
  'compare':compare,'search':search,'choose-workspace':()=>{closeDialog();changeVariant('workspace');},
  'close-dialog':closeDialog,'invoice':el=>invoice(Number(el.dataset.index||0)),
  'prepare-payment':preparePayment,'cancel-payment':()=>invoice(0),'payment-detail':paymentDetail,
  'open-invoices':()=>{closeDialog();selectRoute(paths.invoice);},
  'open-bank':()=>{closeDialog();selectRoute(paths.bank);},
  'open-money':()=>{closeDialog();selectRoute(paths.bkk);},
  'open-stores':()=>{closeDialog();state.step=3;selectRoute(paths.stores);},
  'open-pl':()=>{closeDialog();selectRoute(paths.pl);},
  'start-store':()=>startScenario('store'),'start-close':()=>startScenario('close'),
  'cash-count':cashCount,'prepare-correction':correction,
  'post-correction':()=>{const reason=document.getElementById('correction-reason');if(!reason.value.trim()){reason.focus();return;}if(state.storePosted)return;state.storePosted=true;state.step=3;closeDialog();selectRoute(paths.stores);notify('BKK-2610-0090 tercatat. Saldo kas Bandung menjadi Rp 18.500.000.');},
  'match':()=>{if(!state.paid||state.matched)return;dialog('Konfirmasi pasangan bank',`<p>Hubungkan mutasi keluar ${rupiah(12000000)} tanggal 15 Oktober dengan BKK-2610-0089 untuk PT Sinar Tekstil?</p>`,btn('Cancel','close-dialog','danger')+btn('Konfirmasi pasangan demo','confirm-match','primary'));},
  'confirm-match':()=>{state.matched=true;closeDialog();render();notify('Mutasi bank dan BKK-2610-0089 sudah cocok.');},
  'close-cash':()=>closeReview('cash'),'close-adjust':()=>closeReview('adjust'),'close-report':()=>closeReview('report'),
  'mark-close':el=>{state.closeChecks.add(el.dataset.key);closeDialog();selectRoute(paths.close);notify('Review ditandai selesai di demo.');},
  'review-close':reviewClose,'confirm-close':()=>{if(state.closeChecks.size<3)return;state.closed=true;closeDialog();render();reviewClose();},
  'inspect-route':el=>inspectRoute(el.dataset.path),
  'open-route':el=>{closeDialog();selectRoute(el.dataset.path);},
  'route-parent':el=>{const p=el.dataset.path;closeDialog();selectRoute(p.includes('/bkm')?paths.bkm:p.includes('/bkk')||p.includes('payments')?paths.bkk:p.includes('supplier-ledger')?paths.invoice:'/finance/cash-bank/giro');},
  'exit-flow':()=>{state.scenario='';render();},
  'back':()=>{const prev=state.history.pop();if(prev){const {mainScroll,windowScroll,...pageState}=prev;Object.assign(state,pageState);render();document.getElementById('main').scrollTop=mainScroll;window.scrollTo(0,windowScroll);}},
  'reset':()=>{dialog('Reset data contoh',`<p>Pembayaran, koreksi kas, pencocokan bank, dan review penutupan akan kembali ke kondisi awal prototype.</p>`,btn('Kembali','close-dialog')+btn('Reset demo','confirm-reset','primary'));},
  'confirm-reset':()=>{state.paid=false;state.matched=false;state.storeReviewed=false;state.storePosted=false;state.closed=false;state.closeChecks.clear();state.receipts=[];state.step=0;closeDialog();startScenario(state.scenario);notify('Data demo dikembalikan ke awal.');},
  'new-receipt':()=>dialog('Catat penerimaan · BKM',`<p class="notice">Penerimaan lain · data contoh. Settlement EDC tetap direkonsiliasi di workspace toko.</p><form id="receipt-form"><label class="field">Diterima dari<input name="party" required value="Penerimaan lain"></label><label class="field">Jumlah (Rp)<input name="amount" type="number" min="1" step="1" required></label><label class="field">Keterangan<input name="description" required></label></form>`,btn('Cancel','close-dialog','danger')+'<button class="button primary" type="submit" form="receipt-form">Catat penerimaan demo</button>'),
  'receipt-detail':el=>{const r=state.receipts.find(r=>r.id===el.dataset.id);dialog(r.id,`<dl class="facts"><div><dt>Diterima dari</dt><dd>${escape(r.party)}</dd></div><div><dt>Jumlah</dt><dd>${rupiah(r.amount)}</dd></div><div><dt>Keterangan</dt><dd>${escape(r.description)}</dd></div></dl>`,btn('Tutup','close-dialog'));},
  'report-drill':el=>{const name=el.dataset.account;dialog(escape(name)+' · drill-down',`<p class="notice">Contoh urutan eksplorasi laporan → buku besar → jurnal sumber. Nilai agregat dan sampel transaksi di sini bersifat ilustratif.</p><div class="work-list"><div class="work-row"><div><strong>JE-2609-0128</strong><small>30 September 2026 · sampel jurnal penutupan</small></div>${btn('Lihat jurnal','drill-journal')}</div></div>`,btn('Kembali ke laporan','close-dialog'));},
  'drill-journal':()=>dialog('JE-2609-0128',`<p class="notice">Contoh jurnal yang sudah diposting · read-only</p><div class="table-wrap"><table><thead><tr><th>Akun</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead><tbody><tr><td>Piutang settlement</td><td class="num">12.000.000</td><td class="num">—</td></tr><tr><td>Penjualan</td><td class="num">—</td><td class="num">12.000.000</td></tr></tbody></table></div>`,btn('Kembali ke laporan','close-dialog'))
};
document.addEventListener('click',event=>{
  const variant=event.target.closest('[data-variant]');if(variant){changeVariant(variant.dataset.variant);return;}
  const nav=event.target.closest('[data-nav]');if(nav){selectNav(nav.dataset.nav);return;}
  const route=event.target.closest('[data-route]');if(route){closeDialog();selectRoute(route.dataset.route);return;}
  const action=event.target.closest('[data-action]');if(action&&!action.disabled)handlers[action.dataset.action]?.(action);
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='scenario')startScenario(el.value);
  if(el.id==='role'){state.role=el.value;render();}
  if(el.id==='money-filter'){state.view=el.value;render();}
  if(el.id==='catalog-group'){state.catalogGroup=el.value;render();}
  if(el.id==='show-hidden'){state.showHidden=el.checked;render();}
  if(el.id==='report-unit'||el.id==='report-compare')updateReport();
  if(el.id==='store-scope')notify(el.value==='Bandung'?'Menampilkan Bandung.':'Data demo hanya memuat toko Bandung.');
});
function updateReport(){
  const compare=document.getElementById('report-compare')?.value;
  const isUnit=document.getElementById('report-unit')?.value==='Bandung';
  const factor=isUnit ? .28 : 1;
  document.querySelectorAll('[data-value]').forEach(td=>td.textContent=rupiah(Math.round(Number(td.dataset.value)*factor)));
  document.querySelectorAll('.comparison').forEach(td=>{td.hidden=compare==='none';td.textContent=rupiah(Math.round(Number(td.dataset.base)*factor*(compare==='year' ? .92 : 1)));});
  const label=document.getElementById('comparison-label');label.hidden=compare==='none';label.textContent=compare==='year'?'September 2025':'Agustus 2026';
}
document.addEventListener('input',event=>{
  if(event.target.id==='global-query')updateSearch(event.target.value);
  if(event.target.id==='catalog-query'){
    state.query=event.target.value;
    const q=state.query.toLowerCase(),items=all.filter(i=>(state.showHidden||!i.hidden)&&(state.catalogGroup==='all'||i.group===state.catalogGroup)&&`${i.label} ${i.path} ${i.group} ${destination(i).label}`.toLowerCase().includes(q));
    document.getElementById('directory-results').innerHTML=directoryRows(items);document.querySelector('.directory-count').textContent=`${items.length} halaman ditemukan · versi ${versions[state.variant].name}`;
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id==='payment-form'){
    event.preventDefault();const data=new FormData(event.target),amount=Number(data.get('amount')),due=invoices[0].total-invoices[0].credit;
    const error=document.getElementById('payment-error');
    if(state.paid||!Number.isSafeInteger(amount)||amount<=0||amount>due||!data.get('date')||!String(data.get('note')).trim()){error.textContent='Periksa nominal, tanggal, dan keterangan. Pembayaran tidak boleh melebihi sisa tagihan.';error.hidden=false;return;}
    // This scenario intentionally supports full settlement only: no invented partial-payment engine.
    if(amount!==due){error.textContent='Alur demo ini memakai pelunasan penuh Rp 12.000.000. Pembayaran sebagian belum disimulasikan.';error.hidden=false;return;}
    if(data.get('date')!=='2026-10-15'){error.textContent='Alur bank demo memakai tanggal 15 Oktober 2026. Pilih tanggal tersebut untuk melanjutkan.';error.hidden=false;return;}
    state.paid=true;state.step=2;render();paymentDetail();notify('BKK-2610-0089 tercatat. Tagihan lunas di data demo.');
  }
  if(event.target.id==='receipt-form'){
    event.preventDefault();const data=new FormData(event.target),amount=Number(data.get('amount'));if(!Number.isSafeInteger(amount)||amount<=0)return;
    state.receipts.push({id:'BKM-2610-'+String(state.receipts.length+1).padStart(4,'0'),party:String(data.get('party')),description:String(data.get('description')),amount});closeDialog();selectRoute(paths.bkm);notify('BKM tercatat di data demo.');
  }
});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search();}});
document.getElementById('dialog').addEventListener('click',event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
window.addEventListener('resize',syncChrome);
// Exposed for audit/QA only; no production navigation or backend state is changed.
window.financePrototype={state,all,placement,destination,versions};
selectNav(versions[state.variant].nav[0][0],false);
