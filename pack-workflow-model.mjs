// Isolated sample data. This prototype never calls a production API.
export const total = values => values.reduce((a, b) => a + b, 0);
const item = (id, name, variant, code, source, picked, target, kind, color) => ({id, name, variant, code, source, picked, target, kind, color});
const box = (id, no, items, sealed) => ({id, no, items, sealed, trip:null});
export function seed(storeCount=13) {
  return extendDemoRoster({version:1, nextBox:108, nextTrip:1, trips:[], stores:[
    {id:'c001',code:'C001',name:'Cikupa',alts:['ALT-00000036','ALT-00000037'],items:[
      item('ox-m','Oxford shirt','White · M','OX-WHT-M','ALT-00000036',12,14,'shirt','#dce3ec'),
      item('ox-l','Oxford shirt','White · L','OX-WHT-L','ALT-00000036',8,8,'shirt','#dce3ec'),
      item('bs-m','Basic cotton tee','Black · M','BS-BLK-M','ALT-00000037',10,10,'tee','#4b5059'),
      item('bs-l','Basic cotton tee','Black · L','BS-BLK-L','ALT-00000037',6,8,'tee','#4b5059')
    ],boxes:[box('A00101',1,{'ox-m':8,'ox-l':4},true),box('A00102',2,{'ox-l':2,'bs-m':4},true),box('A00103',3,{'bs-m':3,'bs-l':2},false)]},
    {id:'c005',code:'C005',name:'Jambi',alts:['ALT-00000033'],items:[
      item('fl-37','Everyday flat shoes','Black · 37','FL-BLK-37','ALT-00000033',10,10,'shoe','#585561'),
      item('fl-38','Everyday flat shoes','Black · 38','FL-BLK-38','ALT-00000033',10,10,'shoe','#585561')
    ],boxes:[box('A00104',1,{'fl-37':6,'fl-38':6},true)]},
    {id:'c009',code:'C009',name:'WMJB',alts:['ALT-00000038'],items:[
      item('kd-s','Kids character tee','Blue · S','KD-BLU-S','ALT-00000038',8,10,'tee','#8caed8'),
      item('kd-m','Kids character tee','Blue · M','KD-BLU-M','ALT-00000038',6,8,'tee','#8caed8'),
      item('kd-l','Kids character tee','Blue · L','KD-BLU-L','ALT-00000038',4,6,'tee','#8caed8')
    ],boxes:[]},
    {id:'c002',code:'C002',name:'Muaro Bungo',alts:['ALT-00000032'],items:[
      item('ch-30','Slim fit chino','Khaki · 30','CH-KHK-30','ALT-00000032',12,12,'pants','#c3af8c'),
      item('ch-32','Slim fit chino','Khaki · 32','CH-KHK-32','ALT-00000032',12,12,'pants','#c3af8c')
    ],boxes:[box('A00105',1,{'ch-30':12},true),box('A00106',2,{'ch-32':12},true)]}
  ]},storeCount);
}
// Extra store names are placeholders for testing navigation at real workloads.
// Existing demo picks, open koli and trips survive the four-store upgrade.
export function extendDemoRoster(state,storeCount=13) {
  if(![13,30].includes(storeCount)) throw Error('Choose the 13-store or 30-store demo.');
  for(let no=1;no<=storeCount;no++) {
    const digits=String(no).padStart(3,'0'),id='c'+digits;
    if(state.stores.some(s=>s.id===id)) continue;
    const source='ALT-'+String(40+no).padStart(8,'0');
    const mode=no%4,picked=mode===0?[0,0]:[10,8];
    const items=[item('tee-m','Basic cotton tee','Navy · M','BT-NVY-M',source,picked[0],10,'tee','#7186a3'),item('tee-l','Basic cotton tee','Navy · L','BT-NVY-L',source,picked[1],8,'tee','#7186a3')];
    const boxes=mode===1?[box('A'+String(1000+no).padStart(5,'0'),1,{'tee-m':4,'tee-l':3},false)]:mode===2?[box('A'+String(1000+no).padStart(5,'0'),1,{'tee-m':10,'tee-l':8},true)]:[];
    state.stores.push({id,code:'C'+digits,name:'Toko '+String(no).padStart(2,'0'),alts:[source],items,boxes});
  }
  state.nextBox=Math.max(state.nextBox,2000);
  return state;
}
export const pcs = b => total(Object.values(b.items));
export const leftOf = (s, id) => s.items.find(i => i.id === id).picked - total(s.boxes.map(b => b.items[id] || 0));
export const left = s => total(s.items.map(i => leftOf(s,i.id)));
export const toPick = s => total(s.items.map(i => i.target-i.picked));
export const ready = s => s.boxes.filter(b => b.sealed && !b.trip);
export const openBoxes = s => s.boxes.filter(b => !b.sealed && !b.trip);
export function getStore(state,id) {
  const s = state.stores.find(s => s.id === id);
  if (!s) throw Error('Store not found.');
  return s;
}
export function getBox(s,id) {
  const b = s.boxes.find(b => b.id === id);
  if (!b) throw Error('This koli does not belong to this store.');
  return b;
}
export function assertState(state) {
  const ids = new Set();
  for (const s of state.stores) {
    for (const b of s.boxes) {
      if (ids.has(b.id)) throw Error('Duplicate koli ID.');
      ids.add(b.id);
      if (b.trip && (!b.sealed || !state.trips.some(t=>t.id===b.trip))) throw Error('Invalid dispatched koli.');
      for (const [id,q] of Object.entries(b.items)) {
        if (!s.items.some(i=>i.id===id) || !Number.isSafeInteger(q) || q<0) throw Error('Invalid koli contents.');
      }
    }
    for (const i of s.items) {
      if (!Number.isSafeInteger(i.picked) || i.picked<0 || i.picked>i.target || leftOf(s,i.id)<0) throw Error('Quantities do not balance.');
    }
  }
  return true;
}
export function createBox(state,storeId) {
  const s = getStore(state,storeId);
  const b = box('A'+String(state.nextBox++).padStart(5,'0'),Math.max(0,...s.boxes.map(b=>b.no))+1,{},false);
  s.boxes.push(b);
  return b;
}
export function move(state,storeId,source,target,quantities) {
  const s=getStore(state,storeId);
  if (source === target) throw Error('Choose a different destination.');
  const from = source==='picked' ? null : getBox(s,source);
  const to = target==='picked' || target==='new' ? null : getBox(s,target);
  if ([from,to].some(b=>b && (b.sealed || b.trip))) throw Error('Reopen this koli before changing its contents.');
  let count=0;
  for (const [id,q] of Object.entries(quantities)) {
    if (!s.items.some(i=>i.id===id) || !Number.isSafeInteger(q) || q<0) throw Error('Enter whole pieces, 0 or more.');
    const available=from ? (from.items[id]||0) : leftOf(s,id);
    if (q>available) throw Error('Quantity exceeds the available pieces.');
    count+=q;
  }
  if (!count) throw Error('Enter at least 1 piece.');
  const destination = target==='new' ? createBox(state,storeId) : to;
  for (const [id,q] of Object.entries(quantities)) {
    if (from) { from.items[id]=(from.items[id]||0)-q; if (!from.items[id]) delete from.items[id]; }
    if (destination && q) destination.items[id]=(destination.items[id]||0)+q;
  }
  assertState(state);
  return {count,box:destination};
}
export function seal(state,storeId,boxId) {
  const b=getBox(getStore(state,storeId),boxId);
  if (b.trip || b.sealed) throw Error('This koli is already sealed.');
  if (!pcs(b)) throw Error('Add pieces before sealing this koli.');
  b.sealed=true;
}
export function reopen(state,storeId,boxId) {
  const b=getBox(getStore(state,storeId),boxId);
  if (b.trip) throw Error('This koli has already departed.');
  b.sealed=false;
}
export function recordPick(state,storeId,quantities) {
  const s=getStore(state,storeId);
  if (!Object.values(quantities).some(q=>q>0)) throw Error('Enter at least 1 piece.');
  for (const [id,q] of Object.entries(quantities)) {
    const i=s.items.find(i=>i.id===id);
    if (!i || !Number.isSafeInteger(q) || q<0 || q>i.target-i.picked) throw Error('Quantity exceeds the remaining pick.');
  }
  for (const [id,q] of Object.entries(quantities)) s.items.find(i=>i.id===id).picked+=q;
  assertState(state);
}
export function dispatch(state,boxIds,note) {
  if (!boxIds.length) throw Error('Select at least one sealed koli.');
  const unique=[...new Set(boxIds)];
  const boxes=unique.map(id=>state.stores.flatMap(s=>s.boxes).find(b=>b.id===id));
  if (boxes.some(b=>!b || !b.sealed || b.trip)) throw Error('Only sealed koli still at the warehouse can depart.');
  if (!note.trim()) throw Error('Enter a vehicle or trip note.');
  const trip={id:'SJ-2026-'+String(state.nextTrip++).padStart(4,'0'),note:note.trim(),boxIds:unique};
  state.trips.push(trip);
  boxes.forEach(b=>b.trip=trip.id);
  assertState(state);
  return trip;
}
