import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,extendDemoRoster,pcs,left,leftOf,toPick,ready,getStore,getBox,assertState,createBox,move,seal,reopen,recordPick,dispatch} from '../../pack-workflow-model.mjs';

test('13-store and 30-store rosters have valid quantities and unique koli',()=>{
  for(const count of [13,30]){
    const state=seed(count);
    assert.equal(state.stores.length,count);
    assert.equal(new Set(state.stores.map(s=>s.id)).size,count);
    assertState(state);
    const b=createBox(state,count===30?'c030':'c013');
    assert.equal(state.stores.flatMap(s=>s.boxes).filter(other=>other.id===b.id).length,1);
  }
});
test('upgrading the four-store demo preserves its picks, koli and trips',()=>{
  const state=seed();state.stores=state.stores.filter(s=>['c001','c002','c005','c009'].includes(s.id));
  move(state,'c001','picked','A00103',{'ox-m':2});
  dispatch(state,['A00104'],'Existing demo trip');
  const before=structuredClone(state.stores),trips=structuredClone(state.trips);
  extendDemoRoster(state,30);extendDemoRoster(state,30);
  assert.equal(state.stores.length,30);
  before.forEach(s=>assert.deepEqual(getStore(state,s.id),s));
  assert.deepEqual(state.trips,trips);
  assertState(state);
});

test('a partial transfer and correction preserve the picked total for every SKU',()=>{
  const state=seed(),s=getStore(state,'c001');
  assert.equal(left(s),13);
  move(state,s.id,'picked','A00103',{'ox-m':3,'bs-l':2});
  assert.equal(leftOf(s,'ox-m'),1);
  assert.equal(leftOf(s,'bs-l'),2);
  assert.equal(pcs(getBox(s,'A00103')),10);
  move(state,s.id,'A00103','picked',{'ox-m':2});
  assert.equal(leftOf(s,'ox-m'),3);
  for(const i of s.items)assert.equal(leftOf(s,i.id)+s.boxes.reduce((n,b)=>n+(b.items[i.id]||0),0),i.picked);
});
test('first transfer starts a koli for the selected store only',()=>{
  const state=seed(),s=getStore(state,'c009');
  const moved=move(state,s.id,'picked','new',{'kd-s':3});
  assert.equal(moved.box.no,1);
  assert.equal(left(s),15);
  assert.equal(getStore(state,'c001').boxes.length,3);
  assert.throws(()=>move(state,s.id,'picked','A00103',{'kd-s':1}),/does not belong/);
});
test('invalid and oversized quantities leave all lines and boxes unchanged',()=>{
  for(const quantities of [{'ox-m':1,'bs-l':99},{'ox-m':-1},{'ox-m':0.5},{'ox-m':NaN},{'ox-m':0},{unknown:2}]){
    const state=seed(),before=structuredClone(state);
    assert.throws(()=>move(state,'c001','picked','new',quantities));
    assert.deepEqual(state,before);
  }
});
test('sealed contents require reopen and empty koli cannot be sealed',()=>{
  const state=seed();
  assert.throws(()=>move(state,'c001','A00101','picked',{'ox-m':1}),/Reopen/);
  reopen(state,'c001','A00101');
  move(state,'c001','A00101','picked',{'ox-m':1});
  seal(state,'c001','A00101');
  const empty=createBox(state,'c001');
  assert.throws(()=>seal(state,'c001',empty.id),/Add pieces/);
  assertState(state);
});
test('partial picking can continue to pack while outstanding pick remains',()=>{
  const state=seed(),s=getStore(state,'c009');
  recordPick(state,s.id,{'kd-s':1,'kd-m':0,'kd-l':1});
  assert.equal(toPick(s),4);
  move(state,s.id,'picked','new',{'kd-s':9,'kd-m':6,'kd-l':5});
  assert.equal(left(s),0);
  assert.equal(toPick(s),4);
});
test('partial dispatch leaves picked and open koli available, and locks departed koli',()=>{
  const state=seed(),s=getStore(state,'c001'),before=left(s);
  const t=dispatch(state,['A00101'],'B 9124 SCA · Andi');
  assert.equal(t.boxIds.length,1);
  assert.equal(left(s),before);
  assert.equal(getBox(s,'A00103').sealed,false);
  assert.equal(ready(s).length,1);
  assert.throws(()=>reopen(state,s.id,'A00101'),/departed/);
  assert.throws(()=>dispatch(state,['A00103'],'Truck'),/Only sealed/);
  assert.throws(()=>dispatch(state,['A00101'],'Truck'),/Only sealed/);
});
test('one trip groups sealed koli from multiple stores and deduplicates selections',()=>{
  const state=seed();
  const t=dispatch(state,['A00101','A00104','A00106','A00101'],'Cikupa / Jambi / Muaro Bungo');
  assert.deepEqual(t.boxIds,['A00101','A00104','A00106']);
  assert.equal(state.stores.filter(s=>s.boxes.some(b=>b.trip===t.id)).length,3);
  assert.equal(state.trips.length,1);
  assert.equal(getBox(getStore(state,'c005'),'A00104').trip,t.id);
  assertState(state);
});
test('repeated transfers conserve each SKU and never mix stores',()=>{
  const state=seed(),s=getStore(state,'c001');
  const first=createBox(state,s.id),second=createBox(state,s.id);
  for(let n=0;n<100;n++){
    for(const i of s.items){
      const available=leftOf(s,i.id);
      if(available)move(state,s.id,'picked',first.id,{[i.id]:available});
      const qty=first.items[i.id]||0;
      if(qty)move(state,s.id,first.id,second.id,{[i.id]:qty});
      if(qty)move(state,s.id,second.id,'picked',{[i.id]:qty});
    }
    assertState(state);
    assert.equal(left(s),13);
  }
});
