import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,assertTableState,left,leftOf,pcs,getStore,picklists,packed,sealKoli,recordPicklist,dispatch} from '../../pack-table-model.mjs';

test('only sealed koli exist; former draft pieces remain available in Picked',()=>{
  const state=seed(30),s=getStore(state,'c001');
  assert.equal(state.stores.length,30);
  assert.equal(s.boxes.length,2);
  assert.equal(left(s),18);
  assert.equal(s.boxes.every(b=>b.sealed),true);
  assertTableState(state);
});
test('picklists are individual records ordered across all stores',()=>{
  const state=seed(30),rows=picklists(state);
  assert.equal(rows.length,31);
  assert.deepEqual(rows.map(p=>p.number),rows.map(p=>p.number).sort());
  assert.equal(rows.filter(p=>p.store.id==='c001').length,2);
});
test('Seal creates exactly one nonempty koli and deducts only its quantities',()=>{
  const state=seed(),s=getStore(state,'c001'),before=left(s),count=packed(state).length,next=state.nextBox;
  const b=sealKoli(state,s.id,{'ox-m':3,'bs-m':0});
  assert.equal(b.sealed,true);
  assert.equal(pcs(b),3);
  assert.equal(left(s),before-3);
  assert.equal(packed(state).length,count+1);
  assert.equal(state.nextBox,next+1);
  assert.ok(b.sealedAt);
  assertTableState(state);
});
test('invalid seal quantities create no record, consume no number, and move no pieces',()=>{
  for(const q of [{'ox-m':0},{'ox-m':99},{'ox-m':-1},{'ox-m':1.5},{'ox-m':NaN},{unknown:1},{'ox-m':1,'bs-l':999}]){
    const state=seed(),before=structuredClone(state);
    assert.throws(()=>sealKoli(state,'c001',q));
    assert.deepEqual(state,before);
  }
});
test('partial pick is scoped to one picklist and updates available picked',()=>{
  const state=seed(),s=getStore(state,'c001'),before=left(s);
  assert.throws(()=>recordPicklist(state,s.id,'ALT-00000036',{'bs-l':1}),/does not belong/);
  recordPicklist(state,s.id,'ALT-00000036',{'ox-m':1});
  assert.equal(left(s),before+1);
  assert.equal(picklists(state).find(p=>p.id==='ALT-00000036').picked,21);
});
test('one trip can select sealed koli from three stores, leaving unselected koli packed',()=>{
  const state=seed(),before=packed(state).length,waiting=left(getStore(state,'c001'));
  const trip=dispatch(state,['A00101','A00104','A00106'],'B 9124 SCA · Andi');
  assert.equal(trip.boxIds.length,3);
  assert.equal(state.trips.length,1);
  assert.equal(packed(state).length,before-3);
  assert.equal(left(getStore(state,'c001')),waiting);
  assert.ok(trip.departedAt);
  assert.throws(()=>dispatch(state,['A00101'],'Second trip'),/Only sealed/);
  assertTableState(state);
});
test('sealing successive koli preserves each SKU balance at 30-store scale',()=>{
  const state=seed(30),s=getStore(state,'c029');
  sealKoli(state,s.id,{'tee-m':4,'tee-l':2});
  sealKoli(state,s.id,{'tee-m':6,'tee-l':6});
  assert.equal(left(s),0);
  for(const i of s.items)assert.equal(leftOf(s,i.id)+s.boxes.reduce((q,b)=>q+(b.items[i.id]||0),0),i.picked);
  assert.equal(s.boxes.length,2);
});
