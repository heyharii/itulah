/* Navigation/interaction study only. No API, real employee records, or production mutations. */
const source=window.HR_MENU;
const all=source.groups.flatMap(g=>g.items.map(i=>({...i,group:g.label})));
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'Rp '+n.toLocaleString('id-ID');
const actors={maya:{name:'Maya',role:'employer',label:'HR pusat · Maya'},budi:{name:'Budi',role:'unit',label:'Manager Bandung · Budi'},sarah:{name:'Sarah',role:'employer',label:'HR pusat · Sarah'}};
const baseNav=[['overview','Overview','⌂'],['employees','Karyawan','♧'],['time','Waktu kerja','▦'],['benefits','Klaim & benefit','▱'],['payroll','Payroll','≡'],['reports','Laporan','▥'],['settings','Pengaturan','⚙']];
const schemeFromUrl=new URLSearchParams(location.search).get('scheme');
const state={scheme:schemeFromUrl==='separate'?'separate':'compact',actor:'maya',nav:'overview',path:'',page:'overview',scenario:'',query:'',group:'all',history:[],leaveApproved:false,coverage:false,evidence:false,evidenceReason:'',payroll:'DRAFT',submitter:null,approver:null,handover:false,claimApproved:false,claimApprover:null,decisions:[],requestType:'all'};
const p={overview:'/people/overview',employees:'/people',roster:'/people/roster',attendance:'/people/attendance-days',leave:'/people/leave',balances:'/people/leave-balances',overtime:'/people/overtime',claim:'/people/claims',benefit:'/people/benefit',payroll:'/people/payroll',oneoffs:'/people/one-offs',reports:'/people/reports'};
const records={leave:{id:'LV-2610-0042',name:'Dina Putri',from:'19 Okt 2026',to:'20 Okt 2026',days:2,balance:12},claim:{id:'CL-2610-0018',name:'Dina Putri',amount:350000,kind:'Transport kunjungan toko'},run:{id:'PR-BDG-2609',period:'September 2026',gross:15800000,net:14600000}};
const paths=new Map(all.map(i=>[i.path,i]));
const mapping={};
function assign(owner,section,method,items){for(const path of items){if(mapping[path])throw Error('Duplicate placement '+path);mapping[path]={owner,section,method};}}
assign('overview','Perlu ditangani','Satu antrean; jenis pengajuan sebagai filter',[p.overview]);
assign('employees','Direktori','Daftar dan detail karyawan',[p.employees]);
assign('employees','Organisasi','Tampilan struktur organisasi',['/people/org-chart']);
assign('employees','Perubahan & disiplin','Halaman kerja dengan riwayat keputusan',['/people/changes','/people/reprimands']);
assign('employees','Lifecycle','Onboarding dan offboarding tetap alur berbeda',['/people/onboarding','/people/offboarding']);
assign('employees','Undangan & akses','Undangan dari konteks karyawan; provisioning tetap System',['/people/invitations']);
assign('time','Jadwal','Roster dan kalender tim adalah dua tampilan jadwal',[p.roster,'/people/calendar']);
assign('time','Presensi','Data sumber dan koreksi; data belum ada bukan absen',[p.attendance]);
assign('time','Cuti','Pengajuan cuti dan saldo tetap dua tampilan berbeda',[p.leave,p.balances]);
assign('time','Lembur','Perintah, persetujuan karyawan, dan realisasi tetap berbeda',[p.overtime]);
assign('benefits','Klaim','Review klaim; disetujui belum berarti dibayar',[p.claim]);
assign('benefits','Pinjaman karyawan','Pencairan dan cicilan melalui potongan gaji',['/people/loans']);
assign('benefits','Saldo belanja karyawan','Benefit yang dibelanjakan di kasir; bukan kuota reimbursement',[p.benefit]);
assign('payroll','Payroll runs','Draft → Submitted → Approved; handover Finance terpisah',[p.payroll]);
assign('payroll','Komponen satu periode','One-offs sebagai input run, tidak otomatis menjadi master',[p.oneoffs]);
assign('reports','Analisis HR','Tenaga kerja, waktu, dan biaya payroll sesuai akses',[p.reports]);
assign('reports','Pajak & BPJS','Laporan khusus tetap memiliki route dan format sendiri',['/people/tax-report']);
assign('reports','Dokumen tahunan','1721-A1 tetap dokumen sendiri; bukan preset laporan generik',['/people/annual-tax']);
assign('settings','Organisasi','Master perusahaan, unit, dan struktur',['/people/settings/company','/people/settings/group','/people/settings/departments','/people/settings/levels']);
assign('settings','Waktu kerja','Kebijakan presensi, shift, cuti, dan lembur',['/people/settings/attendance','/people/settings/mobile','/people/settings/shifts','/people/settings/leave-types','/people/settings/holidays','/people/settings/overtime']);
assign('settings','Payroll','Jadwal, komponen, slip, potongan, dan parameter pusat',['/people/settings/payroll-schedule','/people/settings/components','/people/settings/payslip','/people/settings/absence','/people/settings/rates']);
assign('settings','Klaim & benefit','Kebijakan klaim, plafon reimbursement, dan aturan saldo belanja dipisahkan',['/people/claim-types','/people/claim-allowances','/people/settings/benefit']);
assign('settings','Akses & alur kerja','Mandat, checklist, delegasi, dan employee app',['/people/job-roles','/people/settings/checklists','/people/settings/delegation','/people/settings/app']);
for(const item of all)if(!mapping[item.path])throw Error('Unmapped '+item.path);
function navs(){const n=baseNav.map(i=>[...i]);if(state.scheme==='separate'){n[2][1]='Jadwal & presensi';n.splice(3,0,['leave','Cuti & lembur','◷']);}return n.filter(([id])=>id!=='settings'||actors[state.actor].role==='employer');}
function placement(item,scheme=state.scheme){const m=mapping[item.path];const owner=scheme==='separate'&&m.owner==='time'&&['Cuti','Lembur'].includes(m.section)?'leave':m.owner;const label=owner==='leave'?'Cuti & lembur':owner==='time'&&scheme==='separate'?'Jadwal & presensi':baseNav.find(n=>n[0]===owner)[1];return {...m,owner,label:`${label} › ${m.section}`,audience:item.audience||'Semua pelaku sesuai scope'};}
const permitted=i=>!i.audience||actors[state.actor].role==='employer';
const allowedItems=()=>all.filter(permitted);
const button=(label,action,cls='quiet',data='')=>`<button class="button ${cls}" data-action="${action}" ${data}>${label}</button>`;
const route=(path,label)=>`<button class="link" data-route="${path}">${e(label||paths.get(path)?.label||path)}</button>`;
const badge=n=>n?`<span class="badge">${n}</span>`:'';
function savePosition(){state.history.push({nav:state.nav,path:state.path,page:state.page,scroll:document.getElementById('main').scrollTop,windowScroll:scrollY});if(state.history.length>25)state.history.shift();}
function finishNavigation(){document.querySelector('.app').classList.remove('menu-open');document.getElementById('main').scrollTop=0;scrollTo(0,0);document.getElementById('main').focus({preventScroll:true});}
function navigate(path,save=true){
  const item=paths.get(path);if(!item)return;
  if(save)savePosition();
  if(!permitted(item)){state.page='restricted';state.nav='overview';state.path=path;render();finishNavigation();return;}
  state.path=path;state.nav=placement(item).owner;
  state.page=path===p.overview?'overview':path===p.employees?'employees':path===p.roster||path==='/people/calendar'?'roster':path===p.attendance?'attendance':path===p.leave||path===p.balances?'leave':path===p.claim?'claims':path===p.payroll||path===p.oneoffs?'payroll':path===p.reports?'reports':'workspace';
  render();finishNavigation();
}
function selectNav(id,save=true){
  if(save)savePosition();state.nav=id;state.path='';
  state.page=id==='catalog'?'catalog':({overview:'overview',employees:'employees',time:'roster',leave:'leave',benefits:'claims',payroll:'payroll',reports:'reports',settings:'workspace'})[id];
  render();finishNavigation();
}
function currentLabel(){return navs().find(n=>n[0]===state.nav)?.[1]||'Semua halaman';}
function scenarioTrack(){if(!state.scenario)return '';const labels={leave:['Review cuti','Cek jadwal','Putuskan','Saldo & kalender'],payroll:['Periksa sumber presensi','Unit mengajukan','HR menyetujui','Finance menerima'],claim:['Periksa bukti','Review kuota','Putuskan','Pantau pembayaran']}[state.scenario];return `<div class="flow-track"><strong>Alur contoh</strong>${labels.map(l=>`<span>${l}</span>`).join('<span>→</span>')}<button class="link" data-action="exit-scenario">Jelajah bebas</button></div>`;}
function page(title,desc,body,actions='',tabs=''){
  return `${scenarioTrack()}<header class="page-head"><div><div class="crumbs"><button data-action="home">HR</button><span>›</span><span>${e(currentLabel())}</span>${state.history.length?'<span>·</span><button data-action="back">Kembali</button>':''}</div><h1>${e(title)}</h1><p>${desc}</p></div><div class="actions">${actions}</div></header>${tabs}<div class="page-body">${body}</div>`;
}
function scope(){return `<div class="scope-line"><span><strong>Bandung</strong> · unit contoh</span><span class="muted">${actors[state.actor].role==='unit'?'Scope pelaku: unit sendiri':'Pelaku pusat; data contoh yang dimuat hanya Bandung'} · 16 Oktober 2026</span></div>`;}
function localTabs(){
  const entries=state.nav==='time'?(state.scheme==='compact'?[['Jadwal',p.roster],['Presensi',p.attendance],['Cuti',p.leave],['Lembur',p.overtime]]:[['Jadwal',p.roster],['Presensi',p.attendance]]):state.nav==='leave'?[['Cuti',p.leave],['Lembur',p.overtime]]:state.nav==='benefits'?[['Klaim',p.claim],['Pinjaman karyawan','/people/loans'],['Saldo belanja',p.benefit]]:state.nav==='payroll'?[['Payroll runs',p.payroll],['One-offs',p.oneoffs]]:state.nav==='employees'?[['Direktori',p.employees],['Lifecycle','/people/onboarding'],['Organisasi','/people/org-chart']]:[];
  const filtered=entries.filter(([,path])=>permitted(paths.get(path)));
  const defaultPath={roster:p.roster,attendance:p.attendance,leave:p.leave,claims:p.claim,payroll:p.payroll,employees:p.employees}[state.page];
  return filtered.length?`<nav class="tabs" aria-label="Tampilan workspace">${filtered.map(([label,path])=>`<button data-route="${path}" ${(state.path||defaultPath)===path?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`:'';
}
function workRow(title,sub,status,label,action,data=''){return `<div class="work-row"><div><strong>${title}</strong><small>${sub}</small></div>${status?`<span class="status warn">${status}</span>`:''}${button(label,action,'quiet',data)}</div>`;}
function pendingCount(){return (state.leaveApproved?0:1)+(state.claimApproved?0:1)+(state.payroll==='SUBMITTED'&&actors[state.actor].role==='employer'?1:0)+(state.evidence?0:1);}
function sidebar(){
  document.getElementById('sidebar').innerHTML=`<div class="sidebar-head"><strong>HR</strong><span class="muted">⌄</span></div><div class="sidebar-nav">${navs().map(([id,label,icon])=>`<button class="nav-item ${state.nav===id?'active':''}" data-nav="${id}" ${state.nav===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-text">${label}</span>${badge(id==='overview'?pendingCount():id==='payroll'&&state.payroll==='SUBMITTED'?1:0)}</button>`).join('')}</div><div class="sidebar-foot"><button class="nav-item ${state.nav==='catalog'?'active':''}" data-nav="catalog"><span class="nav-icon">⌕</span>Semua halaman</button><p>${allowedItems().length} halaman sesuai pelaku<br>Prototype · data contoh</p></div>`;
}
const descriptions={employees:'Direktori, perubahan, lifecycle, dan undangan',time:'Jadwal, presensi, cuti, dan lembur',leave:'Pengajuan, saldo cuti, dan lembur',benefits:'Reimbursement, pinjaman, dan saldo belanja',payroll:'Input per periode → pengajuan → keputusan → Finance',reports:'Analisis HR serta dokumen pajak & BPJS',settings:'Organisasi, waktu, payroll, klaim, dan akses'};
function overview(){
  let rows='';
  if(!state.leaveApproved)rows+=workRow('Cuti Dina Putri','19–20 Okt · 2 hari · cek cakupan jadwal sebelum memutuskan','Menunggu keputusan','Review cuti','leave-detail');
  if(!state.evidence)rows+=workRow('Sumber presensi September belum lengkap','PR-BDG-2609 · data belum lengkap tidak dianggap nol atau absen','Menghambat pengajuan payroll','Periksa sumber','open-attendance');
  if(!state.claimApproved)rows+=workRow('Klaim transport Dina Putri',`${records.claim.id} · ${money(records.claim.amount)} · bukti contoh tersedia`,'Menunggu review','Review klaim','claim-detail');
  if(state.payroll==='SUBMITTED')rows+=workRow('Payroll September diajukan Budi','PR-BDG-2609 · memerlukan keputusan HR pusat','Menunggu approval','Review payroll','run-detail');
  if(state.payroll==='APPROVED'&&!state.handover)rows+=workRow('Payroll disetujui, belum diserahkan','Approval dan pembayaran adalah status berbeda','Perlu handover','Lihat payroll','run-detail');
  const areas=navs().filter(n=>n[0]!=='overview').map(([id,label])=>`<button class="area-card" data-nav="${id}"><span><strong>${label}</strong><small>${e(descriptions[id])}</small></span><span>→</span></button>`).join('');
  return page('Overview','Satu antrean persetujuan dan pengecualian; arsip berada di workspace pemiliknya.',scope()+`<section class="section"><div class="section-title"><h2>Perlu ditangani</h2><span class="muted">Data fiktif</span></div><div class="work-list">${rows||'<p class="empty">Tidak ada pekerjaan tertunda pada contoh ini.</p>'}</div></section><section class="section"><div class="section-title"><h2>Workspace HR</h2><button class="link" data-nav="catalog">Temukan halaman lama</button></div><div class="area-grid">${areas}</div></section>`);
}
function employees(){
  const people=[['Dina Putri','Sales associate · aktif','Cuti menunggu keputusan'],['Ari Saputra','Store leader · aktif','Jadwal dan presensi'],['Sari Lestari','Sales associate · aktif','Onboarding selesai']];
  return page('Karyawan','Satu record karyawan menghubungkan penempatan, pengajuan, lifecycle, dan riwayat.',scope()+`<div class="work-list">${people.map(([name,sub,info])=>workRow(name,sub,'','Buka karyawan','employee-detail',`data-name="${name}"`)).join('')}</div><section class="section"><div class="section-title"><h2>Pekerjaan terkait</h2></div><div class="route-grid">${allowedItems().filter(i=>placement(i).owner==='employees'&&i.path!==p.employees).map(routeCard).join('')}</div></section>`,'',localTabs());
}
function roster(){
  return page(state.path==='/people/calendar'?'Kalender tim':'Jadwal tim','Roster dan kalender membaca konteks tim yang sama; pengajuan tetap memiliki keputusan sendiri.',scope()+`<div class="toolbar"><span>19–25 Oktober 2026</span><span class="spacer"></span>${route('/people/calendar','Kalender tim')}${route(p.roster,'Roster')}</div><div class="table-wrap"><table class="calendar-table"><thead><tr><th>Karyawan</th><th>Senin · 19 Okt</th><th>Selasa · 20 Okt</th><th>Rabu · 21 Okt</th></tr></thead><tbody><tr><td>Dina Putri</td><td class="leave-cell">${state.leaveApproved?'Cuti disetujui':'Cuti diajukan'}</td><td class="leave-cell">${state.leaveApproved?'Cuti disetujui':'Cuti diajukan'}</td><td>Shift siang</td></tr><tr><td>Ari Saputra</td><td>Shift pagi</td><td>Shift pagi</td><td>Shift pagi</td></tr><tr><td>Sari Lestari</td><td class="${state.coverage?'changed-cell':''}">${state.coverage?'Pengganti sudah direview':'Periksa cakupan shift'}</td><td class="${state.coverage?'changed-cell':''}">${state.coverage?'Pengganti sudah direview':'Periksa cakupan shift'}</td><td>Shift siang</td></tr></tbody></table></div><div class="decision-note">Review cakupan shift adalah konfirmasi manual pada contoh ini. Prototype tidak menghitung kebutuhan staffing atau otomatis menyusun ulang roster.</div><div class="actions">${button('Review cakupan shift','coverage')}${button('Kembali ke pengajuan cuti','leave-detail','primary')}</div>`,'',localTabs());
}
function leave(){
  const approved=state.leaveApproved;
  return page(state.path===p.balances?'Saldo cuti':'Cuti','Keputusan, jadwal tim, dan saldo saling terhubung tanpa menjadi satu jenis data.',scope()+`<dl class="figure-line"><div><dt>Saldo cuti Dina · contoh</dt><dd>${approved?10:12} hari</dd></div><div><dt>Pengajuan 19–20 Oktober</dt><dd>2 hari</dd></div></dl><div class="view-links">${route(p.leave,'Pengajuan cuti')}${route(p.balances,'Saldo cuti')}${route('/people/calendar','Kalender tim')}</div><div class="work-list">${workRow('Dina Putri · LV-2610-0042',`Cuti tahunan · 19–20 Oktober · ${approved?'saldo setelah keputusan 10 hari':'saldo awal 12 hari'}`,approved?'':'Menunggu keputusan',approved?'Lihat keputusan':'Review pengajuan','leave-detail')}</div><p class="helper" style="margin-top:20px">Angka saldo dan jumlah hari dibebankan adalah fixture; prototype tidak menghitung hak cuti atau aturan hari kerja.</p>`,'',localTabs());
}
function attendance(){
  return page('Presensi','Mulai dari pengecualian dan sumber yang belum lengkap, lalu telusuri koreksi.',scope()+`<div class="toolbar"><span>September 2026 · periode input payroll contoh</span></div><div class="work-list">${workRow('Dina Putri · rekap September',state.evidence?'Sumber rekap manual sudah direview di demo':'Sumber presensi belum lengkap; belum bisa menyimpulkan jam kerja.',state.evidence?'':'Data belum lengkap','Periksa bukti','attendance-review')}${workRow('Ari Saputra · rekap September','Rekap contoh tersedia untuk dibaca','','Lihat rekap','attendance-example')}</div><div class="context-note">Tidak ada punch tambahan yang dibuat. Penyelesaian contoh menggunakan bukti rekap manual yang direview secara eksplisit.</div><div class="actions">${button('Lanjut ke payroll September','open-payroll','primary')}</div>`,'',localTabs());
}
function claims(){
  return page('Klaim & benefit','Klaim, pinjaman, dan saldo belanja tetap pekerjaan berbeda di dalam satu area kompensasi.',scope()+`<div class="work-list">${workRow('Klaim Dina Putri',`${records.claim.id} · ${records.claim.kind} · ${money(records.claim.amount)}`,state.claimApproved?'Disetujui · belum dibayar':'Menunggu review','Buka klaim','claim-detail')}</div><section class="section"><div class="section-title"><h2>Pekerjaan terkait</h2></div><div class="route-grid">${allowedItems().filter(i=>placement(i).owner==='benefits'&&i.path!==p.claim).map(routeCard).join('')}</div></section><div class="decision-note">Saldo benefit adalah saldo belanja karyawan di kasir. Plafon klaim membatasi reimbursement. Pinjaman memiliki pencairan dan cicilan. Ketiganya tidak dijumlahkan atau dianggap saldo yang sama.</div>${actors[state.actor].role==='employer'?`<div class="view-links">${route('/people/claim-allowances','Kebijakan plafon klaim')}${route('/people/claim-types','Jenis klaim')}</div>`:''}`,'',localTabs());
}
function payroll(){
  const oneoffs=state.path===p.oneoffs;
  const status={DRAFT:'Draft',SUBMITTED:'Submitted',APPROVED:'Approved'}[state.payroll];
  return page(oneoffs?'One-offs':'Payroll','Unit menyiapkan dan mengajukan; HR pusat memutuskan; Finance menerima kewajiban.',scope()+`<div class="stage-line"><span class="${state.payroll==='DRAFT'?'stage-active':''}">Draft</span><span>→</span><span class="${state.payroll==='SUBMITTED'?'stage-active':''}">Submitted</span><span>→</span><span class="${state.payroll==='APPROVED'?'stage-active':''}">Approved</span><span>→</span><span class="${state.handover?'stage-active':''}">Finance menerima</span></div>${oneoffs?`<div class="context-note">One-offs adalah input satu periode. Contoh insentif Rp 250.000 dan cicilan pinjaman Rp 100.000 ditelusuri terpisah; angka run di bawah adalah fixture, bukan hasil perhitungan input ini.</div>`:''}<div class="work-list">${workRow(records.run.id,`${records.run.period} · Bandung · ${state.evidence?'sumber input sudah direview':'sumber input belum lengkap'}`,state.handover?'Diterima Finance · belum dibayar':status,'Buka run','run-detail')}</div><section class="section"><div class="section-title"><h2>Input dan keluaran</h2></div><div class="view-links">${route(p.attendance,'Sumber presensi')}${route(p.oneoffs,'One-offs')}${route(p.payroll,'Payroll runs')}${actors[state.actor].role==='employer'?route('/people/tax-report','Laporan pajak & BPJS'):''}</div></section><div class="decision-note">Mengajukan, menyetujui, menyerahkan kewajiban, dan membayar adalah tindakan terpisah. Tahap verify/seal dari prototype HR lama tidak dipakai pada rancangan ini.</div>`,'',localTabs());
}
function reports(){
  return page('Laporan HR','Analisis lintas pekerjaan dan keluaran khusus; dokumen pajak tetap memakai formatnya sendiri.',scope()+`<section class="section"><div class="section-title"><h2>Analisis</h2></div><div class="route-grid"><button class="area-card" data-action="report-preview" data-report="workforce"><span><strong>Tenaga kerja</strong><small>Jumlah karyawan dan kontrak per unit</small></span>→</button><button class="area-card" data-action="report-preview" data-report="time"><span><strong>Waktu & ketidakhadiran</strong><small>Kelengkapan sumber sebelum membaca angka</small></span>→</button>${actors[state.actor].role==='employer'?'<button class="area-card" data-action="report-preview" data-report="cost"><span><strong>Biaya payroll</strong><small>Run, handover, dan status pembayaran</small></span>→</button>':''}</div></section>${actors[state.actor].role==='employer'?`<section class="section"><div class="section-title"><h2>Dokumen & pelaporan khusus</h2></div><div class="route-grid">${all.filter(i=>placement(i).owner==='reports'&&i.path!==p.reports).map(routeCard).join('')}</div></section>`:''}`);
}
function routeCard(i){return `<button class="area-card" data-route="${i.path}"><span><strong>${e(i.label)}</strong><small>${e(placement(i).section)}</small></span><span>→</span></button>`;}
function workspace(){
  const selected=paths.get(state.path),items=allowedItems().filter(i=>placement(i).owner===state.nav),sections=[...new Set(items.map(i=>placement(i).section))];
  const info=selected?`<div class="context-note"><strong>${e(selected.label)}</strong><br>${e(placement(selected).label)}<br><code>${e(selected.path)}</code><br>Preview penempatan. Isi halaman ini belum disimulasikan penuh.${selected.path==='/people/benefit'?'<br>Saldo belanja di kasir; bukan saldo cuti atau plafon klaim.':''}</div>`:'';
  const body=sections.map(s=>`<section class="section"><div class="section-title"><h2>${e(s)}</h2></div><div class="route-grid">${items.filter(i=>placement(i).section===s).map(i=>`<button class="area-card" data-action="inspect-route" data-path="${i.path}"><span><strong>${e(i.label)}</strong><small>${e(placement(i).method)}</small></span>→</button>`).join('')}</div></section>`).join('');
  return page(selected?.label||currentLabel(),state.nav==='settings'?'22 halaman setup dalam 5 kelompok. Hak akses mengikuti audience halaman asal.':'Halaman yang berdekatan berada di satu workspace; tindakan dan datanya tetap terpisah.',info+body,'',localTabs());
}
function directoryRows(items){return items.length?items.map(i=>`<div class="directory-row"><div><strong>${e(i.label)}</strong><small>${e(i.group)} · ${i.audience?'HR pusat':'Sesuai scope unit'}</small></div><div><span>${e(placement(i).label)}</span><small><code>${e(i.path)}</code></small></div>${button('Buka tujuan','open-route','quiet',`data-path="${i.path}"`)}</div>`).join(''):'<p class="empty">Tidak ada halaman yang sesuai pencarian.</p>';}
function filtered(){const q=state.query.toLowerCase();return allowedItems().filter(i=>(state.group==='all'||i.group===state.group)&&`${i.label} ${i.path} ${i.group} ${placement(i).label}`.toLowerCase().includes(q));}
function catalog(){
  return page('Semua halaman HR','Nama lama, URL, dan lokasi baru tetap dapat ditemukan.',`<div class="toolbar"><input id="catalog-query" value="${e(state.query)}" placeholder="Cari halaman lama, pekerjaan, atau URL…" aria-label="Cari halaman HR"><select id="catalog-group" aria-label="Grup menu asal"><option value="all">Semua grup asal</option>${source.groups.filter(g=>g.items.some(permitted)).map(g=>`<option ${state.group===g.label?'selected':''}>${e(g.label)}</option>`).join('')}</select></div><div class="directory-count">${filtered().length} halaman sesuai pelaku · ${source.counts.total} deklarasi sumber sudah dipetakan · tidak ada More/hidden</div><div id="directory-results">${directoryRows(filtered())}</div><p class="helper" style="margin-top:24px">Audience employer-only dari sumber tetap dipertahankan. Pelaku demo ini mengubah presentasi, bukan otorisasi server.</p>`);
}
function restricted(){return page('Khusus HR pusat','Halaman ini memiliki audience employer pada menu asal.',`<div class="hidden-reason"><p>Pelaku demo saat ini adalah manager unit. Halaman tersebut tidak dimunculkan di menu maupun pencarian manager.</p>${button('Kembali ke Overview','home','primary')}</div>`);}
function render(){
  document.querySelectorAll('[data-scheme]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.scheme===state.scheme));
  document.getElementById('actor').value=state.actor;document.getElementById('scenario').value=state.scenario;
  document.getElementById('structure-summary').textContent=`${navs().length} workspace untuk pelaku ini · ${allowedItems().length} halaman sesuai scope · 44/44 dipetakan`;
  document.getElementById('avatar').textContent=actors[state.actor].name.slice(0,2).toUpperCase();sidebar();
  document.getElementById('main').innerHTML=({overview,employees,roster,leave,attendance,claims,payroll,reports,workspace,catalog,restricted})[state.page]();
  syncChrome();
}
function syncChrome(){document.documentElement.style.setProperty('--chrome',(document.querySelector('.prototype-bar').offsetHeight+document.querySelector('.experiment-bar').offsetHeight)+'px');}
let opener;
function dialog(title,body,foot=''){
  const d=document.getElementById('dialog');if(!d.open)opener=document.activeElement;
  d.innerHTML=`<header class="dialog-head"><h1 id="dialog-title">${e(title)}</h1>${button('Tutup','close-dialog')}</header><div class="dialog-body">${body}</div>${foot?`<footer class="dialog-foot">${foot}</footer>`:''}`;
  if(!d.open)d.showModal();d.scrollTop=0;
}
function closeDialog(){const d=document.getElementById('dialog');if(d.open)d.close();if(opener?.isConnected)opener.focus();}
function notify(text){const el=document.querySelector('.toast');el.textContent=text;el.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.hidden=true,4500);}
function changeActor(id){closeDialog();state.actor=id;state.history=[];state.group='all';state.query='';if(state.path){if(permitted(paths.get(state.path)))navigate(state.path,false);else selectNav('overview',false);}else if(state.nav==='settings'||state.page==='restricted')selectNav('overview',false);else render();}
function reasonField(id,label='Catatan keputusan'){return `<label class="field" for="${id}">${label} <em>*</em><textarea id="${id}" aria-required="true"></textarea></label><p class="error" id="decision-error" role="alert" hidden></p>`;}
function requireReason(id){const value=document.getElementById(id)?.value.trim();if(!value){const error=document.getElementById('decision-error');if(error){error.textContent='Isi catatan agar keputusan dapat ditelusuri.';error.hidden=false;}document.getElementById(id)?.focus();return null;}return value;}
function decision(kind,reason){state.decisions.push({kind,by:actors[state.actor].name,reason});}
function leaveDetail(){
  const r=records.leave;
  dialog(r.id,`<p class="notice">Pengajuan cuti · ${state.leaveApproved?'disetujui di demo':'menunggu keputusan'} · Bandung</p><dl class="facts"><div><dt>Karyawan</dt><dd>${r.name}</dd></div><div><dt>Tanggal</dt><dd>${r.from}–${r.to}</dd></div><div><dt>Dibebankan</dt><dd>2 hari · angka sumber contoh</dd></div><div><dt>Saldo</dt><dd>${state.leaveApproved?10:12} hari</dd></div></dl><div class="work-list"><div class="work-row"><div><strong>Cakupan shift</strong><small>${state.coverage?'Jadwal sudah direview oleh pelaku demo':'Jadwal tim belum direview'}</small></div>${button('Lihat jadwal','view-roster')}</div></div>${state.leaveApproved?'<div class="context-note">Keputusan tercatat. Kalender menandai cuti disetujui dan saldo contoh berubah menjadi 10 hari.</div>':`<p class="helper">Contoh keputusan unit dilakukan Budi, berbeda dari pemohon Dina.</p>${state.actor==='budi'?reasonField('leave-reason'):''}`}`,state.leaveApproved?button('Lihat kalender','view-roster','primary'):state.actor!=='budi'?button('Coba sebagai manager unit','act-budi-leave','primary'):button('Setujui cuti demo','approve-leave','primary',state.coverage?'':'disabled'));
}
function coverage(){dialog('Review cakupan shift',`<p>Pengajuan Dina memengaruhi jadwal 19–20 Oktober. Contoh ini mencatat konfirmasi review manager, bukan menghitung staffing otomatis.</p><label class="review-line"><input id="coverage-check" type="checkbox" ${state.coverage?'checked':''}>Saya sudah memeriksa kebutuhan shift dan rencana pengganti pada jadwal contoh.</label><p class="error" id="coverage-error" role="alert" hidden></p>`,button('Kembali','close-dialog')+button('Simpan review demo','save-coverage','primary'));}
function attendanceReview(){
  dialog('Periksa sumber presensi',`<p class="notice">Dina Putri · September 2026 · sumber awal belum lengkap</p><p>Contoh bukti: rekap manual yang dikonfirmasi supervisor. Tidak ada jam masuk/keluar baru yang dihasilkan oleh prototype.</p>${state.evidence?`<div class="context-note">Bukti sudah direview di demo.<br>${e(state.evidenceReason)}</div>`:`<label class="review-line"><input id="evidence-check" type="checkbox">Saya telah memeriksa rekap manual dan memahami kekurangan sumbernya.</label>${reasonField('evidence-reason','Dasar penyelesaian sumber')}`}`,state.evidence?button('Lanjut ke payroll','open-payroll','primary'):button('Tandai bukti direview di demo','save-evidence','primary'));
}
function runDetail(){
  const r=records.run,actor=actors[state.actor];
  const status={DRAFT:'Draft',SUBMITTED:'Submitted',APPROVED:'Approved'}[state.payroll];
  let action='';
  if(state.payroll==='DRAFT')action=state.actor==='budi'?button('Ajukan ke HR pusat','submit-payroll','primary',state.evidence?'':'disabled'):button('Coba sebagai manager unit','act-budi-payroll','primary');
  if(state.payroll==='SUBMITTED')action=actor.role==='employer'&&state.actor!==state.submitter?button('Setujui payroll demo','approve-payroll','primary'):button('Lanjut sebagai HR pusat · Maya','act-maya-payroll','primary');
  if(state.payroll==='APPROVED'&&!state.handover)action=actor.role==='employer'?button('Serahkan ke Finance demo','handover-payroll','primary'):button('Lanjut sebagai HR pusat · Maya','act-maya-payroll','primary');
  if(state.handover)action='<a class="button quiet" href="../finance-navigation/?v=workspace">Buka prototype Finance</a>';
  const canReason=(state.payroll==='DRAFT'&&state.actor==='budi')||(state.payroll==='SUBMITTED'&&actor.role==='employer'&&state.actor!==state.submitter)||(state.payroll==='APPROVED'&&actor.role==='employer'&&!state.handover);
  dialog(r.id,`<p class="notice">Bandung · ${r.period} · ${status}</p><dl class="facts"><div><dt>Gross (fixture)</dt><dd>${money(r.gross)}</dd></div><div><dt>Take-home pay (fixture)</dt><dd>${money(r.net)}</dd></div><div><dt>Diajukan oleh</dt><dd>${state.submitter?actors[state.submitter].name:'Belum diajukan'}</dd></div><div><dt>Disetujui oleh</dt><dd>${state.approver?actors[state.approver].name:'Belum disetujui'}</dd></div></dl>${!state.evidence?`<div class="decision-note">Sumber presensi belum lengkap. Pengajuan demo ditahan sampai bukti direview. ${route(p.attendance,'Periksa sumber presensi')}</div>`:''}${state.handover?'<div class="decision-note"><strong>Diterima Finance · belum dibayar.</strong><br>Serah terima kewajiban tidak menandai gaji telah dibayar. Pembayaran tetap pekerjaan Finance.</div>':canReason?reasonField('payroll-reason',state.payroll==='DRAFT'?'Alasan pengajuan':state.payroll==='SUBMITTED'?'Catatan persetujuan':'Alasan handover'):''}<p class="helper">Pelaku sekarang: ${e(actor.label)}. Pengaju tidak boleh menyetujui run sendiri. Nominal contoh tidak menghitung ulang gaji, pajak, atau BPJS.</p>`,button('Lihat daftar run','open-payroll')+action);
}
function claimDetail(){
  const c=records.claim;
  dialog(c.id,`<p class="notice">Klaim transport · Bandung · ${state.claimApproved?'disetujui, belum dibayar':'menunggu keputusan'}</p><dl class="facts"><div><dt>Pemohon</dt><dd>${c.name}</dd></div><div><dt>Jumlah klaim</dt><dd>${money(c.amount)}</dd></div><div><dt>Bukti</dt><dd>Nota transport contoh · sudah tersedia</dd></div><div><dt>Sisa plafon sebelum klaim</dt><dd>${money(1200000)} · fixture reimbursement</dd></div></dl><div class="decision-note">Plafon reimbursement ini berbeda dari saldo benefit belanja di kasir. Persetujuan tidak otomatis menjadi pembayaran atau komponen payroll.</div>${state.claimApproved?`<p>Disetujui oleh ${e(state.claimApprover)}. Status pembayaran: <strong>belum dibayar</strong>.</p>`:state.actor==='budi'?`<label class="review-line"><input id="claim-proof" type="checkbox">Saya sudah memeriksa bukti dan plafon klaim.</label>${reasonField('claim-reason')}`:''}`,state.claimApproved?button('Kembali ke daftar klaim','open-claims','primary'):state.actor==='budi'?button('Setujui klaim demo','approve-claim','primary'):button('Coba sebagai manager unit','act-budi-claim','primary'));
}
function inspectRoute(path){
  const i=paths.get(path);if(!permitted(i)){closeDialog();navigate(path);return;}
  const m=placement(i);
  dialog(i.label,`<p class="notice">Preview penempatan. Isi halaman ini belum disimulasikan penuh.</p><dl class="facts"><div><dt>Grup asal</dt><dd>${e(i.group)}</dd></div><div><dt>Workspace tujuan</dt><dd>${e(m.label)}</dd></div><div><dt>Perlakuan</dt><dd>${e(m.method)}</dd></div><div><dt>Audience asal</dt><dd>${i.audience?'HR pusat (employer)':'Sesuai scope unit'}</dd></div></dl><code>${e(path)}</code>${i.moved.length?`<p class="helper">Alias URL: ${i.moved.map(e).join(', ')}. Perlu dipertahankan saat migrasi.</p>`:''}`,button('Buka workspace tujuan','route-parent','primary',`data-path="${path}"`));
}
function rationale(){
  dialog('HR: kurangi pilihan, pertahankan pekerjaan',`<p><strong>44 halaman = 23 operasional + 21 pengaturan pada menu sekarang.</strong> Setup yang selalu muncul membuat pekerjaan harian terlihat lebih besar dari yang perlu dipilih.</p><div class="table-wrap"><table><thead><tr><th>Workspace</th><th>Isi</th><th class="num">Halaman asal</th></tr></thead><tbody>${baseNav.map(([id,label])=>`<tr><td>${label}</td><td>${e(descriptions[id]||'Antrean pengajuan dan pengecualian')}</td><td class="num">${all.filter(i=>mapping[i.path].owner===id).length}</td></tr>`).join('')}</tbody></table></div><p>Usulan memindahkan Claim Allowances ke Pengaturan karena itu kebijakan plafon. Tax & BPJS Report dan 1721-A1 berada di Laporan; keduanya tetap dokumen dengan route dan format berbeda.</p><h2>7 atau 8 pintu?</h2><p><strong>7 sebagai fondasi:</strong> jadwal, presensi, cuti, lembur, dan kalender tim berada di Waktu kerja. <strong>8 jika tim sering mengelola pengajuan tersendiri:</strong> pisahkan Cuti & lembur. Tidak perlu memindahkan halaman lagi; hanya alamat masuknya.</p><h2>Batas yang dipertahankan</h2><ul><li>Manager unit tetap punya Payroll runs dan One-offs sesuai menu sumber sekarang.</li><li>28 halaman employer-only tidak muncul pada menu/pencarian manager; 16 halaman tetap bisa ditemukan.</li><li>Saldo benefit belanja, plafon reimbursement, saldo cuti, dan pinjaman bukan satu saldo.</li><li>Overview adalah antrean; arsip lengkap tetap berada di workspace masing-masing.</li><li>HR mengajukan/menyetujui payroll; status diterima Finance bukan status dibayar.</li></ul><p class="notice">Ini rancangan navigasi dan simulasi lokal. Tidak mengubah kebijakan HR, hak server, atau menu produksi.</p>`,button('Coba 7 workspace','choose-compact','primary'));
}
function search(){dialog('Cari HR',`<input id="global-query" class="search-input" placeholder="Cari halaman atau pekerjaan…" aria-label="Cari HR"><div id="search-results"></div>`,`<span class="muted">${allowedItems().length} halaman sesuai pelaku · Escape untuk kembali</span>`);updateSearch('');document.getElementById('global-query').focus();}
function updateSearch(q){const items=allowedItems().filter(i=>`${i.label} ${i.path} ${placement(i).label}`.toLowerCase().includes(q.toLowerCase()));document.getElementById('search-results').innerHTML=items.map(i=>`<button class="search-result" data-route="${i.path}"><span>${e(i.label)}<small>${e(placement(i).label)}</small></span><span>↵</span></button>`).join('')||'<p class="empty">Tidak ada hasil untuk pelaku ini.</p>';}
function changeScheme(s){state.scheme=s;state.history=[];const url=new URL(location.href);url.searchParams.set('scheme',s);history.replaceState(null,'',url);if(state.path)navigate(state.path,false);else if(state.nav==='catalog')render();else if(state.nav==='leave'&&s==='compact')selectNav('time',false);else render();}
function startScenario(s){closeDialog();state.scenario=s;if(s==='leave')navigate(p.leave);else if(s==='payroll')navigate(p.attendance);else if(s==='claim')navigate(p.claim);else render();}
const handlers={
  'home':()=>selectNav('overview'),'menu':()=>document.querySelector('.app').classList.toggle('menu-open'),'search':search,'close-dialog':closeDialog,
  'rationale':rationale,'choose-compact':()=>{closeDialog();changeScheme('compact');},
  'leave-detail':leaveDetail,'view-roster':()=>{closeDialog();navigate(p.roster);},'coverage':coverage,
  'save-coverage':()=>{if(!document.getElementById('coverage-check').checked){document.getElementById('coverage-error').textContent='Konfirmasikan review cakupan shift dahulu.';document.getElementById('coverage-error').hidden=false;return;}state.coverage=true;closeDialog();render();notify('Review jadwal contoh dicatat. Pengajuan cuti belum diputuskan.');},
  'act-budi-leave':()=>{changeActor('budi');leaveDetail();},
  'approve-leave':()=>{if(state.actor!=='budi'||!state.coverage||state.leaveApproved)return;const reason=requireReason('leave-reason');if(!reason)return;state.leaveApproved=true;decision('Cuti disetujui',reason);render();leaveDetail();},
  'open-attendance':()=>{closeDialog();navigate(p.attendance);},'attendance-review':attendanceReview,
  'attendance-example':()=>dialog('Rekap Ari · September',`<p>Rekap sumber contoh tersedia. Tidak ada punch baru yang dihasilkan; tampilan ini hanya menunjukkan lokasi eksplorasi karyawan → sumber presensi.</p>`,button('Tutup','close-dialog')),
  'save-evidence':()=>{if(!document.getElementById('evidence-check').checked){document.getElementById('decision-error').textContent='Periksa bukti rekap manual terlebih dahulu.';document.getElementById('decision-error').hidden=false;return;}const reason=requireReason('evidence-reason');if(!reason)return;state.evidence=true;state.evidenceReason=reason;decision('Review sumber presensi',reason);closeDialog();render();notify('Bukti direview di data demo; tidak ada punch baru dibuat.');},
  'open-payroll':()=>{closeDialog();navigate(p.payroll);},'run-detail':runDetail,
  'act-budi-payroll':()=>{changeActor('budi');runDetail();},'act-maya-payroll':()=>{changeActor('maya');runDetail();},
  'submit-payroll':()=>{if(state.actor!=='budi'||state.payroll!=='DRAFT'||!state.evidence)return;const reason=requireReason('payroll-reason');if(!reason)return;state.payroll='SUBMITTED';state.submitter=state.actor;decision('Payroll diajukan',reason);render();runDetail();},
  'approve-payroll':()=>{if(actors[state.actor].role!=='employer'||state.actor===state.submitter||state.payroll!=='SUBMITTED')return;const reason=requireReason('payroll-reason');if(!reason)return;state.payroll='APPROVED';state.approver=state.actor;decision('Payroll disetujui',reason);render();runDetail();},
  'handover-payroll':()=>{if(actors[state.actor].role!=='employer'||state.payroll!=='APPROVED'||state.handover)return;const reason=requireReason('payroll-reason');if(!reason)return;dialog('Konfirmasi handover Finance',`<p>Serahkan kewajiban payroll ${records.run.id} kepada Finance pada data demo?</p><p class="helper">Status setelahnya: diterima Finance, belum dibayar. Koreksi produksi setelah handover perlu koordinasi dengan Finance.</p>`,button('Cancel','run-detail','danger')+button('Konfirmasi handover demo','confirm-handover','primary',`data-reason="${e(reason)}"`));},
  'confirm-handover':el=>{if(actors[state.actor].role!=='employer'||state.payroll!=='APPROVED'||state.handover)return;state.handover=true;decision('Diserahkan ke Finance',el.dataset.reason);render();runDetail();},
  'claim-detail':claimDetail,'act-budi-claim':()=>{changeActor('budi');claimDetail();},
  'approve-claim':()=>{if(state.actor!=='budi'||state.claimApproved)return;if(!document.getElementById('claim-proof').checked){document.getElementById('decision-error').textContent='Periksa bukti dan plafon klaim dahulu.';document.getElementById('decision-error').hidden=false;return;}const reason=requireReason('claim-reason');if(!reason)return;state.claimApproved=true;state.claimApprover=actors[state.actor].name;decision('Klaim disetujui',reason);render();claimDetail();},
  'open-claims':()=>{closeDialog();navigate(p.claim);},
  'employee-detail':el=>dialog(el.dataset.name,`<p class="notice">Record karyawan · Bandung · fixture</p><div class="route-grid">${[p.leave,p.attendance,'/people/onboarding','/people/offboarding','/people/invitations',p.claim,...(actors[state.actor].role==='employer'?['/people/changes','/people/reprimands']:[])].map(path=>routeCard(paths.get(path))).join('')}</div><p class="helper" style="margin-top:20px">Akun dan pencabutan akses ditelusuri dari lifecycle karyawan. Eksekusi grant tetap pekerjaan System.</p>`,button('Kembali','close-dialog')),
  'report-preview':el=>{const kind=el.dataset.report;const title={workforce:'Tenaga kerja',time:'Waktu & ketidakhadiran',cost:'Biaya payroll'}[kind];if(kind==='cost'&&actors[state.actor].role!=='employer')return;dialog(title,kind==='workforce'?'<p>Bandung · 3 karyawan fiktif pada contoh navigasi ini.</p>'+route(p.employees,'Buka direktori'):kind==='time'?`<p>September · ${state.evidence?'sumber presensi direview di demo':'sumber presensi belum lengkap; tidak ditampilkan sebagai nol ketidakhadiran'}.</p>${route(p.attendance,'Periksa sumber')}`:`<p>Gross fixture ${money(records.run.gross)} · ${state.handover?'diterima Finance, belum dibayar':state.payroll==='APPROVED'?'disetujui, belum diserahkan':'belum disetujui'}.</p>${route(p.payroll,'Buka run')}`,button('Tutup','close-dialog'));},
  'inspect-route':el=>inspectRoute(el.dataset.path),'open-route':el=>{closeDialog();navigate(el.dataset.path);},'route-parent':el=>{const owner=placement(paths.get(el.dataset.path)).owner;closeDialog();selectNav(owner);},
  'exit-scenario':()=>{state.scenario='';render();},
  'back':()=>{const prev=state.history.pop();if(!prev)return;const {scroll,windowScroll,...location}=prev;Object.assign(state,location);render();document.getElementById('main').scrollTop=scroll;scrollTo(0,windowScroll);},
  'reset':()=>dialog('Reset contoh HR',`<p>Kembalikan pengajuan, saldo cuti, review sumber, klaim, dan payroll ke kondisi awal demo?</p>`,button('Kembali','close-dialog')+button('Reset data demo','confirm-reset','primary')),
  'confirm-reset':()=>{state.leaveApproved=false;state.coverage=false;state.evidence=false;state.evidenceReason='';state.payroll='DRAFT';state.submitter=null;state.approver=null;state.handover=false;state.claimApproved=false;state.claimApprover=null;state.decisions=[];closeDialog();render();notify('Data contoh HR dikembalikan ke awal.');}
};
document.addEventListener('click',event=>{
  const scheme=event.target.closest('[data-scheme]');if(scheme){changeScheme(scheme.dataset.scheme);return;}
  const nav=event.target.closest('[data-nav]');if(nav){if(nav.dataset.nav==='settings'&&actors[state.actor].role!=='employer')return;selectNav(nav.dataset.nav);return;}
  const path=event.target.closest('[data-route]');if(path){closeDialog();navigate(path.dataset.route);return;}
  const action=event.target.closest('[data-action]');if(action&&!action.disabled)handlers[action.dataset.action]?.(action);
});
document.addEventListener('change',event=>{
  const el=event.target;if(el.id==='actor')changeActor(el.value);if(el.id==='scenario')startScenario(el.value);if(el.id==='catalog-group'){state.group=el.value;render();}
});
document.addEventListener('input',event=>{
  const el=event.target;if(el.id==='global-query')updateSearch(el.value);if(el.id==='catalog-query'){state.query=el.value;document.getElementById('directory-results').innerHTML=directoryRows(filtered());document.querySelector('.directory-count').textContent=`${filtered().length} halaman ditemukan · ${allowedItems().length} halaman sesuai pelaku`;}
});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search();}});
document.getElementById('dialog').addEventListener('click',event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();}});
window.addEventListener('resize',syncChrome);
window.hrPrototype={state,source,all,mapping,placement,actors,navs,allowedItems,navigate};
selectNav('overview',false);
