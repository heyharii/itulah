// One record model drives the full-height detail, editable form, and review.
const recordCatalog=[
 {name:'Kemeja Katun Oxford',category:'Pria · Kemeja',sku:'KM-OXF-01',price:125000},
 {name:'Celana Chino Regular',category:'Pria · Celana',sku:'CL-CHN-02',price:135000},
 {name:'Polo Pique',category:'Pria · Polo',sku:'PL-PIQ-03',price:72500},
 {name:'Dress Anak Motif Bunga',category:'Anak Perempuan · Dress',sku:'DR-FLR-04',price:52500},
 {name:'Kaos Katun Premium',category:'Pria · Kaos',sku:'KS-CTN-05',price:45000},
 {name:'Blus Katun Linen',category:'Wanita · Blus',sku:'BL-LIN-06',price:85000},
 {name:'Jaket Denim Basic',category:'Pria · Outerwear',sku:'JK-DNM-07',price:185000},
 {name:'Cardigan Rajut',category:'Wanita · Knitwear',sku:'CD-KNT-08',price:145000},
 {name:'Blazer Formal',category:'Wanita · Outerwear',sku:'BL-FRM-09',price:205000},
 {name:'Setelan Anak',category:'Anak · Setelan',sku:'ST-CHD-10',price:100000}
];
document.addEventListener('pointerdown',()=>document.documentElement.dataset.recordInput='pointer');
document.addEventListener('keydown',()=>document.documentElement.dataset.recordInput='keyboard');
function recordMotion(id){$(id).dataset.motion=document.documentElement.dataset.recordInput||'keyboard'}
let recordDraft={lines:[],edit:null},recordSelected=null,recordReview=null,countReviewTarget=null,countReviewLines=[];const catalogSelection=new Set();
icons.print='<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>';
document.querySelectorAll('[data-icon="print"]').forEach(e=>e.innerHTML=icon('print'));
function recordLines(o){if(o.lines)return o.lines.map(l=>({...l}));if(o.id===0)return recordCatalog.slice(0,10).map(l=>({...l,qty:90,received:0}));const price=Math.ceil(o.value/o.quantity),qty=Math.floor(o.quantity/o.items);return Array.from({length:o.items},(_,i)=>({...recordCatalog[i%recordCatalog.length],name:recordCatalog[i%recordCatalog.length].name+(o.items>6?' · '+(i+1):''),qty:i===o.items-1?o.quantity-qty*(o.items-1):qty,price,received:0}))}
function recordTotals(lines,discount=0,type='fixed'){const quantity=lines.reduce((s,l)=>s+l.qty,0),subtotal=lines.reduce((s,l)=>s+l.qty*l.price,0),cut=Math.round(type==='percent'?subtotal*discount/100:discount);return{quantity,subtotal,discount:cut,total:Math.max(0,subtotal-cut)}}
function setRecordView(view){document.querySelectorAll('[data-record-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.recordView===view))}
function recordMeta(o,lines){const subtotal=recordTotals(lines).subtotal;return{payment:o.payment||'Giro',terms:o.terms??30,notes:o.notes||'',conditions:o.conditions||'Standard purchase terms',discount:o.discount??Math.max(0,subtotal-o.value),discountType:o.discountType||'fixed'}}
// Received includes accepted units and units waiting to be returned.
function receiptTotals(lines,totals,discountType='fixed'){
 const received=lines.reduce((n,l)=>n+(l.received||0),0),notAsOrdered=lines.reduce((n,l)=>n+(l.notAsOrdered||0),0);
 const accepted=received-notAsOrdered,acceptedGross=lines.reduce((n,l)=>n+((l.received||0)-(l.notAsOrdered||0))*l.price,0);
 const returnGross=lines.reduce((n,l)=>n+(l.notAsOrdered||0)*l.price,0),discountRate=totals.subtotal?totals.discount/totals.subtotal:0;
 const perPieceDiscount=totals.quantity?totals.discount/totals.quantity:0,acceptedDiscount=Math.round(discountType==='percent'?acceptedGross*discountRate:accepted*perPieceDiscount),returnDiscount=Math.round(discountType==='percent'?returnGross*discountRate:notAsOrdered*perPieceDiscount);
 return {received,notAsOrdered,accepted,acceptedGross,acceptedDiscount,acceptedValue:Math.max(0,acceptedGross-acceptedDiscount),returnValue:Math.max(0,returnGross-returnDiscount),perPieceDiscount};
}
function receiptExample(){
 const lines=recordCatalog.slice(0,3).map((l,i)=>({...l,qty:[800,700,500][i],received:[800,700,500][i],notAsOrdered:[80,70,50][i]}));
 return {...orders.find(o=>o.id===0),quantity:2000,received:2000,lines,discount:4000000,discountType:'fixed',value:226750000,previewReceipt:true};
}
function countReviewTotals(){
 const accepted=countReviewLines.reduce((n,l)=>n+Math.min(l.counted,Math.max(0,l.qty-(l.received||0)+(l.notAsOrdered||0))),0);
 const toReturn=countReviewLines.reduce((n,l)=>n+Math.max(0,l.counted-Math.max(0,l.qty-(l.received||0)+(l.notAsOrdered||0))),0);
 const short=countReviewLines.reduce((n,l)=>n+Math.max(0,Math.max(0,l.qty-(l.received||0)+(l.notAsOrdered||0))-l.counted),0);
 const counted=countReviewLines.reduce((n,l)=>n+l.counted,0);
 return{accepted,toReturn,short,counted};
}
function renderCountReview(){
 const o=countReviewTarget;if(!o)return;const totals=countReviewTotals(),q=countQueue[o.id],lines=recordLines(o),meta=recordMeta(o,lines),orderTotals=recordTotals(lines,meta.discount,meta.discountType);
 const reviewLines=countReviewLines.map(l=>{const remaining=Math.max(0,l.qty-(l.received||0)+(l.notAsOrdered||0));return{...l,received:l.counted,notAsOrdered:Math.max(0,l.counted-remaining)}});
 const values=receiptTotals(reviewLines,orderTotals,meta.discountType);
 $('count-review-number').textContent=o.number;$('count-review-title').textContent=o.supplier;$('count-review-delivery').textContent=date(o.delivery);
 $('count-review-ordered').innerHTML=fmt(orderTotals.quantity)+' <small>pcs</small>';$('count-review-counted').innerHTML=fmt(totals.counted)+' <small>pcs</small>';
 $('count-review-body').innerHTML=`<section class="record-section count-review-section" aria-label="Counted purchase order items"><div class="count-review-meta"><span>Counted by</span><strong>${esc(q.countedBy)}</strong><time>${esc(q.countedAt)}</time></div>
 <div class="record-table-wrap"><table class="record-table count-review-table" aria-label="Counted purchase order items"><colgroup><col style="width:42%"><col style="width:18%"><col style="width:18%"><col style="width:22%"></colgroup><thead><tr><th>Item</th><th class="right">Ordered</th><th class="right">Counted</th><th class="right">Difference</th></tr></thead><tbody>${countReviewLines.map(l=>{const delta=l.counted-l.qty;return`<tr><td class="item-name"><span class="detail-item-thumb">${(l.image_url||l.image)?`<img src="${esc(l.image_url||l.image)}" alt="" loading="lazy">`:`<span class="detail-item-placeholder" aria-hidden="true">${icon('shirt')}</span>`}</span><span class="detail-item-copy">${esc(l.name)}<span class="item-meta">${esc(l.sku||'Custom item')} · ${esc(l.category)}</span></span></td><td data-label="Ordered" class="right num">${fmt(l.qty)} pcs</td><td data-label="Counted" class="right num">${fmt(l.counted)} pcs</td><td data-label="Difference" class="right num"><span class="count-difference ${delta>0?'over':delta<0?'short':'match'}">${delta>0?'+':''}${fmt(delta)} pcs</span></td></tr>`}).join('')}</tbody></table></div></section>
 <div class="count-review-summary-row"><section class="receipt-ledger count-review-ledger" aria-label="Count results"><div class="ledger-grid">
 ${totals.toReturn?`<span class="ledger-return-label">Not as ordered</span><span class="ledger-quantity num">${fmt(totals.toReturn)} pcs</span><span class="ledger-money ledger-return-value num">${rp(values.returnValue)}</span><div class="ledger-divider"></div>`:''}
 <span>Total accepted</span><span class="ledger-quantity num">${fmt(totals.accepted)} pcs</span><strong class="ledger-money ledger-accepted num">${rp(values.acceptedValue)}</strong>
 </div>${totals.short?`<div class="ledger-expectation">Still expected <span class="num">${fmt(totals.short)} pcs</span></div>`:''}</section></div>`;
 $('count-review-foot').innerHTML=`<div class="foot-total"><span>${fmt(totals.counted)} pcs counted</span><strong>${fmt(totals.accepted)} pcs accepted</strong></div><button class="button secondary" id="count-recount">Recount</button>${totals.short?'<button class="button secondary close-short" id="count-close-short">Close short</button>':''}<button class="button primary" id="count-partial-receive">Partial receive</button>`;
 $('count-recount').onclick=()=>{delete countQueue[o.id];o.reviewPending=false;o.status='recount';$('count-review').close();setRecordView('list');render();toast('Count sent back for recount')};
 $('count-partial-receive').onclick=()=>applyCountReview(false);
 if(totals.short)$('count-close-short').onclick=()=>applyCountReview(true);
}
function openOrderCountReview(o){
 if(!o||!o.reviewPending||!countQueue[o.id])return;countReviewTarget=o;const q=countQueue[o.id];
 countReviewLines=recordLines(o).map((l,i)=>({...l,counted:q.counts[i]||0}));
 $('detail').close();setRecordView('review-count');$('count-review').dataset.motion=document.documentElement.dataset.recordInput||'keyboard';renderCountReview();$('count-review').showModal();
}
function applyCountReview(closeShort){
 const o=countReviewTarget;if(!o)return;const summary=countReviewTotals(),meta=recordMeta(o,countReviewLines),totals=recordTotals(countReviewLines,meta.discount,meta.discountType);
 o.lines=countReviewLines.map(l=>{const remaining=Math.max(0,l.qty-(l.received||0)+(l.notAsOrdered||0)),receivedNow=l.counted,returnedNow=Math.max(0,receivedNow-remaining);return{...l,received:(l.received||0)+receivedNow,notAsOrdered:(l.notAsOrdered||0)+returnedNow}});
 o.received=o.lines.reduce((n,l)=>n+(l.received||0),0);o.receivedValue=receiptTotals(o.lines,totals,meta.discountType).acceptedValue;o.reviewPending=false;o.status='receiving';
 if(closeShort)o.closedShort=(o.closedShort||0)+summary.short;
 delete countQueue[o.id];$('count-review').close();setRecordView('list');render();openOrderDetail(o);
 toast(closeShort?`${fmt(summary.accepted)} pcs received · ${fmt(summary.short)} pcs closed short`:`${fmt(summary.accepted)} pcs partially received`);
}
function openOrderDetail(o){
 if(!o)return;recordSelected=o;
 const lines=recordLines(o),meta=recordMeta(o,lines),totals=recordTotals(lines,meta.discount,meta.discountType),receipt=receiptTotals(lines,totals,meta.discountType),stillExpected=Math.max(0,totals.quantity-receipt.accepted-(o.closedShort||0));
 $('create').close();$('count-review').close();$('detail-number').textContent=o.number;$('detail-title').textContent=o.supplier;$('detail-status').textContent=label(o.status)||'Active';$('detail-status').dataset.status=o.status||'active';
 $('detail-delivery').textContent=date(o.delivery);$('detail-delivery').classList.toggle('late',o.state==='active'&&days(o.delivery)>0);
 $('detail-ordered').innerHTML=fmt(totals.quantity)+' <small>pcs</small>';$('detail-received').innerHTML=fmt(receipt.received)+' <small>pcs</small>';
 $('detail-body').innerHTML=`
 <section class="record-section">
  <div class="record-table-wrap"><table class="record-table" aria-label="Order items">
   <colgroup><col style="width:35%"><col style="width:13%"><col style="width:13%"><col style="width:18%"><col style="width:21%"></colgroup>
   <thead><tr><th>Item</th><th class="right">Ordered</th><th class="right">Received</th><th class="right">Unit price</th><th class="right">Amount</th></tr></thead>
   <tbody>${lines.map(l=>`<tr><td class="item-name"><span class="detail-item-thumb">${(l.image_url||l.image)?`<img src="${esc(l.image_url||l.image)}" alt="" loading="lazy">`:`<span class="detail-item-placeholder" aria-hidden="true">${icon('shirt')}</span>`}</span><span class="detail-item-copy">${esc(l.name)}<span class="item-meta">${esc(l.sku||'Custom item')} · ${esc(l.category)}</span></span></td><td data-label="Ordered" class="right num">${fmt(l.qty)}<span class="unit"> pcs</span></td><td data-label="Received" class="right num ${l.received?'':'muted-quantity'}">${fmt(l.received||0)}<span class="unit"> pcs</span></td><td data-label="Unit price" class="right num money"><span class="cur">Rp</span> ${fmt(l.price)}</td><td data-label="Amount" class="right num money"><span class="cur">Rp</span> ${fmt(l.qty*l.price)}</td></tr>`).join('')}</tbody>
  </table></div>
 </section>
 <div class="detail-under-table detail-ledger-row">
  <div class="detail-support detail-support-bottom"><dl class="detail-payment"><dt>Payment</dt><dd>${esc(meta.payment)} · ${meta.terms===0?'Due on receipt':meta.terms+' days'}</dd></dl><div class="payment-notes"><span>Notes</span><p>${meta.notes?esc(meta.notes):'—'}</p></div></div>
  <section class="receipt-ledger" aria-label="Order and accepted totals">
   <div class="ledger-grid">
    <span>Total ordered</span><span class="ledger-quantity num">${fmt(totals.quantity)} pcs</span><strong class="ledger-money num">${rp(totals.subtotal)}</strong>
    <span class="ledger-muted">Discount${meta.discountType==='percent'?' · '+meta.discount+'%':''}</span><span class="ledger-quantity num">${meta.discountType==='percent'?'≈ ':''}${rp(Math.round(receipt.perPieceDiscount))} / pcs</span><span class="ledger-money ledger-muted num">${totals.discount?'− ':''}${rp(totals.discount)}</span>
    <div class="ledger-divider"></div>
    <span>Total accepted</span><span class="ledger-quantity num">${fmt(receipt.accepted)} pcs</span><strong class="ledger-money ledger-accepted num">${rp(receipt.acceptedValue)}</strong>
   </div>
   ${receipt.notAsOrdered?`<div class="ledger-return"><span>Not as ordered</span><span class="num">${fmt(receipt.notAsOrdered)} pcs</span><span class="ledger-return-status">Will return</span></div>`:''}
   ${o.closedShort?`<div class="ledger-expectation">Closed short <span class="num">${fmt(o.closedShort)} pcs</span></div>`:o.received&&stillExpected?`<div class="ledger-expectation">Still expected <span class="num">${fmt(stillExpected)} pcs</span></div>`:''}
  </section>
 </div>
 <details class="record-activity"><summary>Activity</summary><div class="activity-row"><span>Order ${o.added?'created':'issued'} · ${esc(o.supplier)}</span><time>${o.added?'13 Oct 2026':'08 Oct 2026'}</time></div></details>`;
 $('detail-body').scrollTop=0;setRecordView(o.previewReceipt?'receipt':'detail');recordMotion('detail');$('detail').showModal();
}
function openOrderCreate(o=null){$('detail').close();recordDraft={lines:o?recordLines(o):[],edit:o?.id??null};const meta=o?recordMeta(o,recordDraft.lines):{payment:'Giro',terms:30,notes:'',conditions:'Standard purchase terms',discount:0,discountType:'percent'};$('create-form').reset();$('record-supplier').innerHTML='<option value="">Choose a supplier</option>'+[...new Set(orders.map(o=>o.supplier))].sort().map(s=>`<option>${esc(s)}</option>`).join('');$('record-supplier').value=o?.supplier||'';$('record-delivery').value=o?.delivery||'2026-10-20';$('record-payment').value=meta.payment;$('record-terms').value=String(meta.terms);$('record-notes').value=meta.notes;$('record-conditions').value=meta.conditions;$('record-discount').value=meta.discount;$('record-discount-type').value=meta.discountType;$('create-title').textContent=o?'Edit order':'New order';$('create').querySelector('.record-head [data-close]').setAttribute('aria-label',o?'Close edit order':'Close new order');$('create-eyebrow').textContent=o?o.number:'Purchase order';$('record-error').hidden=true;renderCreateLines();setRecordView('create');recordMotion('create');$('create').showModal();$('create').querySelector('.record-body').scrollTop=0}
function createTotals(){return recordTotals(recordDraft.lines,+$('record-discount').value||0,$('record-discount-type').value)}
function updateCreateTotals(){const t=createTotals(),discount=$('record-discount');discount.max=$('record-discount-type').value==='percent'?'100':String(t.subtotal);const percent=$('record-discount-type').value==='percent';document.querySelectorAll('[data-discount-type]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.discountType===$('record-discount-type').value));$('discount-prefix').hidden=percent;$('discount-suffix').hidden=!percent;$('discount-help').textContent=percent?'Calculated from the subtotal.':'Total discount for this order.';$('create-item-count').textContent=recordDraft.lines.length;$('create-quantity').textContent=fmt(t.quantity)+' pcs';$('create-subtotal').textContent=rp(t.subtotal);$('create-discount').textContent=(t.discount?'−':'')+rp(t.discount);$('create-grand').textContent=rp(t.total);$('create-footer-grand').textContent=rp(t.total);$('create-footer-label').textContent=recordDraft.lines.length+' '+(recordDraft.lines.length===1?'item':'items')+' · '+fmt(t.quantity)+' pcs';recordDraft.lines.forEach((l,i)=>{const cell=$('create-items').querySelector('[data-line-amount="'+i+'"]');if(cell)cell.textContent=rp(l.qty*l.price)})}
function renderCreateLines(){const lines=recordDraft.lines;$('create-items').innerHTML=lines.length?`<div class="record-table-wrap"><table class="record-table create-lines" aria-label="Items to order"><colgroup><col style="width:39%"><col style="width:15%"><col style="width:19%"><col style="width:22%"><col style="width:5%"></colgroup><thead><tr><th>Item</th><th class="right">Quantity</th><th class="right">Unit price</th><th class="right">Amount</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${lines.map((l,i)=>`<tr><td class="item-name">${esc(l.name)}<span class="item-meta">${esc(l.sku||'Custom item')} · ${esc(l.category)}</span></td><td data-label="Quantity"><input type="number" min="1" step="1" value="${l.qty}" data-line="${i}" data-field="qty" aria-label="Quantity for ${esc(l.name)}" required></td><td data-label="Unit price"><input type="number" min="1" step="1" value="${l.price}" data-line="${i}" data-field="price" aria-label="Unit price for ${esc(l.name)}" required></td><td data-label="Amount" class="right money num" data-line-amount="${i}">${rp(l.qty*l.price)}</td><td class="remove-cell"><button type="button" class="remove-item" data-remove-line="${i}" aria-label="Remove ${esc(l.name)}">${icon('close')}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="record-empty">${icon('box')}<strong>Add items to this order</strong><span>Choose from the catalogue or enter a new item.</span></div>`;updateCreateTotals()}
function openRecordCatalog(){catalogSelection.clear();$('catalog-search').value='';renderCatalog();$('record-catalog').showModal()}
function renderCatalog(){const q=$('catalog-search').value.toLowerCase();$('catalog-items').innerHTML=recordCatalog.map((l,i)=>({l,i})).filter(({l})=>(l.name+' '+l.sku+' '+l.category).toLowerCase().includes(q)).map(({l,i})=>`<label class="catalog-row"><input type="checkbox" data-catalog="${i}" ${catalogSelection.has(i)?'checked':''}><span class="catalog-copy"><strong>${esc(l.name)}</strong><small>${esc(l.sku)} · ${esc(l.category)}</small></span><span class="catalog-price">${rp(l.price)}</span></label>`).join('')||'<p class="record-notes">No matching items.</p>';updateCatalogCount()}
function updateCatalogCount(){$('catalog-count').textContent=catalogSelection.size+' selected';$('add-catalog-items').disabled=!catalogSelection.size}
function closeRecordScreens(){['detail','create','count-review','record-catalog','record-custom','record-review'].forEach(id=>$(id).close());setRecordView('list')}
$('browse-items').onclick=openRecordCatalog;$('catalog-search').oninput=renderCatalog;$('catalog-items').onchange=e=>{if(e.target.dataset.catalog!==undefined){const i=+e.target.dataset.catalog;e.target.checked?catalogSelection.add(i):catalogSelection.delete(i);updateCatalogCount()}};
$('add-catalog-items').onclick=()=>{catalogSelection.forEach(i=>{const item=recordCatalog[i],existing=recordDraft.lines.find(l=>l.sku===item.sku);if(existing)existing.qty++;else recordDraft.lines.push({...item,qty:1,received:0})});renderCreateLines();$('record-error').hidden=true;$('record-catalog').close()};
$('custom-item').onclick=()=>{$('custom-form').reset();$('record-custom').showModal()};$('custom-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);recordDraft.lines.push({name:String(f.get('name')).trim(),category:'Custom item',sku:'',qty:+f.get('qty'),price:+f.get('price'),received:0});renderCreateLines();$('record-error').hidden=true;$('record-custom').close()};
$('create-items').oninput=e=>{if(e.target.dataset.line!==undefined){const l=recordDraft.lines[+e.target.dataset.line];l[e.target.dataset.field]=Math.max(0,+e.target.value||0);updateCreateTotals()}};
['record-discount','record-discount-type'].forEach(id=>$(id).addEventListener('input',updateCreateTotals));
$('create-form').onsubmit=e=>{e.preventDefault();if(!recordDraft.lines.length){$('record-error').textContent='Add at least one item before reviewing the order.';$('record-error').hidden=false;$('record-error').scrollIntoView({block:'nearest'});return}const t=createTotals();if(t.total<=0){$('record-error').textContent='The order total must be greater than Rp 0.';$('record-error').hidden=false;return}recordReview={supplier:$('record-supplier').value,delivery:$('record-delivery').value,payment:$('record-payment').value,terms:+$('record-terms').value,notes:$('record-notes').value,conditions:$('record-conditions').value,discount:+$('record-discount').value,discountType:$('record-discount-type').value,totals:t,lines:recordDraft.lines.map(l=>({...l}))};$('review-body').innerHTML=`<div class="review-info"><div><span>Supplier</span><strong>${esc(recordReview.supplier)}</strong></div><div><span>Delivery date</span><strong>${date(recordReview.delivery)}</strong></div><div><span>Payment</span><strong>${esc(recordReview.payment)} · ${recordReview.terms===0?'Due on receipt':recordReview.terms+' days'}</strong></div><div><span>Items</span><strong>${recordReview.lines.length} items · ${fmt(t.quantity)} pcs</strong></div></div><section class="record-summary"><div><span>Subtotal</span><span class="num">${rp(t.subtotal)}</span></div><div><span>Discount</span><span class="num">${t.discount?'−':''}${rp(t.discount)}</span></div><div class="grand-row"><strong>Order total</strong><strong class="num">${rp(t.total)}</strong></div></section><div class="review-note">Design preview · This order stays in this browser tab.</div>`;$('confirm-order').textContent=recordDraft.edit===null?'Create order':'Save changes';$('record-review').showModal()};
$('confirm-order').onclick=()=>{const r=recordReview;if(!r)return;let o;if(recordDraft.edit!==null){o=orders.find(o=>o.id===recordDraft.edit);if(!o.added){snapshot.value+=r.totals.total-o.value;snapshot.quantity+=r.totals.quantity-o.quantity;snapshot.overdue+=(r.delivery<today?1:0)-(o.delivery<today?1:0)}Object.assign(o,{supplier:r.supplier,delivery:r.delivery,quantity:r.totals.quantity,value:r.totals.total,items:r.lines.length,received:r.lines.reduce((n,l)=>n+(l.received||0),0),receivedValue:receiptTotals(r.lines,r.totals,r.discountType).acceptedValue,lines:r.lines,payment:r.payment,terms:r.terms,notes:r.notes,conditions:r.conditions,discount:r.discount,discountType:r.discountType});}else{o={id:Date.now(),supplier:r.supplier,number:'PO-131026-'+String(7+added).padStart(3,'0'),delivery:r.delivery,quantity:r.totals.quantity,value:r.totals.total,received:0,receivedValue:0,items:r.lines.length,lines:r.lines,status:'active',state:'active',added:true,payment:r.payment,terms:r.terms,notes:r.notes,conditions:r.conditions,discount:r.discount,discountType:r.discountType};orders.unshift(o);added++}recordReview=null;$('record-review').close();$('create').close();state='active';lateOnly=false;sortKey=null;$('search').value='';$('supplier-filter').value='';$('status-filter').value='';suppliers();render();openOrderDetail(o);toast(recordDraft.edit===null?'Order created in preview':'Order updated in preview')};
$('detail-edit').onclick=()=>openOrderCreate(recordSelected);$('detail-print').onclick=()=>window.print();
document.addEventListener('click',e=>{const screen=e.target.closest('[data-record-view]');if(screen){closeRecordScreens();if(screen.dataset.recordView==='detail')openOrderDetail(orders.find(o=>o.id===0)||orders[0]);if(screen.dataset.recordView==='review-count')openOrderCountReview(orders.find(o=>o.reviewPending)||orders[1]);if(screen.dataset.recordView==='create')openOrderCreate();if(screen.dataset.recordView==='receipt')openOrderDetail(receiptExample())}if(e.target.closest('[data-open-catalog]'))openRecordCatalog();const remove=e.target.closest('[data-remove-line]');if(remove){recordDraft.lines.splice(+remove.dataset.removeLine,1);renderCreateLines()}});
['detail','create'].forEach(id=>$(id).addEventListener('close',()=>{if(!$('detail').open&&!$('create').open)setRecordView('list')}));
function applyDetailScenario(key){
 const o=orders[0],lines=recordLines(o);if(!key||key==='ten-items')return;
 lines.forEach(l=>{l.received=0;l.notAsOrdered=0});o.notes='';o.status='active';o.state='active';o.delivery='2027-01-01';
 if(key==='partial'){[90,90,45].forEach((n,i)=>lines[i].received=n);o.status='receiving'}
 if(key==='not-as-ordered'){[100,90,45].forEach((n,i)=>lines[i].received=n);lines[0].notAsOrdered=10;o.status='receiving'}
 if(key==='overdue')o.delivery='2026-10-09';
 if(key==='completed'){lines.forEach(l=>l.received=l.qty);o.status='completed';o.state='completed';o.delivery='2026-10-13'}
 if(key==='cancelled'){o.status='cancelled';o.state='cancelled';o.notes='Supplier could not deliver before 14 Oct.'}
 o.lines=lines;o.quantity=lines.reduce((n,l)=>n+l.qty,0);o.received=lines.reduce((n,l)=>n+l.received,0);o.items=lines.length;
}
const initialParams=new URLSearchParams(location.search);applyDetailScenario(initialParams.get('case'));
const initialRecordView=initialParams.get('view');if(initialRecordView==='receipt')openOrderDetail(receiptExample());else if(initialRecordView==='detail')openOrderDetail(orders[0]);else if(initialRecordView==='review-count')openOrderCountReview(orders.find(o=>o.reviewPending)||orders[1]);else if(initialRecordView==='create')openOrderCreate();else setRecordView('list');

$('navigation-toggle').onclick=()=>{const hidden=document.documentElement.dataset.navigationHidden==='true';document.documentElement.dataset.navigationHidden=String(!hidden);$('navigation-toggle').textContent=hidden?'Hide navigation':'Show navigation';$('navigation-toggle').setAttribute('aria-expanded',String(hidden))};

document.querySelectorAll('[data-discount-type]').forEach(b=>b.onclick=()=>{$('record-discount-type').value=b.dataset.discountType;updateCreateTotals()});
