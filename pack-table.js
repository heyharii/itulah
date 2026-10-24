import {seed,assertTableState,total,pcs,left,leftOf,getStore,picklists,packed,recordPicklist,sealKoli,dispatch} from './pack-table-model.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search);
let storeCount=params.get('stores')==='30'?30:13;
const storageKey=()=>`itulah.pack-table.v1.${storeCount}`;
function readState(){try{const saved=JSON.parse(localStorage.getItem(storageKey()));if(saved?.tableVersion===1&&saved.stores.length===storeCount&&assertTableState(saved))return saved;}catch{}return seed(storeCount);}
let state=readState();
const tabNames=['picklist','picked','packed','transit'];
let tab=tabNames.includes(params.get('tab'))?params.get('tab'):params.get('stage')==='pick'?'picklist':params.get('stage')==='dispatch'?'packed':'picked';
let search='',selected=new Set(),overlay=null,lastFocus=null,toastTimer;
let sort={picklist:{field:'number',direction:1},picked:{field:'code',direction:1},packed:{field:'sealedAt',direction:-1},transit:{field:'departedAt',direction:-1}};
let tripNote='B 9124 SCA · Andi Pratama';
const paths={
  list:'<path d="M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1"/>',
  picked:'<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/><path d="m9 14 2 2 4-4"/>',
  box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M8 5l9 4"/>',
  truck:'<path d="M3 6h11v10H3zM14 10h4l3 4v2h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  print:'<path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7z"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',sort:'<path d="m8 8 4-4 4 4M12 4v16"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.box}</svg>`;
const button=(label,action,data='',kind='ghost',disabled=false)=>`<button type="button" class="ds-btn ds-btn--${kind}" data-action="${action}" ${data} ${disabled?'disabled':''}>${label}</button>`;
const quantity=n=>`<span class="num">${n.toLocaleString('en-US')}</span><span class="qty-unit">pcs</span>`;
const storeLabel=s=>`<span class="store-identity"><span>${esc(s.name)}</span><span class="code">${s.code}</span></span>`;
const dateTime=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(',',' ·');
const status=(word,cls)=>`<span class="status ${cls}">${word}</span>`;
const rowKey=s=>`data-store="${s.id}"`;
function message(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function save(){try{localStorage.setItem(storageKey(),JSON.stringify(state));}catch{message('Browser storage unavailable. Keep this page open to retain the demo.');}}
function commit(fn){const before=structuredClone(state);try{const result=fn();assertTableState(state);save();renderPage();return{ok:true,result};}catch(error){state=before;const target=$('#sheet-error');if(target)target.textContent=error.message;else message(error.message);return{ok:false};}}
function empty(title,copy='',name='list'){return `<div class="empty">${icon(name)}<h3>${title}</h3>${copy?`<p>${copy}</p>`:''}</div>`;}
function matches(...values){return values.join(' ').toLowerCase().includes(search.toLowerCase());}
const pickedStores=()=>state.stores.filter(s=>left(s)>0);
function counts(){return{picklist:picklists(state).length,picked:pickedStores().length,packed:packed(state).length,transit:state.trips.length};}
function sortRows(rows){const {field,direction}=sort[tab];return [...rows].sort((a,b)=>{const av=sortValue(a,field),bv=sortValue(b,field);return(typeof av==='number'?av-bv:String(av).localeCompare(String(bv)))*direction;});}
function sortValue(row,field){if(tab==='picklist')return field==='store'?row.store.code:row[field];if(tab==='picked')return field==='quantity'?left(row):row[field];if(tab==='packed')return field==='store'?row.store.code:field==='quantity'?pcs(row.box):row.box[field];if(field==='quantity')return total(tripBoxes(row).map(x=>pcs(x.box)));return row[field];}
function heading(label,field,cls=''){return `<th class="${cls}" aria-sort="${sort[tab].field===field?(sort[tab].direction===1?'ascending':'descending'):'none'}"><button class="sort-button ${sort[tab].direction===-1&&sort[tab].field===field?'descending':''}" data-action="sort" data-field="${field}">${label}${sort[tab].field===field?icon('sort'):''}</button></th>`;}
function render(){
  $('#demo-root').innerHTML=`<div class="demo-bar"><span><strong>Prototype · Table</strong><span class="sample-description"> · Data contoh, tersimpan lokal</span></span><div class="demo-controls"><label><span>Demo</span><select data-change="demo-size" aria-label="Demo store count"><option value="13" ${storeCount===13?'selected':''}>13 stores</option><option value="30" ${storeCount===30?'selected':''}>30 stores</option></select></label><button data-action="reset">Reset demo</button></div></div>`;
  $('#app').innerHTML=`<div class="shell"><aside class="rail" aria-label="Central"><span class="brand">C</span><span class="rail-mark">${icon('grid')}</span><span class="rail-mark on">${icon('box')}</span></aside><main class="surface"><header class="page-head"><h1>Allotment</h1><div class="page-meta"><span>DC · Tangerang</span><span>21 Oct 2026</span></div></header><div class="page-content" id="page-content"></div></main></div>`;
  renderPage();
}
function renderPage(){
  const c=counts();
  const tabs=[['picklist','list','Picklist'],['picked','picked','Picked'],['packed','box','Packed'],['transit','truck','In transit']];
  const placeholder={picklist:'Search picklist or store',picked:'Search store name or code',packed:'Search koli or store',transit:'Search delivery note or store'}[tab];
  $('#page-content').classList.toggle('dispatch-ready',tab==='packed');
  $('#page-content').innerHTML=`<nav class="stage-tabs" role="tablist" aria-label="Allotment stages">${tabs.map(([id,ic,label])=>`<button class="stage-tab ${tab===id?'on':''}" role="tab" id="tab-${id}" aria-selected="${tab===id}" aria-controls="table-region" tabindex="${tab===id?0:-1}" data-action="tab" data-tab="${id}">${icon(ic)}<span class="tab-label">${label}</span><span class="tab-count">${c[id]}</span></button>`).join('')}</nav><div class="toolbar"><label class="search">${icon('search')}<input type="search" id="table-search" value="${esc(search)}" placeholder="${placeholder}" aria-label="${placeholder}"></label><span class="toolbar-summary" id="toolbar-summary"></span>${tab==='packed'?button(`${icon('truck')} Dispatch`,'dispatch','','primary',!selected.size):''}</div><section id="table-region" role="tabpanel" aria-labelledby="tab-${tab}"></section>`;
  const url=new URL(location.href);url.search='';url.searchParams.set('tab',tab);url.searchParams.set('stores',storeCount);history.replaceState(null,'',url);
  renderData();
  if(overlay){$('#app').inert=true;$('#demo-root').inert=true;}
}
function renderData(){
  const validIds=new Set(packed(state).map(x=>x.box.id));selected=new Set([...selected].filter(id=>validIds.has(id)));
  const body={picklist:picklistTable,picked:pickedTable,packed:packedTable,transit:transitTable}[tab]();
  $('#table-region').innerHTML=body;
  const rows=visibleRows();
  $('#toolbar-summary').textContent=tab==='picked'?`${rows.length} stores · ${total(rows.map(left))} pcs`:tab==='packed'?`${rows.length} koli · ${total(rows.map(x=>pcs(x.box)))} pcs`:tab==='picklist'?`${rows.length} picklists`:`${rows.length} trips`;
  const dispatchButton=$('.toolbar [data-action="dispatch"]');if(dispatchButton){dispatchButton.disabled=!selected.size;dispatchButton.innerHTML=`${icon('truck')} Dispatch${selected.size?` · ${selected.size} koli`:''}`;}
  const all=$('[data-change="select-all"]');if(all){all.checked=rows.length>0&&rows.every(x=>selected.has(x.box.id));all.indeterminate=rows.some(x=>selected.has(x.box.id))&&!all.checked;}
}
function visibleRows(){
  if(tab==='picklist')return sortRows(picklists(state).filter(p=>matches(p.number,p.store.name,p.store.code)));
  if(tab==='picked')return sortRows(pickedStores().filter(s=>matches(s.name,s.code)));
  if(tab==='packed')return sortRows(packed(state).filter(x=>matches(x.box.id,x.store.name,x.store.code)));
  return sortRows(state.trips.filter(t=>matches(t.id,t.note,...tripBoxes(t).map(x=>x.store.name+' '+x.store.code))));
}
function picklistTable(){
  const rows=visibleRows();if(!rows.length)return empty('No picklists match your search.');
  return `<div class="table-frame"><table class="data-table"><thead><tr>${heading('Picklist','number')}${heading('Store','store')}${heading('Quantity','quantity','right')}${heading('Picked','picked','right')}<th>Status</th><th class="action-col"></th></tr></thead><tbody>${rows.map(p=>`<tr><td><button class="text-link" data-action="pick" data-source="${p.id}" ${rowKey(p.store)}>${p.number}</button></td><td>${storeLabel(p.store)}</td><td class="right">${quantity(p.quantity)}</td><td class="right">${quantity(p.picked)}</td><td>${p.picked===p.quantity?status('Picked','done'):p.picked?status('Partially picked','partial'):status('To pick','wait')}</td><td class="action-col">${button(p.picked===p.quantity?'View':'Pick','pick',`data-source="${p.id}" ${rowKey(p.store)}`,p.picked===p.quantity?'ghost':'primary')}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">${rows.length} picklists</td><td class="right">${quantity(total(rows.map(p=>p.quantity)))}</td><td class="right">${quantity(total(rows.map(p=>p.picked)))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function pickedTable(){
  const rows=visibleRows();if(!rows.length)return empty(search?'No stores match your search.':'No picked pieces waiting.','Record a pick from Picklist to make it available here.','picked');
  return `<div class="table-frame"><table class="data-table picked-table"><thead><tr>${heading('Store','code')}${heading('Picked','quantity','right')}<th class="action-col"></th></tr></thead><tbody>${rows.map(s=>`<tr><td>${storeLabel(s)}</td><td class="right quantity">${quantity(left(s))}</td><td class="action-col">${button('Pack','pack',rowKey(s),'primary')}</td></tr>`).join('')}</tbody><tfoot><tr><td>${rows.length} stores</td><td class="right">${quantity(total(rows.map(left)))}</td><td></td></tr></tfoot></table></div>`;
}
function checkBox(id,label,checked){return `<label class="check-hit"><input type="checkbox" data-change="select-koli" value="${id}" aria-label="${esc(label)}" ${checked?'checked':''}></label>`;}
function packedTable(){
  const rows=visibleRows();if(!rows.length)return empty(search?'No koli match your search.':'No sealed koli waiting.','Use Pack in the Picked tab, then seal the koli.','box');
  const chosen=packed(state).filter(x=>selected.has(x.box.id)),stores=new Set(chosen.map(x=>x.store.id));
  return `<div class="table-frame"><table class="data-table"><thead><tr><th class="check-col"><label class="check-hit"><input type="checkbox" data-change="select-all" aria-label="Select all visible koli"></label></th>${heading('Koli','id')}${heading('Store','store')}${heading('Quantity','quantity','right')}${heading('Sealed at','sealedAt')}<th class="action-col"></th></tr></thead><tbody>${rows.map(({store:s,box:b})=>`<tr class="${selected.has(b.id)?'selected':''}"><td class="check-col">${checkBox(b.id,`Select ${b.id} for ${s.name}`,selected.has(b.id))}</td><td><button class="text-link" data-action="koli" data-box="${b.id}">${b.id}</button></td><td>${storeLabel(s)}</td><td class="right">${quantity(pcs(b))}</td><td class="muted nowrap">${dateTime(b.sealedAt)}</td><td class="action-col">${button('View','koli',`data-box="${b.id}"`)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">${rows.length} sealed koli</td><td class="right">${quantity(total(rows.map(x=>pcs(x.box))))}</td><td colspan="2"></td></tr></tfoot></table></div>${selected.size?`<div class="selection-bar"><div class="selection-counts"><b>${selected.size} koli selected</b><span class="muted">${stores.size} stores</span><span class="muted">${total(chosen.map(x=>pcs(x.box)))} pcs</span></div>${button('Clear selection','clear-selection')}</div>`:'<p class="table-note">Select koli from any store to combine them in one trip.</p>'}`;
}
function tripBoxes(trip){return state.stores.flatMap(store=>store.boxes.filter(b=>b.trip===trip.id).map(box=>({store,box})));}
function transitTable(){
  const rows=visibleRows();if(!rows.length)return empty(search?'No trips match your search.':'No trips in transit.','Dispatch selected koli from the Packed tab.','truck');
  return `<div class="table-frame"><table class="data-table"><thead><tr>${heading('Delivery note','id')}<th>Vehicle / trip note</th><th class="right">Stores</th><th class="right">Koli</th>${heading('Quantity','quantity','right')}${heading('Dispatched at','departedAt')}<th class="action-col"></th></tr></thead><tbody>${rows.map(t=>{const boxes=tripBoxes(t);return `<tr><td><button class="text-link" data-action="trip" data-trip="${t.id}">${t.id}</button></td><td>${esc(t.note)}</td><td class="right">${new Set(boxes.map(x=>x.store.id)).size}</td><td class="right">${boxes.length}</td><td class="right">${quantity(total(boxes.map(x=>pcs(x.box))))}</td><td class="muted nowrap">${dateTime(t.departedAt)}</td><td class="action-col">${button('View','trip',`data-trip="${t.id}"`)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function product(i){return `<span class="product" aria-hidden="true"><svg viewBox="0 0 34 39" fill="${i.color}" stroke="${i.color}" stroke-width="1"><path d="m10 5 7 3 7-3 8 6-5 7-4-2v18H11V16l-4 2-5-7z"/></svg></span>`;}
function itemIdentity(i){return `<div class="sku-identity">${product(i)}<span><b>${esc(i.name)}</b><span class="cell-sub">${esc(i.variant)}</span></span></div>`;}
function entryRows(items,available,values){return items.map(i=>{const max=available(i);return `<tr><td>${itemIdentity(i)}</td><td class="right available-col">${max}</td><td class="quantity-col"><input class="entry-field" type="number" min="0" max="${max}" step="1" value="${values[i.id]||0}" data-input="entry" data-item="${i.id}" aria-label="Quantity ${esc(i.name)} ${esc(i.variant)}" ${!max?'disabled':''}></td></tr>`;}).join('');}
function openOverlay(data){lastFocus=document.activeElement;overlay=data;$('#toast').classList.remove('show');renderOverlay();requestAnimationFrame(()=>($('#overlay-root [autofocus]')||$('#overlay-root button'))?.focus());}
function closeOverlay(nextTab){overlay=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';$('#app').inert=false;$('#demo-root').inert=false;if(nextTab){tab=nextTab;search='';renderPage();}if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});else $(`#tab-${tab}`)?.focus({preventScroll:true});}
function sheet(title,caption,body,footer,{wide=false,small=false}={}){
  $('#overlay-root').innerHTML=`<div class="veil"><section class="sheet ${wide?'wide':''} ${small?'reset-dialog':''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><header class="sheet-head"><div class="grow"><div class="caption">${caption}</div><h2 id="sheet-title">${title}</h2></div><button type="button" class="icon-btn" data-action="close" aria-label="Close form">${icon('close')}</button></header><div class="sheet-body">${body}<p class="error" id="sheet-error" role="alert"></p></div><footer class="sheet-foot">${footer}</footer></section></div>`;
  document.body.style.overflow='hidden';$('#app').inert=true;$('#demo-root').inert=true;
}
function renderOverlay(){
  const o=overlay;if(!o)return;
  if(o.type==='reset'){sheet('Reset this demo?','Table flow','<p>This restores the sample picklists, picked quantities, sealed koli and trips for this demo size.</p>',button('Close','close')+button('Reset demo','confirm-reset','','primary'),{small:true});return;}
  if(o.type==='pack'){renderPack();return;}
  if(o.type==='pick'){renderPick();return;}
  if(o.type==='dispatch'){renderDispatch();return;}
  if(o.type==='koli'){renderKoli();return;}
  if(o.type==='trip'){renderTrip();return;}
}
function renderPack(){
  const o=overlay,s=getStore(state,o.store),items=s.items.filter(i=>leftOf(s,i.id)>0),q=total(Object.values(o.values));
  const receipt=o.receipt?`<div class="receipt">${icon('check')}<div class="grow"><b>${o.receipt.id} created · ${pcs(o.receipt)} pcs</b><div class="muted">Sealed and available in Packed</div></div></div>`:'';
  const body=`${receipt}<div class="sheet-facts"><div><span>Picked available</span><b id="pack-available">${left(s)} pcs</b></div><div><span>Created this session</span><b>${o.created.length} koli</b></div></div>${items.length?`<div class="form-heading"><h3>New koli</h3>${button('Use all picked','fill-all')}</div><div class="table-frame"><table class="entry-table"><thead><tr><th>Article / SKU</th><th class="right available-col">Picked</th><th class="quantity-col">In this koli</th></tr></thead><tbody>${entryRows(items,i=>leftOf(s,i.id),o.values)}</tbody></table><div class="form-total"><span>In this koli</span><b id="entry-total">${q} pcs</b></div></div><p class="form-help">${icon('info')}Only sealed koli are saved. Closing this form leaves unsealed quantities in Picked.</p>`:empty('All available pieces packed.','Your sealed koli are in Packed.','box')}${o.created.length?`<div class="session-koli"><h3>Created koli</h3><table class="small-table"><thead><tr><th>Koli</th><th>State</th><th>Quantity</th></tr></thead><tbody>${o.created.map(id=>s.boxes.find(b=>b.id===id)).filter(Boolean).map(b=>`<tr><td>${b.id}</td><td>${status('Sealed','done')}</td><td>${quantity(pcs(b))}</td></tr>`).join('')}</tbody></table></div>`:''}`;
  const foot=`<span class="foot-copy" id="entry-remainder">${left(s)-q} pcs stay in Picked</span>${items.length?button('Close','close'):''}${o.created.length?button('View packed','view-packed'):''}${items.length?button(`${icon('lock')} Seal & create koli`,'seal','','primary',!q):button('Done','close','','primary')}`;
  sheet(`Pack · ${s.name}`,`${s.code} / Picked`,body,foot);
}
function renderPick(){
  const o=overlay,s=getStore(state,o.store),p=picklists(state).find(p=>p.id===o.source&&p.store.id===o.store),q=total(Object.values(o.values));
  const remaining=p.quantity-p.picked;
  const body=`<div class="sheet-facts"><div><span>Store</span><b>${s.code} · ${s.name}</b></div><div><span>Quantity</span><b>${p.quantity} pcs</b></div><div><span>Picked</span><b>${p.picked} pcs</b></div></div>${remaining?`<div class="form-heading"><h3>Record picked quantity</h3>${button('Use remaining','fill-all')}</div><div class="table-frame"><table class="entry-table"><thead><tr><th>Article / SKU</th><th class="right available-col">To pick</th><th class="quantity-col">Pick now</th></tr></thead><tbody>${entryRows(p.items,i=>i.target-i.picked,o.values)}</tbody></table><div class="form-total"><span>Pick now</span><b id="entry-total">${q} pcs</b></div></div>`:`<table class="small-table"><thead><tr><th>Article / SKU</th><th>Picked</th></tr></thead><tbody>${p.items.map(i=>`<tr><td>${itemIdentity(i)}</td><td>${quantity(i.picked)}</td></tr>`).join('')}</tbody></table>`}`;
  sheet(p.number,'Picklist',body,`${remaining?`<span class="foot-copy" id="entry-remainder">${remaining-q} pcs left to pick</span>`:''}${button('Close','close')}${remaining?button('Record picked','record-pick','','primary',!q):''}`);
}
function selectedRows(){return packed(state).filter(x=>selected.has(x.box.id));}
function groupKoli(rows){return [...new Set(rows.map(x=>x.store.id))].map(id=>({store:getStore(state,id),boxes:rows.filter(x=>x.store.id===id).map(x=>x.box)}));}
function groupTable(rows){return groupKoli(rows).map(({store:s,boxes})=>`<section class="dispatch-group"><header class="dispatch-group-head"><b>${s.code} · ${s.name}</b><span class="muted">${boxes.length} koli · ${total(boxes.map(pcs))} pcs</span></header>${boxes.map(b=>`<div class="dispatch-koli"><span>${b.id}</span><b>${quantity(pcs(b))}</b></div>`).join('')}</section>`).join('');}
function renderDispatch(){
  const rows=selectedRows(),groups=groupKoli(rows),q=total(rows.map(x=>pcs(x.box)));
  sheet('Dispatch selected koli','Packed',`<div class="trip-totals"><span><b>${rows.length}</b> koli</span><span><b>${groups.length}</b> stores</span><span><b>${q}</b> pcs</span></div>${groupTable(rows)}<label class="field-label">Vehicle / trip note<input id="trip-note" value="${esc(tripNote)}" placeholder="Vehicle, driver or route" autofocus></label><p class="form-help">${icon('info')}One delivery note for this trip, with koli grouped by store.</p>`,`<span class="foot-copy">${rows.length} koli · ${groups.length} stores</span>${button('Close','close')}${button(`${icon('truck')} Dispatch`,'confirm-dispatch','','primary',!rows.length)}`);
}
function findKoli(id){for(const store of state.stores){const box=store.boxes.find(b=>b.id===id);if(box)return{store,box};}throw Error('Koli not found.');}
function renderKoli(){
  const {store:s,box:b}=findKoli(overlay.box);
  const rows=s.items.filter(i=>b.items[i.id]);
  sheet(b.id,`Packed / ${s.code} · ${s.name}`,`<div class="label-preview"><span class="muted">Central · DC Tangerang</span><h3>${s.code} · ${s.name}</h3><div class="between"><b>${b.id}</b><b>${pcs(b)} pcs</b></div><div class="barcode" aria-hidden="true"></div><span>${b.id}</span></div><div class="sheet-facts"><div><span>Sealed at</span><b>${dateTime(b.sealedAt)}</b></div><div><span>State</span><b>${b.trip?'In transit':'Packed'}</b></div></div><table class="small-table"><thead><tr><th>Article / SKU</th><th>Quantity</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${itemIdentity(i)}</td><td>${quantity(b.items[i.id])}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td><td><b>${quantity(pcs(b))}</b></td></tr></tfoot></table>`,button('Close','close')+button(`${icon('print')} Print packing list`,'print'));
}
function renderTrip(){const t=state.trips.find(t=>t.id===overlay.trip),rows=tripBoxes(t);sheet(t.id,'In transit',`<div class="sheet-facts"><div><span>Vehicle / trip note</span><b>${esc(t.note)}</b></div><div><span>Dispatched at</span><b>${dateTime(t.departedAt)}</b></div></div><div class="trip-totals"><span><b>${rows.length}</b> koli</span><span><b>${groupKoli(rows).length}</b> stores</span><span><b>${total(rows.map(x=>pcs(x.box)))}</b> pcs</span></div>${groupTable(rows)}`,button('Close','close')+button(`${icon('print')} Print delivery note`,'print'));}
function updateEntry(){
  const o=overlay,s=getStore(state,o.store),q=total(Object.values(o.values));
  const inputs=[...document.querySelectorAll('.entry-field:not(:disabled)')],valid=inputs.every(i=>i.validity.valid)&&Number.isSafeInteger(q)&&q>0;
  $('#entry-total').textContent=Number.isFinite(q)?`${q} pcs`:'—';
  const available=o.type==='pack'?left(s):total(picklists(state).find(p=>p.id===o.source&&p.store.id===s.id).items.map(i=>i.target-i.picked));
  $('#entry-remainder').textContent=Number.isFinite(q)?`${available-q} pcs ${o.type==='pack'?'stay in Picked':'left to pick'}`:'Enter a valid quantity';
  const primary=$(`.sheet-foot [data-action="${o.type==='pack'?'seal':'record-pick'}"]`);primary.disabled=!valid;
  const invalid=inputs.some(i=>!i.validity.valid);$('#sheet-error').textContent=invalid?'Enter whole pieces from 0 to the quantity available.':'';
}
function handleAction(el){
  switch(el.dataset.action){
    case'tab':tab=el.dataset.tab;search='';renderPage();$(`#tab-${tab}`).focus({preventScroll:true});break;
    case'sort':if(sort[tab].field===el.dataset.field)sort[tab].direction*=-1;else sort[tab]={field:el.dataset.field,direction:1};renderData();break;
    case'pack':{const s=getStore(state,el.dataset.store);openOverlay({type:'pack',store:s.id,values:Object.fromEntries(s.items.map(i=>[i.id,0])),created:[],receipt:null});break;}
    case'pick':{const s=getStore(state,el.dataset.store),p=picklists(state).find(p=>p.id===el.dataset.source&&p.store.id===s.id);openOverlay({type:'pick',store:s.id,source:p.id,values:Object.fromEntries(p.items.map(i=>[i.id,i.target-i.picked]))});break;}
    case'fill-all':{const o=overlay,s=getStore(state,o.store);if(o.type==='pack')o.values=Object.fromEntries(s.items.map(i=>[i.id,leftOf(s,i.id)]));else o.values=Object.fromEntries(picklists(state).find(p=>p.id===o.source&&p.store.id===s.id).items.map(i=>[i.id,i.target-i.picked]));renderOverlay();updateEntry();break;}
    case'seal':{const o=overlay,result=commit(()=>sealKoli(state,o.store,o.values));if(result.ok){o.created.push(result.result.id);o.receipt=result.result;o.values=Object.fromEntries(getStore(state,o.store).items.map(i=>[i.id,0]));renderOverlay();}break;}
    case'record-pick':{const o=overlay,q=total(Object.values(o.values)),result=commit(()=>recordPicklist(state,o.store,o.source,o.values));if(result.ok){closeOverlay();message(`${q} pcs recorded as picked`);}break;}
    case'view-packed':closeOverlay('packed');break;
    case'close':closeOverlay();break;
    case'clear-selection':selected.clear();renderData();break;
    case'dispatch':if(selected.size)openOverlay({type:'dispatch'});break;
    case'confirm-dispatch':{tripNote=$('#trip-note').value;const result=commit(()=>dispatch(state,[...selected],tripNote));if(result.ok){selected.clear();closeOverlay('transit');message(`${result.result.id} dispatched`);}break;}
    case'koli':openOverlay({type:'koli',box:el.dataset.box});break;
    case'trip':openOverlay({type:'trip',trip:el.dataset.trip});break;
    case'print':window.print();break;
    case'reset':openOverlay({type:'reset'});break;
    case'confirm-reset':state=seed(storeCount);selected.clear();search='';save();closeOverlay();renderPage();message('Demo data restored');break;
  }
}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target&&!target.disabled){event.preventDefault();handleAction(target);}});
document.addEventListener('input',event=>{const input=event.target;if(input.id==='table-search'){search=input.value;renderData();}if(input.dataset.input==='entry'){overlay.values[input.dataset.item]=input.value===''?0:Number(input.value);input.classList.toggle('invalid',!input.validity.valid);updateEntry();}if(input.id==='trip-note')tripNote=input.value;});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.dataset.change==='demo-size'){storeCount=Number(input.value);state=readState();selected.clear();search='';render();}
  if(input.dataset.change==='select-koli'){input.checked?selected.add(input.value):selected.delete(input.value);const id=input.value;renderData();$(`[data-change="select-koli"][value="${id}"]`)?.focus({preventScroll:true});}
  if(input.dataset.change==='select-all'){visibleRows().forEach(x=>input.checked?selected.add(x.box.id):selected.delete(x.box.id));renderData();$('[data-change="select-all"]')?.focus({preventScroll:true});}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&overlay){event.preventDefault();closeOverlay();return;}
  if(overlay&&event.key==='Tab'){const nodes=[...document.querySelectorAll('.sheet button:not(:disabled),.sheet input:not(:disabled),.sheet textarea,.sheet select')];if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}
  if(!overlay&&event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();let index=tabNames.indexOf(tab);index=event.key==='Home'?0:event.key==='End'?3:(index+(event.key==='ArrowRight'?1:3))%4;tab=tabNames[index];search='';renderPage();$(`#tab-${tab}`).focus();}
});
render();
