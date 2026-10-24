// The table flow has no saved open koli: Seal creates the record in one step.
import {seed as previousSeed,total,pcs,leftOf,left,getStore,assertState,recordPick,dispatch as previousDispatch} from './pack-workflow-model.mjs';
export {total,pcs,leftOf,left,getStore};

export function seed(storeCount=13) {
  const state=previousSeed(storeCount);
  state.tableVersion=1;
  state.events=0;
  for(const s of state.stores) {
    // Pieces in former open boxes are still picked and available to pack.
    s.boxes=s.boxes.filter(b=>b.sealed);
    s.boxes.forEach((b,i)=>b.sealedAt=new Date(Date.UTC(2026,9,21,1,15+i*8)).toISOString());
  }
  assertTableState(state);
  return state;
}
export function assertTableState(state) {
  assertState(state);
  for(const s of state.stores)for(const b of s.boxes) {
    if(!b.sealed||!pcs(b))throw Error('Only sealed, non-empty koli are records.');
  }
  return true;
}
const timestamp=state=>new Date(Date.UTC(2026,9,21,3,0+(state.events++))).toISOString();
export function picklists(state) {
  return state.stores.flatMap(s=>s.alts.map(source=>{
    const items=s.items.filter(i=>i.source===source);
    return {id:source,number:source.replace('ALT-','PL-'),store:s,items,quantity:total(items.map(i=>i.target)),picked:total(items.map(i=>i.picked))};
  })).sort((a,b)=>a.number.localeCompare(b.number));
}
export const packed=state=>state.stores.flatMap(store=>store.boxes.filter(b=>!b.trip).map(box=>({store,box}))).sort((a,b)=>b.box.sealedAt.localeCompare(a.box.sealedAt)||a.box.id.localeCompare(b.box.id));
export function recordPicklist(state,storeId,source,quantities) {
  const s=getStore(state,storeId);
  if(!s.alts.includes(source))throw Error('Picklist not found for this store.');
  for(const id of Object.keys(quantities))if(!s.items.some(i=>i.id===id&&i.source===source))throw Error('This SKU does not belong to this picklist.');
  recordPick(state,storeId,quantities);
  assertTableState(state);
}
export function sealKoli(state,storeId,quantities) {
  const s=getStore(state,storeId),items={};
  for(const [id,q] of Object.entries(quantities)) {
    if(!s.items.some(i=>i.id===id)||!Number.isSafeInteger(q)||q<0)throw Error('Enter whole pieces, 0 or more.');
    if(q>leftOf(s,id))throw Error('Quantity exceeds the picked pieces available.');
    if(q)items[id]=q;
  }
  if(!total(Object.values(items)))throw Error('Enter at least 1 piece to seal.');
  const b={id:'A'+String(state.nextBox).padStart(5,'0'),no:Math.max(0,...s.boxes.map(b=>b.no))+1,items,sealed:true,trip:null,sealedAt:timestamp(state)};
  s.boxes.push(b);state.nextBox++;
  assertTableState(state);
  return b;
}
export function dispatch(state,ids,note) {
  const trip=previousDispatch(state,ids,note);
  trip.departedAt=timestamp(state);
  assertTableState(state);
  return trip;
}
