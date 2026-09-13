const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/procurement-enhancements.js', 'utf8');
function environment(initial = '[]') {
  const handlers = {};
  const storage = {value: initial, fail: false};
  const context = vm.createContext({
    ORDERS:[{id:'existing', supplier:'Berkah Tekstil'}], ORDER_LINES:[['Oxford','SKU-1',10,0]], PEOPLE:['Wulan'],
    localStorage:{getItem:()=>storage.value,setItem:(_,value)=>{if(storage.fail)throw new Error('Storage full');storage.value=value;}},
    document:{addEventListener:(name,fn)=>handlers[name]=fn,querySelector:()=>null},
    state:{quick:{orders:{}},facet:{orders:{}},picked:{orders:new Set(['existing'])}},
    render:()=>{},toast:()=>{},escapeMarkup:String,icon:()=>'',money:String,count:String,
  });
  vm.runInContext(source,context);
  return {context, storage, submit:()=>handlers.submit({target:{id:'po-form'},preventDefault(){}}),run:code=>vm.runInContext(code,context)};
}
const app=environment();
app.run('poDraft=freshPODraft()');app.submit();
assert.equal(app.context.ORDERS.length,1,'Invalid form must not create a record');
assert.ok(app.run('poErrors.supplier && poErrors.expected && poErrors["article-0"] && poErrors["price-0"]'));
const fill=`poDraft={supplier:'Berkah Tekstil',destination:'DC Cikarang',expected:'2026-10-01',assignee:'Wulan',notes:'Deliver together',lines:[{article:'0',qty:10,price:125000},{article:'0',qty:2,price:50000}]}`;
app.run(fill);app.submit();
assert.equal(app.context.ORDERS.length,2);
const saved=JSON.parse(app.storage.value)[0];
assert.equal(saved.value,1350000);assert.equal(saved.ordered,12);assert.equal(saved.items.length,2);assert.equal(saved.status,'draft');assert.equal(saved.received,0);
assert.equal(app.run('poDraft'),null);
assert.equal(app.context.state.sheet.id,saved.id);
assert.equal(app.context.state.picked.orders.size,0);
const reloaded=environment(app.storage.value);
assert.equal(reloaded.context.ORDERS.length,2,'Saved draft must reload');
const failure=environment();failure.run(fill);failure.storage.fail=true;failure.submit();
assert.equal(failure.context.ORDERS.length,1,'Failed persistence must not add a record');
assert.ok(failure.run('poDraft && poErrors.form'),'Keep entered values on storage failure');
for(const value of [-1,0,1.5,'invalid']){const invalid=environment();invalid.run(fill+`;poDraft.lines[0].qty=${JSON.stringify(value)}`);invalid.submit();assert.equal(invalid.context.ORDERS.length,1);}
console.log('PASS: required fields, multi-line totals, draft persistence/reload, storage failure, invalid quantities');
