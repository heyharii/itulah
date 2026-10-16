// Browser-local domain simulator. No production API calls.
export const STAGES = ['waiting','picked','packed','staged','loaded','transit','received','gap','lost','wrong','returnTransit','returned'];
export const LABELS = {waiting:'To pick',picked:'Picked',packed:'Packed',staged:'Surat jalan issued',loaded:'Loaded',transit:'In transit',received:'At intended store',gap:'Receiving discrepancy',lost:'Confirmed lost',wrong:'At wrong destination',returnTransit:'Return in progress',returned:'Returned · quarantine'};
export const SKU = {'OX-NV-M':{name:'Oxford shirt',variant:'Navy · M'},'TS-WH-L':{name:'Essential tee',variant:'White · L'},'JN-IN-32':{name:'Straight jeans',variant:'Indigo · 32'}};
export const STORES = ['Kemang','PIK Avenue','Cikupa'];
export function line(id,store,sku,buckets,extra={}) {
  const stages=Object.fromEntries(STAGES.map(s=>[s,buckets[s]||0]));
  const target=Object.values(stages).reduce((a,b)=>a+b,0);
  return {id,store,sku,stages,target,original:target,added:0,removed:0,pending:[],hold:false,carton:`KOLI-${store==='Kemang'?'087':store==='PIK Avenue'?'088':'089'}`, ...extra};
}
function order(id,lines,extra={}) {return {id,supplier:'Garmen Nusantara',source:'HO · Gudang',revision:1,cancelled:false,hold:false,lines,queue:[],lastError:null,events:[{time:'11 Oct 2026 · 09:00',actor:'MD · Nadya',text:'Allotment created',detail:`${lines.reduce((s,l)=>s+l.target,0)} pieces · ${new Set(lines.map(l=>l.store)).size} stores`}], ...extra};}
export function seed() {
  return {version:1,online:true,stock:{'OX-NV-M':180,'TS-WH-L':240,'JN-IN-32':96},orders:[
    order('ALT-001042',[
      line('a','Kemang','OX-NV-M',{waiting:20,picked:20,packed:40,transit:40}),
      line('b','Kemang','TS-WH-L',{packed:40}),
      line('c','PIK Avenue','OX-NV-M',{waiting:20,picked:20,packed:20,received:20}),
      line('d','Cikupa','JN-IN-32',{waiting:60})]),
    order('ALT-001043',[line('e','Kemang','TS-WH-L',{}, {original:50,removed:50,pending:[{id:'initial-e',stage:'packed',quantity:30,reason:'Store plan changed',actor:'MD · Nadya',time:'11 Oct 2026 · 10:12'}]}),line('f','PIK Avenue','JN-IN-32',{}, {original:20,removed:20,pending:[{id:'initial-f',stage:'picked',quantity:20,reason:'Store plan changed',actor:'MD · Nadya',time:'11 Oct 2026 · 10:12'}]})],{cancelled:true,events:[{time:'11 Oct 2026 · 10:12',actor:'MD · Nadya',text:'Allotment cancelled',detail:'70 pieces removed from demand · 50 pieces still need putting back'}]}),
    order('ALT-001044',[line('g','PIK Avenue','OX-NV-M',{waiting:5,received:95},{original:100,short:5,issue:{kind:'short',owner:'MD',quantity:5,resolved:false}})],{supplier:'Sentosa Apparel'}),
    order('ALT-001045',[line('h','Cikupa','TS-WH-L',{staged:40,loaded:20})],{supplier:'Sentosa Apparel'}),
    order('ALT-001046',[line('i','Kemang','JN-IN-32',{received:72})],{supplier:'Indigo Works'})
  ]};
}
export const scenarios = [
  {id:'mixed',name:'Partial dispatch + MD edit',hint:'Reduce Kemang Oxford from 120 to 60, then switch to Warehouse.'},
  {id:'cancel',name:'Cancel during packing',hint:'Cancel 100 pieces. 30 release now; 70 stay blocked until physically returned.'},
  {id:'issued',name:'SJ issued, truck not left',hint:'Warehouse reverses the document first; MD can then change the released quantity.'},
  {id:'departed',name:'Cancel after departure',hint:'Close 40 unsent pieces. Handle the 60 already departed through a linked Return.'},
  {id:'short',name:'95 / 100 received',hint:'The remaining 5 are still needed. MD can wait or close that balance.'},
  {id:'receipt',name:'SJ 100 · counted 95',hint:'Delivery count is complete with a 5-piece discrepancy. Inventory establishes the facts first.'},
  {id:'lost',name:'Lost confirmed',hint:'Inventory has confirmed 5 lost. MD chooses no replacement or a linked replacement.'},
  {id:'wrong',name:'Wrong destination',hint:'20 pieces are at PIK, intended for Kemang. Return starts from the actual location.'},
  {id:'offline',name:'Warehouse offline',hint:'MD requests a change. It remains pending until the warehouse acknowledges it.'},
  {id:'conflict',name:'MD + warehouse together',hint:'Open Edit target and simulate the warehouse packing while the form is open.'},
  {id:'finished',name:'Finished + later return',hint:'A return stays linked to the completed allotment; history remains visible.'}
];
export function scenario(id){
  const s=seed();
  const base = {
    mixed:s.orders[0],
    cancel:order('ALT-DEMO-CANCEL',[line('x','Kemang','OX-NV-M',{waiting:30,picked:20,packed:50})]),
    issued:s.orders[3],
    departed:order('ALT-DEMO-SENT',[line('x','Kemang','OX-NV-M',{waiting:20,packed:20,transit:60})]),
    short:s.orders[2],
    receipt:order('ALT-DEMO-RECEIPT',[line('x','Kemang','OX-NV-M',{received:95,gap:5},{issue:{kind:'gap',quantity:5,owner:'Inventory',resolved:false}})]),
    lost:order('ALT-DEMO-LOST',[line('x','Kemang','OX-NV-M',{received:95,lost:5},{issue:{kind:'lost',quantity:5,owner:'MD',resolved:false}})],{supplier:'Sentosa Apparel'}),
    wrong:order('ALT-DEMO-WRONG',[line('x','Kemang','OX-NV-M',{wrong:20},{issue:{kind:'wrong',quantity:20,owner:'MD',resolved:false,actual:'PIK Avenue'}})]),
    offline:s.orders[0],conflict:s.orders[0],finished:s.orders[4]
  }[id];
  if(!base)throw Error('Unknown scenario');s.orders=[base];s.online=id!=='offline';return s;
}
export const sum=(xs,fn)=>xs.reduce((a,x)=>a+fn(x),0);
export function pending(l){return sum(l.pending,p=>p.quantity);}
export function committed(l){return sum(['staged','loaded','transit','received','gap','lost','wrong','returnTransit','returned'],s=>l.stages[s]);}
export function departed(l){return sum(['transit','received','gap','lost','wrong','returnTransit','returned'],s=>l.stages[s]);}
export function floor(l){return committed(l);}
export function receivedEver(o){return sum(o.lines,l=>l.stages.received+(l.receivedReturned||0));}
export function totals(o){const t=Object.fromEntries(STAGES.map(k=>[k,sum(o.lines,l=>l.stages[k])]));return {...t,target:sum(o.lines,l=>l.target),original:sum(o.lines,l=>l.original),removed:sum(o.lines,l=>l.removed),pending:sum(o.lines,pending),floor:sum(o.lines,floor),departed:sum(o.lines,departed),stores:new Set(o.lines.map(l=>l.store)).size};}
export function status(o){const t=totals(o);if(o.queue.length)return 'Awaiting warehouse';if(o.cancelled)return 'Cancelled';if(o.hold)return 'On hold';if(t.waiting+t.picked+t.packed+t.staged+t.loaded+t.transit+t.gap)return 'Active';if(t.lost+t.wrong+t.removed||o.lines.some(l=>l.returnedBeforeReceipt))return 'Closed short';return 'Completed';}
export function finished(o){return ['Cancelled','Closed short','Completed'].includes(status(o));}
export function blocked(o,l){return o.hold||l.hold||o.queue.length>0||o.lines.some(x=>x.carton===l.carton&&pending(x)>0);}
export function preview(l,to){
  if(!Number.isSafeInteger(to)||to<floor(l))throw Error(`Minimum ${floor(l)} pieces: already on a surat jalan or further. Reverse an un-departed SJ through Warehouse, or use a Return after departure.`);
  if(to>=l.target)return {delta:to-l.target,release:0,picked:0,packed:0};
  let left=l.target-to;
  const release=Math.min(left,l.stages.waiting);left-=release;
  const picked=Math.min(left,l.stages.picked);left-=picked;
  const packed=Math.min(left,l.stages.packed);left-=packed;
  if(left)throw Error('This quantity is committed to a delivery. Refresh the current position.');
  return {delta:to-l.target,release,picked,packed};
}
function event(o,actor,text,detail='') {o.events.unshift({time:new Date().toLocaleString('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),actor,text,detail});}
function required(reason){if(!reason?.trim())throw Error('Choose a reason before continuing.');}
function quant(q,max){if(!Number.isSafeInteger(q)||q<=0||q>max)throw Error(`Enter a whole quantity from 1 to ${max}.`);}
function change(s,o,l,to,reason){
  const p=preview(l,to);const old=l.target;
  if(p.delta>0){if(s.stock[l.sku]<p.delta)throw Error(`Only ${s.stock[l.sku]} free pieces of ${l.sku} remain.`);s.stock[l.sku]-=p.delta;l.added+=p.delta;l.stages.waiting+=p.delta;}
  else if(p.delta<0){
    s.stock[l.sku]+=p.release;l.stages.waiting-=p.release;l.stages.picked-=p.picked;l.stages.packed-=p.packed;l.removed-=p.delta;
    for(const stage of ['picked','packed'])if(p[stage])l.pending.push({id:`${o.revision}-${l.id}-${stage}-${l.pending.length}`,stage,quantity:p[stage],reason,actor:'MD · Nadya',time:'Just now'});
  }
  l.target=to;if(l.short)l.short=Math.min(l.short,l.stages.waiting);
  if(l.issue?.kind==='short'&&l.stages.waiting===0)l.issue.resolved=true;
  return `${l.store} · ${l.sku}: ${old} → ${to}. ${p.release} released; ${p.picked+p.packed} to put back.`;
}
function execute(s,o,cmd){
  const l=o.lines.find(x=>x.id===cmd.line);const why=cmd.reason?.trim()||'';
  if(!l&&!['cancel','holdOrder','addLine'].includes(cmd.type))throw Error('This line is no longer available.');
  if(cmd.type==='edit'){
    if(o.cancelled||finished(o))throw Error('The request has ended. Create a linked new allotment.');required(why);event(o,'MD · Nadya','Target edited',change(s,o,l,cmd.quantity,why)+` ${why}`);
  }else if(cmd.type==='cancel'){
    required(why);if(o.cancelled)throw Error('Already cancelled.');
    const t=totals(o);if(t.floor===t.target)throw Error('No unsent balance remains. Use a Return for departed goods.');
    for(const x of o.lines)change(s,o,x,floor(x),why);
    o.cancelled=t.floor===0;event(o,'MD · Nadya',o.cancelled?'Allotment cancelled':'Unsent balance closed',`${t.target-t.floor} pieces removed · ${t.floor} committed pieces retained. ${why}`);
  }else if(cmd.type==='holdOrder'){
    required(why);o.hold=!o.hold;event(o,'MD · Nadya',o.hold?'Work put on hold':'Work resumed',why);
  }else if(cmd.type==='holdLine'){
    required(why);l.hold=!l.hold;event(o,'MD · Nadya',l.hold?'Line put on hold':'Line resumed',`${l.store} · ${l.sku}. ${why}`);
  }else if(cmd.type==='pick'||cmd.type==='pack'||cmd.type==='issue'||cmd.type==='load'||cmd.type==='depart'){
    if(o.cancelled||o.hold||l.hold||o.queue.length||cmd.type!=='pick'&&blocked(o,l))throw Error('This work is held. Resolve the affected change before proceeding.');
    const flow={pick:['waiting','picked'],pack:['picked','packed'],issue:['packed','staged'],load:['staged','loaded'],depart:['loaded','transit']}[cmd.type];
    quant(cmd.quantity,l.stages[flow[0]]);l.stages[flow[0]]-=cmd.quantity;l.stages[flow[1]]+=cmd.quantity;if(cmd.type==='pick'&&l.issue?.kind==='short'){l.short=Math.min(l.short||0,l.stages.waiting);l.issue.quantity=l.short;if(l.short===0)l.issue.resolved=true;}
    event(o,'Warehouse · Budi',`${LABELS[flow[1]]} · ${cmd.quantity} pieces`,`${l.store} · ${l.sku}`);
  }else if(cmd.type==='receive'){
    quant(cmd.quantity,l.stages.transit);l.stages.transit-=cmd.quantity;l.stages.received+=cmd.quantity;if(cmd.closeCount&&l.stages.transit){const gap=l.stages.transit;l.stages.transit=0;l.stages.gap+=gap;l.issue={kind:'gap',quantity:gap,owner:'Inventory',resolved:false};}event(o,'Store · Maya','Receive count submitted',`${cmd.quantity} pieces · ${l.store} · ${l.sku}`);
  }else if(cmd.type==='resolvePending'){
    const p=l.pending.find(x=>x.id===cmd.pendingId);if(!p)throw Error('This correction was already completed.');quant(cmd.quantity,p.quantity);
    s.stock[l.sku]+=cmd.quantity;p.quantity-=cmd.quantity;l.pending=l.pending.filter(x=>x.quantity>0);
    event(o,'Warehouse · Budi','Putback confirmed',`${cmd.quantity} ${l.sku} physically back at RACK-A01. ${pending(l)} still to put back.`);
  }else if(cmd.type==='moveBack'){
    required(why);if(!['picked','packed','staged','loaded'].includes(cmd.from))throw Error('Departed goods require a Return.');quant(cmd.quantity,l.stages[cmd.from]);
    const to=cmd.from==='loaded'?'staged':cmd.from==='staged'?'packed':cmd.to==='picked'?'picked':'waiting';
    l.stages[cmd.from]-=cmd.quantity;l.stages[to]+=cmd.quantity;
    event(o,'Warehouse · Budi',cmd.from==='staged'?'SJ corrected / voided before departure':'Physical step reversed',`${cmd.quantity} pieces · ${LABELS[cmd.from]} → ${LABELS[to]}. ${why}`);
  }else if(cmd.type==='short'){
    required(why);quant(cmd.quantity,l.stages.waiting);l.short=cmd.quantity;l.issue={kind:'short',quantity:cmd.quantity,owner:cmd.stockIssue?'Inventory':'MD',resolved:false};event(o,'Warehouse · Budi','Short pick reported',`${cmd.quantity} pieces · ${why}. Owner: ${l.issue.owner}`);
  }else if(cmd.type==='closeShort'){
    required(why);quant(cmd.quantity,l.stages.waiting);event(o,'MD · Nadya','Remaining demand closed',change(s,o,l,l.target-cmd.quantity,why));
  }else if(cmd.type==='investigate'){
    if(!l.issue||l.issue.resolved)throw Error('No investigation is open.');
    const amount=l.issue.quantity;
    if(cmd.result==='found'){if(l.issue.kind==='gap'&&l.stages.gap>=amount){l.stages.gap-=amount;l.stages.received+=amount;event(o,'Inventory · Rina','Receiving record corrected',`${amount} pieces verified at the intended store.`);}else event(o,'Inventory · Rina','Stock found',`${amount} pieces. Existing demand can continue.`);l.issue.resolved=true;l.short=0;}
    else{if(l.issue.kind==='short'){l.stages.waiting-=amount;l.stages.lost+=amount;l.short=0;}else if(l.stages.gap>=amount){l.stages.gap-=amount;l.stages.lost+=amount;}l.issue={kind:'lost',quantity:amount,owner:'MD',resolved:false};event(o,'Inventory · Rina','Loss confirmed',`${amount} pieces · MD to decide replacement. The old demand is settled.`);}
  }else if(cmd.type==='replacement'){
    required(why);if(l.issue?.kind!=='lost'||l.issue.resolved)throw Error('Loss must be confirmed and awaiting an MD decision.');
    if(s.stock[l.sku]<l.issue.quantity)throw Error('Insufficient free stock for the replacement.');const q=l.issue.quantity;
    const child=order(`${o.id}-R${s.orders.length+1}`,[line('replacement',l.store,l.sku,{waiting:q})],{parent:o.id,supplier:o.supplier});
    s.stock[l.sku]-=q;s.orders.push(child);l.issue.resolved=true;l.issue.replacement=child.id;event(o,'MD · Nadya','Replacement issued',`${child.id} · ${q} pieces. Old demand remains settled. ${why}`);
  }else if(cmd.type==='noReplacement'){
    required(why);if(!l.issue||l.issue.resolved)throw Error('The decision was already resolved.');l.issue.resolved=true;event(o,'MD · Nadya','No replacement required',why);
  }else if(cmd.type==='return'){
    required(why);const available=l.stages.transit+l.stages.received+l.stages.wrong;quant(cmd.quantity,available);
    let left=cmd.quantity;for(const stage of ['wrong','transit','received']){const q=Math.min(left,l.stages[stage]);l.stages[stage]-=q;l.stages.returnTransit+=q;left-=q;if(q&&stage!=='received')l.returnedBeforeReceipt=true;if(q&&stage==='received')l.receivedReturned=(l.receivedReturned||0)+q;}
    l.returnSource=l.issue?.actual||l.store;l.returnDocument=`RT-${o.id}-${o.revision}`;
    if(l.issue?.kind==='wrong'&&l.stages.wrong===0)l.issue.resolved=true;
    event(o,'MD · Nadya','Linked Return issued',`${l.returnDocument} · ${cmd.quantity} pieces · ${l.returnSource} → HO. Historical dispatch is retained. ${why}`);
  }else if(cmd.type==='returnReceive'){
    quant(cmd.quantity,l.stages.returnTransit);l.stages.returnTransit-=cmd.quantity;l.stages.returned+=cmd.quantity;event(o,'Warehouse · Budi','Return received into quarantine',`${cmd.quantity} pieces. Awaiting quality release; unavailable for new allotment.`);
  }else if(cmd.type==='releaseReturn'){
    required(why);quant(cmd.quantity,l.stages.returned-(l.qualityReleased||0));l.qualityReleased=(l.qualityReleased||0)+cmd.quantity;s.stock[l.sku]+=cmd.quantity;event(o,'Inventory · Rina','Returned stock released',`${cmd.quantity} pieces inspected and released to free stock. ${why}`);
  }else if(cmd.type==='addLine'){
    required(why);if(o.cancelled||finished(o))throw Error('Create a linked new allotment for an ended request.');
    if(!SKU[cmd.sku]||!STORES.includes(cmd.store))throw Error('Choose a valid SKU and store.');
    if(o.lines.some(x=>x.sku===cmd.sku&&x.store===cmd.store))throw Error('This SKU/store already exists. Edit its target instead.');quant(cmd.quantity,s.stock[cmd.sku]);
    s.stock[cmd.sku]-=cmd.quantity;const x=line(`new-${o.revision}`,cmd.store,cmd.sku,{waiting:cmd.quantity},{original:0,added:cmd.quantity});o.lines.push(x);event(o,'MD · Nadya','Line added',`${cmd.store} · ${cmd.sku} · ${cmd.quantity} pieces. ${why}`);
  }else throw Error('Unsupported action');
}
export function apply(state,id,cmd,expectedRevision){
  // Clone first: stock checks or failed multi-line commands never partially commit.
  const s=structuredClone(state),o=s.orders.find(x=>x.id===id);if(!o)throw Error('Allotment not found.');
  if(expectedRevision!==o.revision)throw Error('Warehouse progress changed while this form was open. Refresh the impact and review again.');
  const md=['edit','cancel','holdOrder','holdLine','closeShort','replacement','noReplacement','return','addLine'].includes(cmd.type);
  if(!s.online&&!md)throw Error('Warehouse is offline. Reconnect before executing physical work.');
  if(!s.online&&md){if(o.queue.length)throw Error('A request is already awaiting the warehouse. Reconnect before sending another.');o.queue.push({cmd,revision:o.revision});event(o,'MD · Nadya','Change requested · awaiting warehouse','Nothing is released until the warehouse applies this request.');assertState(s);return s;}
  execute(s,o,cmd);o.revision++;o.lastError=null;assertState(s);return s;
}
export function reconnect(state){
  let s=structuredClone(state);s.online=true;
  for(const id of s.orders.map(o=>o.id)){
    const o=s.orders.find(o=>o.id===id),requests=o.queue.splice(0);
    for(const r of requests){try{s=apply(s,id,r.cmd,r.revision);}catch(e){const x=s.orders.find(o=>o.id===id);x.lastError=e.message;event(x,'System','Change could not be applied',e.message);}}
  }
  assertState(s);return s;
}
export function tasks(state,role='ops'){
  const out=[];
  for(const o of state.orders)for(const l of o.lines){
    const base={order:o.id,line:l.id,store:l.store,sku:l.sku,revision:o.revision};
    if(role==='md'){
      if(l.issue&&!l.issue.resolved){out.push({...base,type:l.issue.owner==='Inventory'?'investigation':l.issue.kind,qty:l.issue.quantity,title:l.issue.owner==='Inventory'?'Inventory checking discrepancy':l.issue.kind==='lost'?'Decide replacement':l.issue.kind==='wrong'?'Decide goods at wrong store':'Decide remaining demand',owner:l.issue.owner,note:l.issue.kind==='wrong'?`Actual location: ${l.issue.actual}`:l.issue.kind==='lost'?'Confirmed loss · old demand settled':'Keep remaining demand, or close it'});}continue;
    }
    if(l.issue&&!l.issue.resolved&&l.issue.owner==='Inventory')out.push({...base,type:'investigation',qty:l.issue.quantity,title:'Await Inventory finding',owner:'Inventory',note:'Quantity / whereabouts uncertain · facts required before MD replacement',priority:1});
    for(const p of l.pending)out.push({...base,type:'correction',pendingId:p.id,qty:p.quantity,title:p.stage==='packed'?'Unpack & put back':'Put back to rack',owner:'Warehouse',note:`${p.stage==='packed'?l.carton:'Pick area'} → RACK-A01 · ${p.reason}`,priority:0});
    if(o.queue.length){if(l===o.lines[0])out.push({...base,type:'sync',qty:0,title:'Awaiting warehouse acknowledgement',owner:'Warehouse',note:'Requested change · stock not released',priority:1});continue;}
    if(o.hold||l.hold){out.push({...base,type:'held',qty:l.stages.waiting+l.stages.picked+l.stages.packed,title:'On hold',owner:'MD',note:'Resume request before continuing',priority:2});continue;}
    for(const [stage,title] of [['waiting','Pick'],['picked','Pack'],['packed','Issue surat jalan'],['staged','Load'],['loaded','Confirm departure'],['transit','Await store receipt'],['returnTransit','Receive Return']]){
      const qty=l.stages[stage];if(qty<=0)continue;
      const isBlocked=blocked(o,l)&&['picked','packed','staged','loaded'].includes(stage);
      out.push({...base,type:stage,qty,title:isBlocked?`${title} · carton held`:title,owner:stage==='transit'?'Store':'Warehouse',note:isBlocked?'Shared carton contains pieces MD removed':stage==='waiting'&&l.short?`${l.short} pieces reported short`:`${SKU[l.sku].name} · ${SKU[l.sku].variant}`,blocked:isBlocked,priority:isBlocked?2:3});
    }
    const quarantine=l.stages.returned-(l.qualityReleased||0);if(quarantine)out.push({...base,type:'quarantine',qty:quarantine,title:'Inspect returned stock',owner:'Inventory',note:'Quarantine · unavailable for new allotment',priority:2});
  }
  return out.sort((a,b)=>(a.priority||0)-(b.priority||0)||a.order.localeCompare(b.order));
}
export function assertState(s){
  for(const [sku,n]of Object.entries(s.stock))if(!Number.isSafeInteger(n)||n<0)throw Error(`Invalid free stock: ${sku}`);
  for(const o of s.orders)for(const l of o.lines){
    for(const stage of STAGES)if(!Number.isSafeInteger(l.stages[stage])||l.stages[stage]<0)throw Error(`Invalid ${stage}`);
    if(sum(STAGES,k=>l.stages[k])!==l.target)throw Error(`Target does not match live buckets for ${l.id}`);
    if(l.original+l.added-l.removed!==l.target)throw Error(`Demand ledger mismatch for ${l.id}`);
    if(l.pending.some(p=>!Number.isSafeInteger(p.quantity)||p.quantity<=0))throw Error('Invalid pending correction');
    if(floor(l)>l.target)throw Error('Target below committed quantity');
  }
  return true;
}
export function createAllotment(state,sku,quantities,reason){
  required(reason);if(!SKU[sku])throw Error('Choose an SKU.');const s=structuredClone(state);
  if(Object.values(quantities).some(q=>!Number.isSafeInteger(q)||q<0))throw Error('Store quantities must be whole non-negative numbers.');const entries=Object.entries(quantities).filter(([,q])=>q>0);if(!entries.length)throw Error('Enter a quantity for at least one store.');
  for(const [store,q]of entries){if(!STORES.includes(store))throw Error('Unknown store');quant(q,s.stock[sku]);}
  const total=sum(entries,([,q])=>q);if(total>s.stock[sku])throw Error(`Only ${s.stock[sku]} free pieces remain.`);
  if(!s.online)throw Error('New reservations require warehouse availability. Reconnect first.');
  s.stock[sku]-=total;const o=order(`ALT-NEW-${1047+s.orders.length}`,entries.map(([store,q],i)=>line(`create-${i}`,store,sku,{waiting:q})));event(o,'MD · Nadya','Allotment issued',reason);s.orders.unshift(o);assertState(s);return s;
}
