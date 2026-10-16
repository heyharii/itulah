import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, balances, scan, setRoute, commit, remove } from './model.mjs';
const back = state => state.units.filter(unit => unit.place === 'warehouse');

test('scanning creates a draft, rejects duplicates and SKU barcodes, and leaves balances intact',()=>{
  const state=createState();const before=balances(state);const epc=back(state)[0].epc;
  assert.equal(scan(state,epc.toLowerCase()).ok,true);
  assert.equal(scan(state,epc).ok,false);
  assert.equal(scan(state,'24010001102').ok,false);
  assert.equal(scan(state,'R1:24010001102').ok,false);
  assert.equal(scan(state,'824010001102').ok,false);
  assert.equal(state.queue.length,1);assert.deepEqual(balances(state),before);
});
test('a tag in another location is rejected without changing the session direction',()=>{
  const state=createState();const epc=state.units.find(unit=>unit.place==='floor').epc;
  assert.equal(scan(state,epc).ok,false);assert.equal(state.from,'warehouse');assert.equal(state.to,'floor');assert.equal(state.queue.length,0);
});
test('draft route locks and unlocks after removing the last tag',()=>{
  const state=createState();const epc=back(state)[0].epc;scan(state,epc);
  assert.equal(setRoute(state,'floor','warehouse').ok,false);assert.equal(state.from,'warehouse');
  remove(state,epc);assert.equal(setRoute(state,'floor','warehouse').ok,true);
  assert.equal(setRoute(state,'floor','floor').ok,false);assert.equal(state.to,'warehouse');
});
test('offline confirmation preserves both draft and balances; reconnection moves only once',()=>{
  const state=createState();const before=balances(state);scan(state,back(state)[0].epc);state.online=false;
  assert.equal(commit(state).success,0);assert.deepEqual(balances(state),before);assert.equal(state.queue.length,1);assert.equal(state.history.length,0);
  state.online=true;assert.equal(commit(state).success,1);assert.equal(commit(state).success,0);assert.equal(state.history[0].rows.length,1);
});
test('partial success retains only failed tag; retry uses its original key and preserves total inventory',()=>{
  const state=createState();const units=back(state).slice(0,5);units.forEach(unit=>scan(state,unit.epc));
  const pendingKey=state.queue[0].key;state.failNext=true;
  const first=commit(state,'2026-10-11T03:00:00Z');assert.equal(first.success,4);assert.equal(first.failed,1);
  assert.equal(state.queue.length,1);assert.equal(state.queue[0].key,pendingKey);assert.equal(state.queue[0].status,'failed');
  assert.deepEqual(balances(state),{warehouse:21,floor:12,reject:2});
  assert.equal(commit(state,'2026-10-11T03:01:00Z').success,1);assert.deepEqual(balances(state),{warehouse:20,floor:13,reject:2});
  assert.equal(state.units.length,35);assert.equal(state.history.flatMap(event=>event.rows).length,5);
  assert.equal(new Set(state.history.flatMap(event=>event.rows.map(row=>row.epc))).size,5);
});
test('location is revalidated at confirmation when another operator changes a queued piece',()=>{
  const state=createState();const units=back(state).slice(0,2);units.forEach(unit=>scan(state,unit.epc));units[0].place='floor';
  const result=commit(state);assert.equal(result.success,1);assert.equal(result.failed,1);
  assert.match(state.queue[0].error,/Lokasi berubah/);assert.equal(state.history.flatMap(event=>event.rows).length,1);
  assert.equal(commit(state).success,0);assert.equal(state.queue.length,1);
});
test('restored draft retains keys and partial results through serialization',()=>{
  let state=createState();back(state).slice(0,2).forEach(unit=>scan(state,unit.epc));state.failNext=true;commit(state);
  const pendingKey=state.queue[0].key;state=JSON.parse(JSON.stringify(state));
  assert.equal(state.queue[0].key,pendingKey);assert.equal(state.history.length,1);assert.equal(commit(state).success,1);assert.equal(state.units.length,35);
});
test('reverse move and unknown EPC validation preserve the serialized unit ledger',()=>{
  const state=createState();setRoute(state,'floor','warehouse');const unit=state.units.find(unit=>unit.place==='floor');scan(state,unit.epc);
  assert.equal(commit(state).success,1);assert.deepEqual(balances(state),{warehouse:26,floor:7,reject:2});
  assert.equal(state.history[0].from,'floor');assert.equal(state.history[0].to,'warehouse');
  assert.equal(scan(state,'A124010001102FFFFFFFFFFF').ok,false);
});
