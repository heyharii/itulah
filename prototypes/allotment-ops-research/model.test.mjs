import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,scenario,scenarios,apply,preview,totals,pending,blocked,tasks,status,assertState,reconnect,createAllotment} from './model.mjs';
const doAction=(s,c,id=s.orders[0].id)=>apply(s,id,c,s.orders.find(o=>o.id===id).revision);
test('all scenarios satisfy demand and physical bucket invariants',()=>{assertState(seed());for(const x of scenarios)assertState(scenario(x.id));});
test('partial dispatch: release rack demand, then pending physical correction, retain committed history',()=>{
 let s=scenario('mixed'),l=s.orders[0].lines[0],stock=s.stock[l.sku];
 assert.deepEqual(preview(l,60),{delta:-60,release:20,picked:20,packed:20});
 s=doAction(s,{type:'edit',line:'a',quantity:60,reason:'Changed plan'});l=s.orders[0].lines[0];
 assert.equal(l.target,60);assert.equal(l.stages.transit,40);assert.equal(pending(l),40);assert.equal(s.stock[l.sku],stock+20);
 assert.equal(blocked(s.orders[0],s.orders[0].lines[1]),true,'shared carton must be held');
 assert.equal(blocked(s.orders[0],s.orders[0].lines[2]),false,'unaffected store continues');
 assert.throws(()=>doAction(s,{type:'issue',line:'b',quantity:1}),/held/);
 assert.throws(()=>doAction(s,{type:'edit',line:'a',quantity:39,reason:'Changed plan'}),/Minimum 40/);
 const p=l.pending[0];s=doAction(s,{type:'resolvePending',line:'a',pendingId:p.id,quantity:10});
 assert.equal(s.stock[l.sku],stock+30);assert.equal(pending(s.orders[0].lines[0]),30);
});
test('full cancellation never releases picked/packed stock until each physical putback',()=>{
 let s=scenario('cancel'),before=s.stock['OX-NV-M'];s=doAction(s,{type:'cancel',reason:'Store plan changed'});
 const o=s.orders[0];assert.equal(totals(o).target,0);assert.equal(totals(o).pending,70);assert.equal(s.stock['OX-NV-M'],before+30);assert.equal(status(o),'Cancelled');
 for(const p of [...o.lines[0].pending])s=doAction(s,{type:'resolvePending',line:'x',pendingId:p.id,quantity:p.quantity});
 assert.equal(s.stock['OX-NV-M'],before+100);assert.equal(status(s.orders[0]),'Cancelled');assert.throws(()=>doAction(s,{type:'edit',line:'x',quantity:10,reason:'Try again'}),/ended/);
});
test('multi-line failed cancel rolls back all stock and quantities',()=>{
 let s=scenario('mixed');s.orders[0].lines[1].stages.packed=-1;const snapshot=structuredClone(s);assert.throws(()=>doAction(s,{type:'cancel',reason:'Change'}));assert.deepEqual(s,snapshot);
});
test('increase reserves only delta; insufficient stock fails without mutating state',()=>{
 let s=scenario('mixed'),before=s.stock['OX-NV-M'];s=doAction(s,{type:'edit',line:'a',quantity:140,reason:'Top-up'});assert.equal(s.stock['OX-NV-M'],before-20);
 const snapshot=structuredClone(s);assert.throws(()=>doAction(s,{type:'edit',line:'a',quantity:9999,reason:'Top-up'}),/free pieces/);assert.deepEqual(s,snapshot);
});
test('move wanted packed goods back retains demand and permits repacking',()=>{
 let s=scenario('mixed');s=doAction(s,{type:'moveBack',line:'c',from:'packed',to:'picked',quantity:10,reason:'Repack'});let l=s.orders[0].lines[2];assert.equal(l.target,80);assert.equal(l.stages.picked,30);assert.equal(l.stages.packed,10);s=doAction(s,{type:'pack',line:'c',quantity:10});assert.equal(s.orders[0].lines[2].stages.packed,20);
});
test('SJ and loading reverse only before departure; committed history cannot be directly edited down',()=>{
 let s=scenario('issued');assert.throws(()=>doAction(s,{type:'edit',line:'h',quantity:0,reason:'Cancel'}),/Minimum 60/);
 s=doAction(s,{type:'moveBack',line:'h',from:'loaded',quantity:20,reason:'Still in warehouse'});s=doAction(s,{type:'moveBack',line:'h',from:'staged',quantity:60,reason:'Void SJ'});
 assert.equal(s.orders[0].lines[0].stages.packed,60);s=doAction(s,{type:'cancel',reason:'Cancel'});assert.equal(totals(s.orders[0]).pending,60);
 let sent=scenario('departed');assert.throws(()=>doAction(sent,{type:'moveBack',line:'x',from:'transit',quantity:1,reason:'Undo'}),/Return/);
});
test('cancel after departure closes only unsent balance and Return does not instantly free stock',()=>{
 let s=scenario('departed'),stock=s.stock['OX-NV-M'];s=doAction(s,{type:'cancel',reason:'Stop'});assert.equal(totals(s.orders[0]).target,60);assert.equal(totals(s.orders[0]).pending,20);assert.equal(s.orders[0].cancelled,false);
 s=doAction(s,{type:'return',line:'x',quantity:60,reason:'Return from store'});assert.equal(totals(s.orders[0]).returnTransit,60);assert.equal(s.stock['OX-NV-M'],stock+20);
 s=doAction(s,{type:'returnReceive',line:'x',quantity:60});assert.equal(s.stock['OX-NV-M'],stock+20);s=doAction(s,{type:'releaseReturn',line:'x',quantity:60,reason:'Inspected'});assert.equal(s.stock['OX-NV-M'],stock+80);
});
test('95/100 received remains active until remaining demand is fulfilled or explicitly closed',()=>{
 let s=scenario('short');assert.equal(status(s.orders[0]),'Active');s=doAction(s,{type:'closeShort',line:'g',quantity:5,reason:'No longer needed'});assert.equal(status(s.orders[0]),'Closed short');assert.equal(totals(s.orders[0]).received,95);
});
test('replacement is linked; old lost demand never duplicates or reopens',()=>{
 let s=scenario('lost'),stock=s.stock['OX-NV-M'];s=doAction(s,{type:'replacement',line:'x',reason:'Need 100'});assert.equal(s.orders.length,2);assert.equal(s.orders[1].parent,s.orders[0].id);assert.equal(totals(s.orders[1]).target,5);assert.equal(totals(s.orders[0]).waiting,0);assert.equal(s.stock['OX-NV-M'],stock-5);
 assert.throws(()=>doAction(s,{type:'replacement',line:'x',reason:'Repeat'},s.orders[0].id),/awaiting an MD decision/);
});
test('wrong destination Return uses actual store rather than intended store',()=>{
 let s=scenario('wrong');s=doAction(s,{type:'return',line:'x',quantity:20,reason:'Wrong destination'});const l=s.orders[0].lines[0];assert.equal(l.returnSource,'PIK Avenue');assert.equal(l.store,'Kemang');assert.equal(l.issue.resolved,true);
});
test('offline request keeps stock and target unchanged until acknowledgement',()=>{
 let s=scenario('offline'),stock=s.stock['OX-NV-M'];s=doAction(s,{type:'edit',line:'a',quantity:60,reason:'Change'});assert.equal(s.orders[0].lines[0].target,120);assert.equal(s.stock['OX-NV-M'],stock);assert.equal(s.orders[0].queue.length,1);assert.equal(status(s.orders[0]),'Awaiting warehouse');s=reconnect(s);assert.equal(s.orders[0].lines[0].target,60);assert.equal(s.stock['OX-NV-M'],stock+20);
});
test('stale revision fails; offline acknowledgement conflict remains visible',()=>{
 let s=scenario('conflict');const old=s.orders[0].revision;s=doAction(s,{type:'pack',line:'a',quantity:5});assert.throws(()=>apply(s,s.orders[0].id,{type:'edit',line:'a',quantity:60,reason:'Change'},old),/progress changed/);
 let off=scenario('offline');off=doAction(off,{type:'edit',line:'a',quantity:60,reason:'Change'});off.orders[0].revision++;off=reconnect(off);assert.equal(off.orders[0].lines[0].target,120);assert.match(off.orders[0].lastError,/progress changed/);
});
test('holds block forward work and resume without altering quantities',()=>{
 let s=scenario('mixed');s=doAction(s,{type:'holdLine',line:'a',reason:'Check'});assert.throws(()=>doAction(s,{type:'pack',line:'a',quantity:1}),/held/);s=doAction(s,{type:'holdLine',line:'a',reason:'Ready'});s=doAction(s,{type:'pack',line:'a',quantity:1});assert.equal(s.orders[0].lines[0].target,120);
});
test('multi-store creation reserves aggregate stock atomically',()=>{
 const s=seed(),before=s.stock['JN-IN-32'];const next=createAllotment(s,'JN-IN-32',{Kemang:10,'PIK Avenue':20,Cikupa:30},'Launch');assert.equal(next.stock['JN-IN-32'],before-60);assert.equal(totals(next.orders[0]).target,60);assert.throws(()=>createAllotment(s,'JN-IN-32',{Kemang:50,'PIK Avenue':50},'Launch'),/free pieces/);assert.equal(s.stock['JN-IN-32'],before);
});
test('a new SKU/store adds to the same request; existing pairs must use edit',()=>{
 let s=scenario('mixed');s=doAction(s,{type:'addLine',sku:'TS-WH-L',store:'Cikupa',quantity:10,reason:'New store mix'});assert.equal(s.orders[0].lines.length,5);assert.equal(totals(s.orders[0]).target,310);assert.throws(()=>doAction(s,{type:'addLine',sku:'TS-WH-L',store:'Cikupa',quantity:10,reason:'Repeat'}),/already exists/);
});
test('required reason and fractional/negative quantities are rejected',()=>{
 const s=scenario('mixed');assert.throws(()=>doAction(s,{type:'edit',line:'a',quantity:60,reason:''}),/reason/);assert.throws(()=>doAction(s,{type:'pick',line:'a',quantity:0.5}),/whole quantity/);assert.throws(()=>doAction(s,{type:'pick',line:'a',quantity:-1}),/whole quantity/);
});

test('a later Return never reopens a completed request; return work remains visible',()=>{let s=scenario('finished');s=doAction(s,{type:'return',line:'i',quantity:10,reason:'Store return'});assert.equal(status(s.orders[0]),'Completed');assert.equal(tasks(s).some(t=>t.type==='returnTransit'),true);});

test('finished receipt count moves missing pieces into investigation, not free stock or a duplicate picklist',()=>{let s=scenario('departed');const stock=s.stock['OX-NV-M'];s=doAction(s,{type:'receive',line:'x',quantity:55,closeCount:true});assert.equal(totals(s.orders[0]).gap,5);assert.equal(s.orders[0].lines[0].issue.owner,'Inventory');assert.equal(s.stock['OX-NV-M'],stock);s=doAction(s,{type:'investigate',line:'x',result:'lost'});assert.equal(totals(s.orders[0]).gap,0);assert.equal(totals(s.orders[0]).lost,5);assert.equal(s.orders[0].lines[0].issue.owner,'MD');});

test('found receipt discrepancy settles receipt while found short pick retains the existing pick demand',()=>{let s=scenario('receipt');s=doAction(s,{type:'investigate',line:'x',result:'found'});assert.equal(totals(s.orders[0]).received,100);assert.equal(totals(s.orders[0]).gap,0);assert.equal(status(s.orders[0]),'Completed');let short=scenario('short');short=doAction(short,{type:'pick',line:'g',quantity:5});assert.equal(short.orders[0].lines[0].issue.resolved,true);assert.equal(tasks(short,'md').length,0);});
