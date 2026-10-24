import {seed,extendDemoRoster,total,pcs,leftOf,left,toPick,ready,openBoxes,getStore,getBox,assertState,createBox,move,seal,reopen,recordPick,dispatch} from './pack-workflow-model.mjs';

const KEY='itulah.pack-workflow-prototypes.v1';
const $=s=>document.querySelector(s);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search);
let storeCount=params.get('stores')==='30'?30:13;
const storageKey=()=>storeCount===13?KEY:KEY+'.30-stores';
function readDemo() {
  try {const stored=JSON.parse(localStorage.getItem(storageKey()));if(stored?.version===1&&assertState(stored)){extendDemoRoster(stored,storeCount);assertState(stored);return stored;}} catch {}
  return seed(storeCount);
}
let state=readDemo();
let view=['A','B','C','D'].includes(params.get('v'))?params.get('v'):'A';
let stage=['pick','pack','dispatch'].includes(params.get('stage'))?params.get('stage'):'pack';
let chosen=state.stores.some(s=>s.id===params.get('store'))?params.get('store'):'c001';
let expanded=chosen,query='',active={},selected=new Set(),dispatchTab=params.get('tab')==='transit'?'transit':'ready',dialog=null,undoState=null,toastTimer;
let tripNote='B 9124 SCA · Andi Pratama';
let lastFocus=null;
let storeFilter='all',navScroll=0,revealChosen=false;
const versions={
  A:{name:'Per tahap',title:'Tahap → toko → koli',note:'Pilih tahap kerja dulu, lalu toko dan kolinya. Cocok untuk tim yang fokus di Pick saja atau Pack saja.',label:'A · Kerja per tahap'},
  B:{name:'Tumpukan toko',title:'Semua toko, isi koli bisa dibuka',note:'Lanjutan T10: lihat semua toko sekaligus, buka satu toko untuk pack, lalu cek isi setiap koli tanpa pindah halaman.',label:'Untuk pantau banyak toko'},
  C:{name:'Matriks koli',title:'SKU × koli, satu pandangan',note:'Angka per SKU terlihat di seluruh koli. Klik sel untuk tambah atau pindahkan; jumlah picked tetap menjadi batas.',label:'Untuk cek pembagian SKU'},
  D:{name:'Per toko',title:'Toko → Pick/Pack → koli',note:'Pilih toko dulu, lalu kerjakan Pick dan Pack di toko itu. Dispatch tetap menggabungkan koli lintas toko.',label:'D · Kerja per toko'}
};
const paths={box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4z"/><path d="m3 7 9 4 9-4M12 11v10M7.5 5l9 4"/>',pick:'<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',truck:'<path d="M3 6h11v10H3zM14 10h4l3 4v2h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',check:'<path d="m5 12 4 4L19 6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',left:'<path d="M20 12H4m6-6-6 6 6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',chevron:'<path d="m9 5 7 7-7 7"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',undo:'<path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14"/>',print:'<path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7z"/>',store:'<path d="M4 10v10h16V10M3 5h18l-2 5H5zM9 20v-7h6v7"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.box}</svg>`;
const btn=(text,action,data='',kind='ghost',disabled=false)=>`<button type="button" class="ds-btn ds-btn--${kind}" data-action="${action}" ${data} ${disabled?'disabled':''}>${text}</button>`;
const sdata=s=>`data-store="${s.id}"`;
const kdata=(s,b)=>`${sdata(s)} data-box="${b.id}"`;
const cur=()=>getStore(state,chosen);
const chosenBox=s=>{ const b=s.boxes.find(b=>b.id===active[s.id]); return b || openBoxes(s)[0] || s.boxes.find(b=>!b.trip) || s.boxes[0] || null; };
const destination=s=>{const b=chosenBox(s);return b&&!b.sealed&&!b.trip?b.id:openBoxes(s)[0]?.id||'new';};
const totalPicked=s=>total(s.items.map(i=>i.picked));
const status=b=>b.trip?`<span class="status transit"><i class="dot"></i>In transit</span>`:b.sealed?`<span class="status sealed"><i class="dot"></i>Sealed</span>`:`<span class="status open"><i class="dot"></i>Open</span>`;
function garment(i) {
  const drawing=i.kind==='shoe'?'<path d="M3 19h27v-6l-12-3-6-7-4 2-2 7-3 3z"/>':i.kind==='pants'?'<path d="M8 4h18l2 29H17l-1-18-2 18H5z"/><path d="M8 8h18M16 8v7" fill="none"/>':i.kind==='shirt'?'<path d="m10 5 7 3 7-3 8 6-5 7-4-2v18H11V16l-4 2-5-7z"/><path d="m10 5 7 8 7-8M17 13v21" fill="none"/>':'<path d="m10 5 7 3 7-3 8 6-5 7-4-2v18H11V16l-4 2-5-7z"/>';
  return `<span class="product-thumb" aria-hidden="true"><svg viewBox="0 0 34 39" fill="${i.color}" stroke="color-mix(in srgb, ${i.color}, #1d1d1f 18%)" stroke-width="1.2" stroke-linejoin="round">${drawing}</svg></span>`;
}
const skuCopy=i=>`<div class="sku-copy"><b>${esc(i.name)}</b><span>${esc(i.variant)}</span></div>`;
function itemRow(s,i,q,end='') {return `<div class="sku-row">${garment(i)}${skuCopy(i)}<div class="sku-end"><span class="qty-value num">${q}</span>${end}</div></div>`;}
const empty=(title,sub='',name='box',action='')=>`<div class="empty">${icon(name)}<h3>${title}</h3>${sub?`<span>${sub}</span>`:''}${action}</div>`;
function counts(s) { return `<div class="store-facts"><div><b>${left(s)}</b><span>picked left</span></div><div><b>${total(openBoxes(s).map(pcs))}</b><span>in open koli</span></div><div><b>${ready(s).length}</b><span>sealed</span></div>${toPick(s)?`<div><b>${toPick(s)}</b><span>to pick</span></div>`:''}</div>`; }
function storeNext(s) {
  if(left(s)) return `<span class="warn">${left(s)} pcs to pack</span>`;
  if(openBoxes(s).some(b=>pcs(b))) return `<span class="warn">${openBoxes(s).filter(b=>pcs(b)).length} koli to seal</span>`;
  if(ready(s).length) return `<span class="okay">${ready(s).length} koli ready to dispatch</span>`;
  return toPick(s)?`<span class="muted">${toPick(s)} pcs to pick</span>`:`<span class="muted">${s.boxes.some(b=>b.trip)?'Dispatched':'No picked pieces'}</span>`;
}
const orderedStores=()=>[...state.stores].sort((a,b)=>a.code.localeCompare(b.code));
const pendingStore=s=>stage==='pick'?toPick(s)>0:left(s)>0||openBoxes(s).some(b=>pcs(b)>0);
const matchingStores=()=>orderedStores().filter(s=>(storeFilter==='all'||pendingStore(s))&&`${s.code} ${s.name}`.toLowerCase().includes(query.toLowerCase()));
function compactStoreStatus(s) {
  if(stage==='pick') return toPick(s)?`<span class="warn">${toPick(s)} pcs to pick</span>`:'<span class="okay">Picking complete</span>';
  if(left(s)) return `<span class="warn">${left(s)} pcs to pack</span>`;
  const open=openBoxes(s).filter(b=>pcs(b)).length;
  if(open) return `<span class="warn">${open} koli to seal</span>`;
  if(ready(s).length) return `<span class="okay">${ready(s).length} sealed</span>`;
  return `<span class="muted">${toPick(s)?'Waiting for pick':s.boxes.some(b=>b.trip)?'Dispatched':'No pending pack'}</span>`;
}
function storeButtons() {
  return matchingStores().map(s=>`<button type="button" class="store-button ${chosen===s.id?'on':''}" data-action="store" ${sdata(s)} aria-pressed="${chosen===s.id}"><span class="store-row-top"><span class="store-name" title="${esc(s.name)}">${s.name}</span><span class="store-code">${s.code}</span></span><span class="store-row-bottom">${compactStoreStatus(s)}<span class="muted nowrap">${s.boxes.length} koli</span></span></button>`).join('')||'<div class="empty">No stores found.</div>';
}
function storeNav() {
  const pending=state.stores.filter(pendingStore).length;
  return `<aside class="store-nav" aria-label="Store navigator"><div class="store-select"><label for="store-select">Store · ${state.stores.length} stores</label><select id="store-select" data-change="store">${orderedStores().map(s=>`<option value="${s.id}" ${chosen===s.id?'selected':''}>${s.code} · ${s.name} · ${stage==='pick'?toPick(s)+' to pick':left(s)+' to pack'}</option>`).join('')}</select></div><div class="store-nav-head"><h3>Stores</h3><span class="muted num">${state.stores.length}</span></div><label class="searchbox">${icon('search')}<input type="search" data-input="store-search" value="${esc(query)}" placeholder="Name or store code" aria-label="Find a store"></label><div class="store-filter" aria-label="Store work filter"><button data-action="store-filter" data-filter="all" class="${storeFilter==='all'?'on':''}" aria-pressed="${storeFilter==='all'}">All ${state.stores.length}</button><button data-action="store-filter" data-filter="pending" class="${storeFilter==='pending'?'on':''}" aria-pressed="${storeFilter==='pending'}">To ${stage==='pick'?'pick':'pack'} ${pending}</button></div><div class="store-list" id="store-list">${storeButtons()}</div><p class="store-caption" id="store-caption">${matchingStores().length} of ${state.stores.length} stores</p></aside>`;
}
function fitStoreNavigator() {
  const nav=$('.store-nav');if(!nav)return;
  const viewport=window.visualViewport?.height||innerHeight;
  const top=Math.max(16,nav.getBoundingClientRect().top);
  nav.style.setProperty('--navigator-height',`${Math.max(240,viewport-top-20)}px`);
}
function restoreStorePosition() {
  const list=$('#store-list');if(!list)return;
  list.scrollTop=navScroll;
  if(revealChosen){const row=list.querySelector(`[data-store="${chosen}"]`);if(row){const r=row.getBoundingClientRect(),bounds=list.getBoundingClientRect();if(r.top<bounds.top)list.scrollTop+=r.top-bounds.top;else if(r.bottom>bounds.bottom)list.scrollTop+=r.bottom-bounds.bottom;}}
  navScroll=list.scrollTop;revealChosen=false;
}
function storeHead(s) {return `<div class="store-heading"><div class="store-title"><h2>${s.code} · ${s.name}</h2><div class="subline">${s.alts.join(' · ')}</div></div>${stage==='pack'?btn(`${icon('plus')} Add koli`,'new-box',sdata(s)):''}</div>${counts(s)}`;}
function shelf(s) {
  const current=chosenBox(s);
  return `<div class="koli-shelf" aria-label="Koli for ${s.name}"><div class="shelf-tile picked"><span class="tile-top"><b>Picked</b>${icon('pick')}</span><span class="warn num">${left(s)} pcs left</span><span class="muted">Not in a koli</span></div>${s.boxes.map(b=>`<button class="shelf-tile ${current?.id===b.id?'selected':''}" data-action="select-box" ${kdata(s,b)} aria-pressed="${current?.id===b.id}"><span class="tile-top"><b>Koli ${b.no}</b>${icon(b.trip?'truck':b.sealed?'lock':'box')}</span><span class="num">${pcs(b)} pcs</span>${status(b)}</button>`).join('')}<button class="shelf-tile add" data-action="new-box" ${sdata(s)}>${icon('plus')}<span>Add koli</span></button></div>`;
}
function pickedPanel(s,{stack=false}={}) {
  const target=destination(s),t=target==='new'?null:getBox(s,target);
  const end=i=>`<button class="put-button" data-action="move-dialog" ${sdata(s)} data-source="picked" data-item="${i.id}" data-target="${target}" aria-label="Put ${esc(i.name)} ${esc(i.variant)} into koli">Put ${icon('arrow')}</button>`;
  return `<section class="panel"><header class="panel-head picked"><span class="panel-icon">${icon('pick')}</span><div class="grow"><h3>Picked</h3><span class="muted">${left(s)} pcs not in a koli</span></div></header>${s.items.filter(i=>leftOf(s,i.id)>0).map(i=>itemRow(s,i,leftOf(s,i.id),end(i))).join('')||empty('All picked pieces are in koli',toPick(s)?`${toPick(s)} pcs still to pick`:'Nothing left to pack','check')}${left(s)?`<footer class="panel-foot"><span class="muted">To ${t?`Koli ${t.no}`:'a new koli'}</span>${btn(`Put all ${left(s)} ${icon('arrow')}`,'put-all',`${sdata(s)} data-target="${target}"`,'primary')}</footer>`:''}</section>`;
}
function targetPanel(s,b) {
  if(!b) return `<section class="panel"><header class="panel-head target"><span class="panel-icon">${icon('box')}</span><h3>First koli</h3></header>${empty('No koli yet','Put picked pieces into the first koli.','box',btn(`${icon('plus')} Add koli`,'new-box',sdata(s)))}</section>`;
  return `<section class="panel"><header class="panel-head ${!b.sealed?'target':''}"><span class="panel-icon">${icon(b.trip?'truck':b.sealed?'lock':'box')}</span><div class="grow"><h3>Koli ${b.no} <span class="muted">· ${pcs(b)} pcs</span></h3><span class="muted">${b.id}</span></div>${status(b)}</header>${s.items.filter(i=>b.items[i.id]).map(i=>itemRow(s,i,b.items[i.id],!b.sealed&&!b.trip?`<button class="icon-button" data-action="move-dialog" ${kdata(s,b)} data-source="${b.id}" data-item="${i.id}" data-target="picked" aria-label="Move ${esc(i.name)} ${esc(i.variant)} out of Koli ${b.no}">${icon('left')}</button>`:'')).join('')||empty('This koli is empty','Choose a picked SKU to add.')}<footer class="panel-foot">${b.trip?`<span class="muted">${b.trip}</span>${btn(`${icon('print')} View label`,'label',kdata(s,b))}`:b.sealed?`${btn(`${icon('undo')} Reopen`,'reopen',kdata(s,b))}${btn(`${icon('print')} View label`,'label',kdata(s,b))}`:`<span class="muted">${Object.keys(b.items).length} SKU</span>${btn(`${icon('lock')} Seal koli ${b.no}`,'seal-dialog',kdata(s,b),'ghost',!pcs(b))}`}</footer></section>`;
}
function packFooter(s,flow=false) {
  const pending=left(s) || total(openBoxes(s).map(pcs));
  const next=state.stores.find(s2=>s2.id!==s.id && (left(s2)||openBoxes(s2).some(b=>pcs(b))));
  return `<div class="bench-footer"><span class="hint">${icon('check')}Saved in this browser</span>${flow?btn(`${icon('left')} Pick`,'stage','data-stage="pick"'):next?btn(`Next store ${icon('chevron')}`,'store',sdata(next)):''}${btn(`${ready(s).length} sealed · Review dispatch ${icon('arrow')}`,'review-dispatch',sdata(s),'ghost',!ready(s).length)}</div>${!pending?`<div class="store-finish"><div class="row-flex">${icon('check')}<div><b>${toPick(s)?'Available pieces packed':'All picked pieces packed'}</b><div class="muted">${ready(s).length} sealed koli${toPick(s)?` · ${toPick(s)} pcs still to pick`:''}</div></div></div>${ready(s).length?btn('Go to dispatch','review-dispatch',sdata(s),'primary'):''}</div>`:''}`;
}
function bench(s,flow=false) {return `${shelf(s)}<div class="bench">${pickedPanel(s)}${targetPanel(s,chosenBox(s))}</div>${packFooter(s,flow)}`;}
function stackKoli(s,b) {
  const current=chosenBox(s)?.id===b.id;
  return `<section class="koli-stack-card" ${current?'style="border-color:var(--accent)"':''}><header class="koli-stack-head">${icon(b.sealed?'lock':'box')}<div class="grow"><b>Koli ${b.no} · ${pcs(b)} pcs</b><span class="muted">${b.id}</span></div>${status(b)}<div class="stack-actions">${!b.sealed?btn('Use this koli','select-box',kdata(s,b),'ghost',current):''}${!b.sealed?btn('Seal','seal-dialog',kdata(s,b),'ghost',!pcs(b)):!b.trip?btn('Reopen','reopen',kdata(s,b)):''}${btn(icon('print'),'label',`${kdata(s,b)} aria-label="View Koli ${b.no} label"`)}</div></header><div class="koli-stack-body">${s.items.filter(i=>b.items[i.id]).map(i=>`<span class="content-token"><span><b>${esc(i.name)}</b><br><span class="muted">${i.variant} · <b>${b.items[i.id]} pcs</b></span></span>${!b.sealed?`<button class="icon-button" data-action="move-dialog" ${sdata(s)} data-source="${b.id}" data-item="${i.id}" data-target="picked" aria-label="Move ${esc(i.name)} ${esc(i.variant)} out of Koli ${b.no}">${icon('left')}</button>`:''}</span>`).join('')||'<span class="muted">Empty koli</span>'}</div></section>`;
}
function overview() {
  const stores=state.stores.filter(s=>`${s.code} ${s.name}`.toLowerCase().includes(query.toLowerCase()));
  return `<div class="overview-toolbar"><label class="searchbox">${icon('search')}<input type="search" data-input="overview-search" value="${esc(query)}" placeholder="Find a store" aria-label="Find a store"></label><span class="muted">${stores.length} stores · ${total(stores.map(left))} pcs to pack</span></div><div class="store-stack" id="overview-stores">${overviewGroups(stores)}</div>`;
}
function overviewGroups(stores) {
  return stores.map(s=>`<section class="store-group ${expanded===s.id?'expanded':''}"><header class="store-group-head"><button class="store-expand" data-action="expand-store" ${sdata(s)} aria-expanded="${expanded===s.id}">${icon('chevron')}<span class="stack"><b>${s.code} · ${s.name}</b><span class="muted">${s.alts.join(' · ')}</span></span></button><div class="store-overview-counts"><span class="warn"><b>${left(s)}</b> picked</span><span><b>${s.boxes.length}</b> koli</span><span class="okay"><b>${ready(s).length}</b> sealed</span></div>${btn(expanded===s.id?'Close workspace':'Open workspace','expand-store',sdata(s))}</header><div class="mini-shelf"><span class="mini-box warn">${icon('pick')}Picked · <b>${left(s)}</b></span>${s.boxes.map(b=>`<button class="mini-box ${expanded===s.id&&chosenBox(s)?.id===b.id?'chosen':''}" data-action="overview-box" ${kdata(s,b)}>${icon(b.trip?'truck':b.sealed?'lock':'box')}Koli ${b.no} · <b>${pcs(b)}</b></button>`).join('')}${btn(`${icon('plus')} Add koli`,'new-box',sdata(s))}</div>${expanded===s.id?`<div class="inline-work"><div class="between" style="margin-bottom:12px"><span class="muted">Pack into</span><select class="destination-select" data-change="target" ${sdata(s)} aria-label="Destination koli for ${s.name}"><option value="new">New koli</option>${openBoxes(s).map(b=>`<option value="${b.id}" ${destination(s)===b.id?'selected':''}>Koli ${b.no} · ${pcs(b)} pcs</option>`).join('')}</select></div><div class="stack-work">${pickedPanel(s,{stack:true})}<div class="koli-stack">${s.boxes.map(b=>stackKoli(s,b)).join('')||empty('No koli yet','The first transfer creates Koli 1.')}</div></div>${packFooter(s)}</div>`:''}</section>`).join('')||empty('No stores found','Try a different store name.','store');
}
function matrixView(s) {
  const table=`<div class="matrix-scroll"><table class="matrix"><thead><tr><th><div class="stack"><span>Article / SKU</span><span>${s.items.length} SKU</span></div></th><th class="picked-column">Picked left</th>${s.boxes.map(b=>`<th><div class="stack"><b>Koli ${b.no}</b>${status(b)}${!b.sealed?btn('Seal','seal-dialog',kdata(s,b),'ghost',!pcs(b)):btn('View','label',kdata(s,b))}</div></th>`).join('')}<th>Total picked</th></tr></thead><tbody>${s.items.map(i=>`<tr><td><div class="row-flex">${garment(i)}${skuCopy(i)}</div></td><td class="picked-column"><b>${leftOf(s,i.id)}</b></td>${s.boxes.map(b=>`<td>${!b.sealed?`<button class="cell-button" data-action="cell" ${kdata(s,b)} data-item="${i.id}" aria-label="Edit ${esc(i.name)} ${esc(i.variant)} in Koli ${b.no}">${b.items[i.id]||'+'}</button>`:`<span class="${!b.items[i.id]?'muted':''}">${b.items[i.id]||'—'}</span>`}</td>`).join('')}<td>${i.picked}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total pieces</td><td class="picked-column">${left(s)}</td>${s.boxes.map(b=>`<td>${pcs(b)}</td>`).join('')}<td>${totalPicked(s)}</td></tr></tfoot></table></div>`;
  return `<div class="matrix-toolbar"><span class="muted">Click an open koli cell to add or move pieces.</span>${btn(`${icon('plus')} Add koli column`,'new-box',sdata(s))}</div><div class="matrix-desktop">${table}</div><div class="matrix-mobile">${s.items.map(i=>`<div class="matrix-mobile-card"><div class="row-flex">${garment(i)}${skuCopy(i)}<b>${i.picked} picked</b></div><div class="matrix-mobile-values"><span class="warn">Picked <b>${leftOf(s,i.id)}</b></span>${s.boxes.map(b=>!b.sealed?`<button data-action="cell" ${kdata(s,b)} data-item="${i.id}">Koli ${b.no} <b>${b.items[i.id]||'+'}</b></button>`:`<span>${icon(b.trip?'truck':'lock')}Koli ${b.no} <b>${b.items[i.id]||'—'}</b></span>`).join('')}</div></div>`).join('')}</div><div class="matrix-legend"><span>${icon('lock')}Sealed koli are read-only</span><span>${icon('pick')}Picked left + all koli = total picked</span></div>${packFooter(s)}`;
}
function pickView(s,flow=false) {
  const waiting=s.items.filter(i=>i.target>i.picked);
  return `<div class="flow-intro"><span class="stage-icon">${icon('pick')}</span><div><h3>${toPick(s)?`${toPick(s)} pcs left to pick`:'All pieces picked'}</h3><p>${left(s)} picked pcs already available for packing</p></div></div><form id="pick-form" ${sdata(s)}><div class="pick-list"><div class="pick-table-head"><span>Article / SKU</span><div class="pick-columns"><span class="pick-number">Target</span><span class="pick-number">Picked</span><span class="pick-number">Pick now</span></div></div>${s.items.map(i=>`<div class="sku-row">${garment(i)}${skuCopy(i)}<div class="pick-columns"><span class="pick-number num"><label>Target</label>${i.target}</span><span class="pick-number num"><label>Picked</label>${i.picked}</span><span class="pick-number"><label for="pick-${s.id}-${i.id}">Pick now</label>${i.target>i.picked?`<input class="pick-input" id="pick-${s.id}-${i.id}" type="number" min="0" max="${i.target-i.picked}" step="1" value="${i.target-i.picked}" name="${i.id}" aria-label="Pick ${esc(i.name)} ${esc(i.variant)}" required>`:icon('check')}</span></div></div>`).join('')}<div class="pick-all-row"><span class="muted">${s.alts.length} allotment${s.alts.length>1?'s':''} · ${s.items.length} SKU</span>${waiting.length?btn('Record picked & pack '+icon('arrow'),'record-pick',sdata(s),'primary'):btn('Go to pack '+icon('arrow'),'stage','data-stage="pack"','primary')}</div></div><p class="inline-error" id="pick-error" role="alert"></p></form><div class="flow-bottom"><span class="muted">${ready(s).length} koli sealed · ${total(openBoxes(s).map(pcs))} pcs in open koli</span>${btn(`Pack available ${left(s)} pcs ${icon('arrow')}`,'stage','data-stage="pack"','ghost',!left(s))}</div>`;
}
function flowNav(s) {
  const rows=[['pick','1','Pick',`${toPick(s)} pcs left`],['pack','2','Pack',`${left(s)} pcs left`],['dispatch','3','Dispatch',`${total(state.stores.map(s=>ready(s).length))} koli · all stores`]];
  return `<nav class="flow-nav" aria-label="Store workflow">${rows.map(([id,no,title,desc])=>`<button class="flow-step ${stage===id?'on':''}" data-action="stage" data-stage="${id}" aria-current="${stage===id?'step':'false'}"><span class="step-no">${no}</span><span><b>${title}</b><span class="muted">${desc}</span></span></button>`).join('')}</nav>`;
}
function dispatchView(scope=null) {
  const stores=scope?[scope]:state.stores;
  const possible=stores.flatMap(s=>ready(s));
  selected=new Set([...selected].filter(id=>possible.some(b=>b.id===id)));
  const groups=stores.filter(s=>ready(s).length || left(s) || openBoxes(s).length);
  const selectedBoxes=possible.filter(b=>selected.has(b.id));
  return `<div class="section-heading"><h2>${dispatchTab==='ready'?'Sealed koli · all stores':'Trips · all stores'}</h2><span class="muted">${stores.length} stores</span></div><div class="subtabs"><button data-action="dispatch-tab" data-tab="ready" class="${dispatchTab==='ready'?'on':''}">At warehouse · ${possible.length} sealed</button><button data-action="dispatch-tab" data-tab="transit" class="${dispatchTab==='transit'?'on':''}">In transit · ${state.trips.filter(t=>!scope || scope.boxes.some(b=>b.trip===t.id)).length} trips</button></div>${dispatchTab==='transit'?transitView(scope):`<div class="dispatch-body"><div>${groups.map(s=>`<section class="dispatch-group"><header class="dispatch-group-head"><input type="checkbox" aria-label="Select all sealed koli for ${s.name}" data-change="select-store" ${sdata(s)} ${ready(s).length&&ready(s).every(b=>selected.has(b.id))?'checked':''} ${!ready(s).length?'disabled':''}><div class="grow"><b>${s.code} · ${s.name}</b><div class="muted">${ready(s).length} sealed koli · ${total(ready(s).map(pcs))} pcs</div></div></header>${ready(s).map(b=>`<div class="dispatch-row"><input type="checkbox" aria-label="Select ${s.name} Koli ${b.no}" data-change="select-dispatch" value="${b.id}" ${selected.has(b.id)?'checked':''}><div class="koli-info"><b>Koli ${b.no}</b><span>${b.id}</span></div><span class="contents-preview">${s.items.filter(i=>b.items[i.id]).map(i=>`${i.name} · ${i.variant}`).join(', ')}</span><span class="pcs num">${pcs(b)} pcs</span>${btn(icon('print'),'label',`${kdata(s,b)} aria-label="View ${s.name} Koli ${b.no} label"`)}</div>`).join('')}${left(s)||openBoxes(s).length?`<footer class="dispatch-blocked"><span>${left(s)} picked left · ${openBoxes(s).length} open koli</span>${btn('Continue packing '+icon('arrow'),'back-to-pack',sdata(s))}</footer>`:''}</section>`).join('')||empty('No koli waiting for dispatch','Seal a koli in Pack to make it available.','truck')}</div><aside class="trip-summary"><h3>This trip</h3><div><div class="trip-count num">${selectedBoxes.length} koli <span class="muted">· ${total(selectedBoxes.map(pcs))} pcs</span></div><span class="muted">${stores.filter(s=>s.boxes.some(b=>selected.has(b.id))).length} stores selected</span></div><div>${stores.filter(s=>ready(s).some(b=>selected.has(b.id))).map(s=>`<div class="trip-store-line"><span class="stack"><b>${s.name}</b><span class="muted">${ready(s).filter(b=>selected.has(b.id)).map(b=>`Koli ${b.no}`).join(' · ')}</span></span><span class="nowrap">${ready(s).filter(b=>selected.has(b.id)).length} koli</span></div>`).join('')}</div><label class="field-label">Vehicle / trip note<textarea id="trip-note" placeholder="Vehicle, driver or route">${esc(tripNote)}</textarea></label><span class="muted">One delivery note for this trip.</span><p class="inline-error" id="dispatch-error" role="alert"></p>${btn(`Review & dispatch ${icon('arrow')}`,'dispatch-dialog',scope?sdata(scope):'','primary',!selectedBoxes.length)}${possible.length?btn('Select all sealed koli','select-all-dispatch',scope?sdata(scope):''):''}</aside></div>`}`;
}
function transitView(scope) {
  const trips=state.trips.filter(t=>!scope || scope.boxes.some(b=>b.trip===t.id));
  return trips.map(t=>{ const stores=state.stores.filter(s=>s.boxes.some(b=>b.trip===t.id));return `<article class="trip-card"><div class="trip-top"><div><h3>${t.id}</h3><span class="muted">${esc(t.note)}</span></div><span class="status transit">${icon('truck')}In transit</span></div><div class="trip-stores">${stores.map(s=>{const boxes=s.boxes.filter(b=>b.trip===t.id);return `<div class="trip-store"><div><b>${s.code} · ${s.name}</b><div class="muted">${boxes.map(b=>`Koli ${b.no} · ${b.id}`).join(' / ')}</div></div><span class="nowrap num">${boxes.length} koli · ${total(boxes.map(pcs))} pcs</span></div>`;}).join('')}</div></article>`;}).join('')||empty('No trips yet','Dispatch selected sealed koli to see the trip here.','truck');
}
function globalStageNav() {
  const rows=[['pick','pick','Pick',`${total(state.stores.map(toPick))} pcs to pick`],['pack','box','Pack',`${total(state.stores.map(left))} pcs to pack`],['dispatch','truck','Dispatch',`${total(state.stores.map(s=>ready(s).length))} sealed koli`]];
  return `<nav class="stage-nav" aria-label="Operations stages">${rows.map(([id,ic,title,desc])=>`<button class="stage-button ${stage===id?'on':''}" data-action="stage" data-stage="${id}" aria-current="${stage===id?'page':'false'}"><span class="stage-icon">${icon(ic)}</span><span><b class="stage-label">${title}</b><span class="muted">${desc}</span></span></button>`).join('')}</nav>`;
}
function render() {
  const previousList=$('#store-list');if(previousList?.clientHeight)navScroll=previousList.scrollTop;
  const info=versions[view],s=cur();
  $('#prototype-bar').innerHTML=`<header class="prototype-bar"><span class="proto-brand">Ops · Pack lab</span><nav class="prototype-tabs" aria-label="Prototype versions">${Object.entries(versions).map(([id,v])=>`<button class="${view===id?'on':''}" data-action="version" data-version="${id}" aria-pressed="${view===id}"><b>${id}</b>${v.name}</button>`).join('')}</nav><div class="proto-tools"><label class="proto-scale"><span>Demo</span><select data-change="demo-size" aria-label="Demo store count"><option value="13" ${storeCount===13?'selected':''}>13 stores</option><option value="30" ${storeCount===30?'selected':''}>30 stores</option></select></label><a class="original" href="pack-options-2.html?o=T10">T10 awal ↗</a><button data-action="reset-dialog">Reset demo</button></div></header><div class="prototype-note"><strong>${info.label}.</strong><span>${info.note}</span><span class="sample">Data contoh · tersimpan lokal</span></div>`;
  let body='';
  if(view==='D'&&stage==='dispatch') body=`<div class="section-heading"><span class="muted">Pick & Pack · ${s.code} ${s.name}</span>${btn(`${icon('left')} Back to pack`,'back-to-pack',sdata(s))}</div>${flowNav(s)}${dispatchView()}`;
  else if(view==='D') body=`<div class="workspace">${storeNav()}<section class="store-content">${storeHead(s)}${flowNav(s)}${stage==='pick'?pickView(s,true):bench(s,true)}</section></div>`;
  else if(stage==='pick') body=`<div class="stage-page">${storeNav()}<section class="store-content">${storeHead(s)}${pickView(s)}</section></div>`;
  else if(stage==='dispatch') body=dispatchView();
  else if(view==='B') body=overview();
  else body=`<div class="workspace">${storeNav()}<section class="store-content">${storeHead(s)}${view==='C'?matrixView(s):bench(s)}</section></div>`;
  $('#app').innerHTML=`<div class="app-shell"><aside class="rail" aria-label="Central"><span class="brand">C</span><span class="rail-icon">${icon('grid')}</span><span class="rail-icon on" title="Operations">${icon('box')}</span><span class="rail-icon">${icon('store')}</span></aside><main class="surface"><header class="page-header"><div><div class="breadcrumb">Ops / Allotment</div><h1>${view==='D'?'Store workflow':'Pick, Pack & Dispatch'}</h1></div><div class="header-meta"><span>DC · Tangerang</span><span class="muted">21 Oct 2026</span></div></header>${view!=='D'?globalStageNav():''}<div class="content">${body}</div></main></div>`;
  fitStoreNavigator();restoreStorePosition();
  document.querySelectorAll('[data-change="select-store"]').forEach(el=>{const boxes=ready(getStore(state,el.dataset.store));el.indeterminate=boxes.some(b=>selected.has(b.id))&&!boxes.every(b=>selected.has(b.id));});
  const url=new URL(location.href);url.searchParams.set('v',view);url.searchParams.set('stage',stage);url.searchParams.set('store',chosen);url.searchParams.set('stores',storeCount);if(stage==='dispatch')url.searchParams.set('tab',dispatchTab);else url.searchParams.delete('tab');history.replaceState(null,'',url);
  if(dialog) renderDialog();
}
function save() {try{localStorage.setItem(storageKey(),JSON.stringify(state));}catch {notify('Browser storage unavailable. Changes last for this visit.');}}
function mutate(fn,message) {
  const before=structuredClone(state);
  try { const result=fn();assertState(state);undoState=before;save();closeDialog(false);render();notify(typeof message==='function'?message(result):message,true);return result; }
  catch(e){state=before; const error=$('#dialog-error')||$('#dispatch-error')||$('#pick-error');if(error)error.textContent=e.message;else notify(e.message);return null;}
}
function notify(message,undo=false) {
  clearTimeout(toastTimer);$('#toast').innerHTML=`<span>${esc(message)}</span>${undo?'<button data-action="undo">Undo</button>':''}`;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),6500);
}
function openDialog(data) {lastFocus=document.activeElement;$('#toast').classList.remove('show');dialog=data;renderDialog();requestAnimationFrame(()=>($('#modal-root [autofocus]')||$('#modal-root button'))?.focus());}
function closeDialog(restore=true) {dialog=null;$('#modal-root').innerHTML='';document.body.style.overflow='';$('#app').inert=false;$('#prototype-bar').inert=false;if(restore&&lastFocus?.isConnected)lastFocus.focus();}
function dialogShell(title,caption,body,foot) {
  $('#modal-root').innerHTML=`<div class="modal-veil" data-dismiss="true"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><div class="grow"><p>${caption}</p><h2 id="dialog-title">${title}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></header><div class="dialog-body">${body}<p class="dialog-error" id="dialog-error" role="alert"></p></div><footer class="dialog-foot">${foot}</footer></section></div>`;
  document.body.style.overflow='hidden';$('#app').inert=true;$('#prototype-bar').inert=true;
}
function renderDialog() {
  const d=dialog;
  if(d.type==='reset') {dialogShell('Reset all demo data?','Pack lab','<p>All four versions share the same demo. This restores the original picked quantities, koli and trips.</p>',btn('Keep working','close-dialog')+btn('Reset demo','reset','','primary'));return;}
  if(d.type==='dispatch') {
    const rows=state.stores.filter(s=>s.boxes.some(b=>selected.has(b.id)));
    const boxes=rows.flatMap(s=>s.boxes.filter(b=>selected.has(b.id)));
    dialogShell(`Dispatch ${boxes.length} koli · ${total(boxes.map(pcs))} pcs?`,'Review trip',`<div class="label-preview"><h3>${esc(tripNote)}</h3>${rows.map(s=>`<div class="between"><span class="stack"><b>${s.code} · ${s.name}</b><span class="muted">${s.boxes.filter(b=>selected.has(b.id)).map(b=>`Koli ${b.no} · ${b.id}`).join(' / ')}</span></span><b class="nowrap">${s.boxes.filter(b=>selected.has(b.id)).length} koli</b></div>`).join('')}</div><p class="muted">${rows.length} stores · one delivery note. Other picked pieces and open koli stay at the warehouse.</p>`,btn('Back','close-dialog')+btn(`${icon('truck')} Dispatch trip`,'confirm-dispatch','','primary'));return;
  }
  const s=getStore(state,d.store);
  if(d.type==='move') {
    const source=d.source==='picked'?null:getBox(s,d.source);
    const options=[...(!source?[]:[{id:'picked',label:'Picked · back to the picked area'}]),...openBoxes(s).filter(b=>b.id!==d.source).map(b=>({id:b.id,label:`Koli ${b.no} · ${b.id} · ${pcs(b)} pcs`})),{id:'new',label:`New koli · Koli ${Math.max(0,...s.boxes.map(b=>b.no))+1}`}];
    if(!options.some(o=>o.id===d.target))d.target=options[0]?.id;
    const items=s.items.filter(i=>d.ids.includes(i.id));
    const count=total(Object.values(d.quantities));
    const sourceLabel=source?`Koli ${source.no}`:'Picked';
    const dest=d.target==='new'?'New koli':d.target==='picked'?'Picked':`Koli ${getBox(s,d.target).no}`;
    dialogShell(source?'Move pieces':'Put picked into koli',`${s.code} · ${s.name}`,`<label class="destination-field">Destination<select data-change="dialog-target" autofocus>${options.map(o=>`<option value="${o.id}" ${d.target===o.id?'selected':''}>${o.label}</option>`).join('')}</select></label><div class="dialog-lines">${items.map(i=>{const max=source?(source.items[i.id]||0):leftOf(s,i.id);return `<div class="sku-row">${garment(i)}<div class="sku-copy"><b>${esc(i.name)}</b><span>${i.variant} · ${max} available</span></div><div class="quantity-control"><button data-action="step-qty" data-item="${i.id}" data-delta="-1" aria-label="Decrease ${esc(i.name)} ${i.variant}">${icon('minus')}</button><input type="number" min="0" max="${max}" step="1" value="${d.quantities[i.id]}" data-input="dialog-qty" data-item="${i.id}" aria-label="Quantity of ${esc(i.name)} ${i.variant}"><button data-action="step-qty" data-item="${i.id}" data-delta="1" aria-label="Increase ${esc(i.name)} ${i.variant}">${icon('plus')}</button></div></div>`;}).join('')}</div><div class="change-preview"><span>${sourceLabel} ${icon('arrow')} ${dest}</span><b class="num" id="move-total">${count} pcs</b></div>`,`<span class="muted">${sourceLabel}: <span id="move-remainder">${(source?pcs(source):left(s))-count}</span> pcs left</span>`+btn('Back','close-dialog')+btn(`${source?'Move':'Put'} ${count} pcs`,'confirm-move','','primary'));
    return;
  }
  const b=getBox(s,d.box);
  const lines=`<table class="print-lines"><thead><tr><th>Article / SKU</th><th>Pcs</th></tr></thead><tbody>${s.items.filter(i=>b.items[i.id]).map(i=>`<tr><td>${esc(i.name)}<br><span class="muted">${i.variant} · ${i.code}</span></td><td>${b.items[i.id]}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td><td><b>${pcs(b)}</b></td></tr></tfoot></table>`;
  if(d.type==='seal') {
    dialogShell(`Seal Koli ${b.no}?`,`${s.code} · ${s.name} / ${b.id}`,`<div class="sealed-preview">${icon('lock')}<span><b>${pcs(b)} pcs · ${Object.keys(b.items).length} SKU</b><br><span class="muted">This koli will be available in Dispatch.</span></span></div>${lines}<div class="change-preview"><span>Picked still waiting</span><b>${left(s)} pcs</b></div>`,btn('Back','close-dialog')+btn(`${icon('lock')} Seal Koli ${b.no}`,'confirm-seal','','primary'));
    return;
  }
  if(d.type==='cell') {
    const i=s.items.find(i=>i.id===d.item);
    dialogShell(`${i.name} · ${i.variant}`,`${s.code} · ${s.name} / Koli ${b.no}`,`<div class="between"><span>In Koli ${b.no}</span><b>${b.items[i.id]||0} pcs</b></div><div class="between"><span>Picked left</span><b>${leftOf(s,i.id)} pcs</b></div>`,btn('Back','close-dialog')+btn('Move out','cell-out',`${sdata(s)} data-box="${b.id}" data-item="${i.id}"`,'ghost',!b.items[i.id])+btn(`Add from picked ${icon('arrow')}`,'cell-add',`${sdata(s)} data-box="${b.id}" data-item="${i.id}"`,'primary',!leftOf(s,i.id)));
    return;
  }
  dialogShell(`Koli ${b.no} · ${b.id}`,`${s.code} · ${s.name}`,`<div class="label-preview"><span class="muted">Central / DC Tangerang</span><h3>${s.code} · ${s.name}</h3><div class="between"><b>Koli ${b.no}</b><b>${pcs(b)} pcs</b></div><div class="barcode" aria-hidden="true"></div><b>${b.id}</b>${status(b)}</div>${lines}<p class="muted">${s.alts.join(' · ')}</p>`,btn('Close','close-dialog')+(b.sealed&&!b.trip?btn('Reopen koli','reopen',kdata(s,b)):'')+btn(`${icon('print')} Print packing list`,'print','','primary'));
}
function startMove(store,source,target,ids) {
  const s=getStore(state,store),from=source==='picked'?null:getBox(s,source);
  const usable=ids||s.items.filter(i=>(from?from.items[i.id]:leftOf(s,i.id))>0).map(i=>i.id);
  if(!usable.length){notify('No pieces available to move.');return;}
  openDialog({type:'move',store,source,target,ids:usable,quantities:Object.fromEntries(usable.map(id=>[id,from?from.items[id]||0:leftOf(s,id)]))});
}
function gotoStage(next) {stage=next;query='';render();}
function handleAction(el) {
  const a=el.dataset.action,s=el.dataset.store?getStore(state,el.dataset.store):cur(),b=el.dataset.box?s.boxes.find(b=>b.id===el.dataset.box):null;
  switch(a) {
    case 'version':view=el.dataset.version;query='';revealChosen=true;render();break;
    case 'store-filter':storeFilter=el.dataset.filter;if($('#store-list'))$('#store-list').scrollTop=0;navScroll=0;revealChosen=true;render();$('.store-filter button.on')?.focus({preventScroll:true});break;
    case 'stage':gotoStage(el.dataset.stage);break;
    case 'store':chosen=s.id;expanded=s.id;revealChosen=true;render();break;
    case 'expand-store':expanded=expanded===s.id?null:s.id;chosen=s.id;render();break;
    case 'select-box':active[s.id]=b.id;render();break;
    case 'overview-box':active[s.id]=b.id;expanded=s.id;chosen=s.id;render();break;
    case 'new-box':chosen=s.id;expanded=s.id;mutate(()=>{const box=createBox(state,s.id);active[s.id]=box.id;return box;},box=>`Koli ${box.no} added for ${s.name}`);break;
    case 'move-dialog':startMove(s.id,el.dataset.source,el.dataset.target,el.dataset.item?[el.dataset.item]:null);break;
    case 'put-all':startMove(s.id,'picked',el.dataset.target);break;
    case 'confirm-move': {const d=dialog;mutate(()=>{const result=move(state,d.store,d.source,d.target,d.quantities);if(result.box)active[d.store]=result.box.id;return result;},r=>`${r.count} pcs moved to ${r.box?`Koli ${r.box.no}`:'Picked'}`);break;}
    case 'seal-dialog':openDialog({type:'seal',store:s.id,box:b.id});break;
    case 'confirm-seal': {const d=dialog;mutate(()=>seal(state,d.store,d.box),`${getBox(getStore(state,d.store),d.box).id} sealed · ready to dispatch`);break;}
    case 'reopen':mutate(()=>{reopen(state,s.id,b.id);active[s.id]=b.id;},`Koli ${b.no} reopened`);break;
    case 'label':openDialog({type:'label',store:s.id,box:b.id});break;
    case 'print':window.print();break;
    case 'close-dialog':closeDialog();break;
    case 'step-qty':{const id=el.dataset.item,from=dialog.source==='picked'?null:getBox(getStore(state,dialog.store),dialog.source);const max=from?from.items[id]||0:leftOf(getStore(state,dialog.store),id);dialog.quantities[id]=Math.min(max,Math.max(0,(Number(dialog.quantities[id])||0)+Number(el.dataset.delta)));renderDialog();break;}
    case 'cell':openDialog({type:'cell',store:s.id,box:b.id,item:el.dataset.item});break;
    case 'cell-add':startMove(s.id,'picked',b.id,[el.dataset.item]);break;
    case 'cell-out':startMove(s.id,b.id,'picked',[el.dataset.item]);break;
    case 'review-dispatch':chosen=s.id;stage='dispatch';dispatchTab='ready';ready(s).forEach(b=>selected.add(b.id));render();break;
    case 'back-to-pack':chosen=s.id;expanded=s.id;stage='pack';render();break;
    case 'record-pick':{const form=$('#pick-form');if(!form.reportValidity())return;const values=Object.fromEntries([...new FormData(form)].map(([id,value])=>[id,Number(value)]));const count=total(Object.values(values));const result=mutate(()=>{recordPick(state,s.id,values);return true;},`${count} pcs picked for ${s.name}`);if(result){stage='pack';render();}break;}
    case 'dispatch-tab':dispatchTab=el.dataset.tab;render();break;
    case 'select-all-dispatch':selected=new Set(state.stores.flatMap(s=>ready(s).map(b=>b.id)));render();break;
    case 'dispatch-dialog':tripNote=$('#trip-note')?.value||tripNote;if(!tripNote.trim()){$('#dispatch-error').textContent='Enter a vehicle or trip note.';$('#trip-note').focus();return;}openDialog({type:'dispatch'});break;
    case 'confirm-dispatch':{const result=mutate(()=>dispatch(state,[...selected],tripNote),r=>`${r.id} dispatched`);if(result){selected.clear();dispatchTab='transit';render();}break;}
    case 'reset-dialog':openDialog({type:'reset'});break;
    case 'reset':state=seed(storeCount);active={};selected.clear();undoState=null;chosen='c001';expanded=chosen;query='';dispatchTab='ready';closeDialog(false);save();render();notify('Demo data restored');break;
    case 'undo':if(undoState){state=undoState;undoState=null;selected.clear();save();render();notify('Last change undone');}break;
  }
}
document.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');
  if(el&&!el.disabled){event.preventDefault();handleAction(el);}
  else if(event.target.matches('[data-dismiss]'))closeDialog();
});
document.addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='pick-form')handleAction(event.target.querySelector('[data-action="record-pick"]'));});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.dataset.input==='store-search'){query=el.value;$('#store-list').innerHTML=storeButtons();$('#store-list').scrollTop=0;navScroll=0;$('#store-caption').textContent=`${matchingStores().length} of ${state.stores.length} stores`;if(!query){revealChosen=true;restoreStorePosition();}}
  if(el.dataset.input==='overview-search'){query=el.value;$('#overview-stores').innerHTML=overviewGroups(state.stores.filter(s=>`${s.code} ${s.name}`.toLowerCase().includes(query.toLowerCase())));}
  if(el.dataset.input==='dialog-qty'){
    dialog.quantities[el.dataset.item]=el.value===''?NaN:Number(el.value);
    const q=total(Object.values(dialog.quantities));
    $('#move-total').textContent=Number.isFinite(q)?`${q} pcs`:'—';
    const s=getStore(state,dialog.store),base=dialog.source==='picked'?left(s):pcs(getBox(s,dialog.source));
    $('#move-remainder').textContent=Number.isFinite(q)?base-q:'—';
    $('[data-action="confirm-move"]').textContent=Number.isFinite(q)?`${dialog.source==='picked'?'Put':'Move'} ${q} pcs`:'Move pieces';
    el.classList.toggle('field-error',!el.validity.valid);
  }
  if(el.id==='trip-note')tripNote=el.value;
});
document.addEventListener('change',event=>{
  const el=event.target,s=el.dataset.store?getStore(state,el.dataset.store):cur();
  switch(el.dataset.change) {
    case 'demo-size':storeCount=Number(el.value);state=readDemo();chosen=state.stores.some(s=>s.id===chosen)?chosen:'c001';expanded=chosen;query='';storeFilter='all';active={};selected.clear();undoState=null;navScroll=0;if($('#store-list'))$('#store-list').scrollTop=0;revealChosen=true;render();break;
    case 'store':chosen=el.value;expanded=chosen;revealChosen=true;render();break;
    case 'target':if(el.value==='new'){mutate(()=>{const box=createBox(state,s.id);active[s.id]=box.id;return box;},box=>`Koli ${box.no} added for ${s.name}`);}else{active[s.id]=el.value;render();}break;
    case 'dialog-target':dialog.target=el.value;renderDialog();$('#modal-root select').focus();break;
    case 'select-dispatch':el.checked?selected.add(el.value):selected.delete(el.value);render();break;
    case 'select-store':ready(s).forEach(b=>el.checked?selected.add(b.id):selected.delete(b.id));render();break;
  }
});
window.addEventListener('resize',()=>{fitStoreNavigator();if($('#store-list')?.clientHeight){revealChosen=true;restoreStorePosition();}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&dialog){event.preventDefault();closeDialog();}
  if(event.key==='Enter'&&dialog?.type==='move'&&event.target.matches('[data-input="dialog-qty"]')){event.preventDefault();handleAction($('[data-action="confirm-move"]'));}
  if(event.key==='Tab'&&dialog){const nodes=[...document.querySelectorAll('.dialog button:not(:disabled),.dialog input,.dialog select,.dialog textarea,.dialog a')];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
render();
