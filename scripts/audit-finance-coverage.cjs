// Read-only audit: transpile the prototype engine into an isolated temporary directory.
// No production service, browser, database, or workspace engine state is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'frontend-hub/node_modules/typescript/lib/typescript.js'));
const engine = path.join(root, 'frontend-hub/src/screens/finance-lab/engine');
const output = path.join(root, 'outputs/finance-proof-20260910');
fs.mkdirSync(output, {recursive:true});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-proof-'));
const sourceHashes = {};
for (const name of fs.readdirSync(engine).filter(x => x.endsWith('.ts'))) {
  const source = fs.readFileSync(path.join(engine,name),'utf8');
  sourceHashes[name] = crypto.createHash('sha256').update(source).digest('hex');
  const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  fs.writeFileSync(path.join(tmp,name.replace(/\.ts$/,'.js')),js);
}
const {CHART} = require(path.join(tmp,'chart.js'));
const {BINDINGS,BANK_ACCOUNTS} = require(path.join(tmp,'bindings.js'));
const rules = require(path.join(tmp,'rules.js'));
const {World,runAll} = require(path.join(tmp,'scenarios.js'));
const {book: seedBook} = require(path.join(tmp,'book.js'));
const {resolve} = require(path.join(tmp,'resolver.js'));
const scenarios=runAll();
const checks=[];
function check(id,description,expected,actual,pass,evidence) { checks.push({id,description,expected,actual,pass,evidence}); }
const ctx=(id,unit='C006')=>({unit_id:unit,occurred_on:'2026-08-10',document_on:'2026-08-10',posting_on:'2026-08-10',document_ref:id,source_id:id,step:'proof'});
const concise=o=>o.ok?{ok:true,codes:o.entry?.lines.map(l=>l.account_code),units:[...new Set(o.entry?.lines.map(l=>l.unit_id))],idempotent:o.idempotent}:{ok:false,code:o.code,message:o.message,detail:o.detail};
function fire(rule,payload,id,unit='C006'){return new World().fire(rule,payload,ctx(id,unit));}
const bindingChecks=BINDINGS.map(b=>{
 const a=CHART.find(a=>a.code===b.account_code);
 const outcome=resolve(BINDINGS,{role:b.role,dims:b.narrows,on:'2026-08-10'});
 return {binding_id:b.binding_id,role:b.role,account_code:b.account_code,unit:b.narrows.unit_id,exists:!!a,active:a?.postable,leaf:a?.code.length===12,unit_match:!a?.unit_id||a.unit_id===b.narrows.unit_id,resolves:outcome.ok,reason:outcome.ok?'':outcome.reason};
});
const mutations=[];
function observed(id,rule,payload,unit='C006') {const o=fire(rule,payload,id,unit);mutations.push({id,package_id:rule.pkg.package_id,unit,outcome:concise(o)});return o;}
for(const u of ['C006','C004','C013']){
 const o=observed('dispatch-'+u,rules.DISPATCH,{unit_id:u,from_unit_id:'HO',amount:100000},u);
 check('dispatch-'+u,'Activated dispatch must resolve for selected unit','posting succeeds',concise(o),o.ok,'rules.ts:366; bindings.ts:313');
}
let o=observed('receive-C006',rules.RECEIPT,{unit_id:'C006',from_unit_id:'HO',amount:100000});
check('receipt-disabled','Unconfirmed receipt rule must stay disabled','RULE_NOT_ACTIVE',concise(o),!o.ok&&o.code==='RULE_NOT_ACTIVE','rules.ts:398');
for(const bank of BANK_ACCOUNTS.filter(b=>b.unit_id==='C006')){
 const o=resolve(BINDINGS,{role:'BANK',dims:{unit_id:bank.unit_id,bank_account_id:bank.bank_account_id},on:'2026-08-10'});
 check('bank-'+bank.bank_account_id,'Registered bank account has a resolvable posting binding','one permitted account',o.ok?o.account.code:o.reason,o.ok,'bindings.ts:95; bindings.ts:313');
}
const validManual=(code,unit)=>{
 const w=new World();
 return w.ledger.post({book_id:'CFS',occurred_on:'2026-08-10',document_on:'2026-08-10',posting_on:'2026-08-10',source_kind:'MANUAL',source_id:'manual-'+code,document_ref:'PROOF',rule_version:'manual@proof',idempotency_key:'proof-'+code,actor:'proof',actor_role:'FINANCE_MANAGER',lines:[{side:'DEBIT',role:'CASH_ON_HAND',dims:{unit_id:unit},amount:10000,account_code:code},{side:'CREDIT',role:'CASH_ON_HAND',dims:{unit_id:unit},amount:10000,account_code:'101100100106'}]});
};
const inactive=CHART.find(a=>a.unit_id==='C006'&&!a.postable);
for(const [id,code,why] of [['inactive',inactive.code,'Inactive account'],['heading','1','Heading account'],['unit-mismatch','101100100104','C004 account in C006 journal'],['blocked','201200100106','Shop merchandise payable blocked by policy']]){
 const out=validManual(code,'C006');check('manual-'+id,why+' must be rejected','refused',concise(out),!out.ok,'ledger.ts:225; chart.ts:56');
}
const book=seedBook();
const baseline=book.ledger.allEntries();
const baselineTB=book.ledger.trialBalance({book_id:'CFS'});
// Exercise every declared rule using explicit synthetic inputs, not package readiness labels.
const base={unit_id:'C006',amount:100000,bank_account_id:'BCA-TAB-C006'};
const sale={unit_id:'C006',net_revenue:100000,discount:0,cost_of_goods:60000,tenders:[{method:'CASH',amount:60000},{method:'CARD',amount:40000,acquirer:'BCA_DEBIT'}],card_bank:{BCA_DEBIT:'BCA-TAB-C006'}};
const samples={
 SALE:sale,CARD_CLEARING:sale,DISPATCH:{...base,from_unit_id:'HO'},RECEIPT:{...base,from_unit_id:'HO'},
 DEPOSIT:{...base,to_unit_id:'HO',from:'CASH_ON_HAND'},PAYROLL_ACCRUAL:{unit_id:'C006',salary:100000,benefits:10000,outside_help:0},
 FUNDING:{...base,from_unit_id:'HO',funding_type:'AFFILIATE_FINANCING',into:'BANK'},
 ASSET_ACQUISITION:{...base,asset_class:'FFE_OFFICE',source:{kind:'BANK',bank_account_id:base.bank_account_id}},
 DEPRECIATION:{unit_id:'C006',charges:[{asset_class:'FFE_OFFICE',amount:1000}]},
 OE_REPLACEMENT:{...base,asset_class:'OE_RAK_1',source:{kind:'BANK',bank_account_id:base.bank_account_id}},
 OE_RESERVE:{unit_id:'C006',charges:[{asset_class:'OE_RAK_1',amount:1000}]},
 CARD_RECLASS:{...base,acquirer:'BCA_DEBIT'},CARD_SETTLEMENT:{...base,acquirer:'BCA_DEBIT',gross:100000,fee:2000},
 PREPAID_RELEASE:base,BILL:{...base,kind:'EXPENSE'},BILL_PAYMENT:{...base,kind:'EXPENSE'},
 TAX_PAYMENT:{...base,tax_kind:'PPH_21'},ADVANCE_ISSUE:base,ADVANCE_LIQUIDATION:base,
 CAPITALISATION:{...base,asset_class:'FFE_OFFICE'},STOCK_ADJUSTMENT:{unit_id:'C006',cost:100000,residual:10000},
 LOAN_REPAYMENT:{...base,principal:100000,interest:10000},EQUITY_MOVEMENT:base,PAYROLL_PAYMENT:{...base,leg:'SALARY'},
 GIRO_ISSUE:{...base,kind:'EXPENSE'},GIRO_CLEAR:base,
 TRANSFER:{...base,from:{kind:'CASH_ON_HAND'},to:{kind:'BANK',bank_account_id:base.bank_account_id}},
 PREPAID_PAID:base,PREOPENING_AMORTISATION:base
};
const ruleSampleEntries=[];
for(const [constant,payload] of Object.entries(samples)){
 const out=observed('sample-'+constant,rules[constant],payload);
 check('sample-'+constant,'Representative sample respects rule activation',rules[constant].pkg.activation.enabled?'posting succeeds':'RULE_NOT_ACTIVE',concise(out),rules[constant].pkg.activation.enabled?out.ok:!out.ok&&out.code==='RULE_NOT_ACTIVE','rules.ts:'+constant);
 if(out.ok)ruleSampleEntries.push({constant,entry:out.entry});
}
const fresh=()=>new book.constructor();
// One bill paid from two UI entry points must still have one traceable payment.
{
 const b=fresh();let n=b.payments.all().length;
 let made=b.recogniseBill({number:'PROOF-SVC',supplier:'Proof',unit_id:'C006',kind:'EXPENSE',issued_on:'2026-08-10',due_on:'2026-08-15',total:100000});
 const bill=b.bills.find(x=>x.number==='PROOF-SVC');
 const paid=bill&&b.payBill(bill.bill_id,'BCA-TAB-C006','2026-08-11');
 check('bill-payment-register','Bill payment is recorded in the shared payment register','one additional Payment',{billCreated:made.ok,payment:paid&&concise(paid),addedPayments:b.payments.all().length-n},!!paid?.ok&&b.payments.all().length===n+1,'book.ts:1390; payments.ts:296');
 const again=bill&&b.payBill(bill.bill_id,'BCA-TAB-C006','2026-08-11');
 check('bill-double-pay','Same paid bill cannot be paid twice','ALREADY_PAID',again&&concise(again),!!again&&!again.ok&&again.code==='ALREADY_PAID','book.ts:1390');
}
{
 const b=fresh();b.recogniseBill({number:'PROOF-GIRO',supplier:'Proof',unit_id:'HO',kind:'MERCHANDISE',issued_on:'2026-08-10',due_on:'2026-08-15',total:100000});
 const id=b.bills.find(x=>x.number==='PROOF-GIRO').bill_id;
 const out=b.issueGiro({bill_id:id,number:'PROOF-MANDIRI',bank_account_id:'MANDIRI-GIRO-HO',value_on:'2026-08-20',issued_on:'2026-08-11'});
 const credit=out.ok?out.entry.lines.find(l=>l.credit>0)?.account_code:'';
 check('giro-bank-dimension','Mandiri giro uses the Mandiri outstanding-giro account','201200200200',{outcome:concise(out),credited:credit,accountName:CHART.find(a=>a.code===credit)?.name},out.ok&&credit==='201200200200','rules.ts:1106; bindings.ts:unitBindings');
 const before=b.ledger.allEntries().length;const g=b.giros.find(g=>g.number==='PROOF-MANDIRI');const clear=b.clearGiro(g.giro_id,'2026-08-20');
 check('giro-clear','Clearing issued giro creates one new journal and marks CLEARED','one entry / CLEARED',{outcome:concise(clear),entriesAdded:b.ledger.allEntries().length-before,status:b.giros.find(x=>x.giro_id===g.giro_id).status},clear.ok&&b.ledger.allEntries().length===before+1,'book.ts:1901');
}
{
 const b=fresh();const loan=b.staffLoans.find(x=>x.instalment&&x.principal>x.repaid);const before=b.ledger.allEntries().length;const repaid=loan.repaid;const out=b.deductStaffLoan(loan.loan_id);
 check('staff-loan-ledger','Staff loan deduction updates ledger or linked payroll posting','linked journal accompanies reduced receivable',{outcome:out,entriesAdded:b.ledger.allEntries().length-before,repaidChange:b.staffLoans.find(x=>x.loan_id===loan.loan_id).repaid-repaid},b.ledger.allEntries().length>before,'book.ts:2046');
}
{
 const b=fresh();const m=b.interunitMoves.find(x=>x.family==='FINANCING'&&x.amount>x.settled);
 if(m){const out=b.settleInterunit(m.move_id,'2026-08-10');const codes=out.ok?out.entry.lines.map(l=>l.account_code):[];check('interunit-family','Financing settlement clears financing payable','2012301 family',{family:m.family,outcome:concise(out)},out.ok&&codes.some(x=>x.startsWith('2012301'))&&!codes.some(x=>x.startsWith('2012302')),'book.ts:2023');}
}
{
 const b=fresh();const before=b.ledger.allEntries().length;const priorEquity=JSON.stringify(b.equityMoves);b.setPeriod('2026-07',true);
 check('close-generates-result','Claim that period close produces system equity has an implementation','period result calculated or posted',{journalChange:b.ledger.allEntries().length-before,equityChanged:JSON.stringify(b.equityMoves)!==priorEquity},b.ledger.allEntries().length>before||JSON.stringify(b.equityMoves)!==priorEquity,'book.ts:903; ledger.ts:114; subledgers.ts:352');
}
const registerAccounts=[];
for(const file of ['data','subledgers']){
 const exports=require(path.join(tmp,file+'.js'));
 const walk=(v,trail)=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(['account','account_code'].includes(k)&&typeof x==='string'&&/^\d{6,12}$/.test(x))registerAccounts.push({source:file+'.ts',record:trail,code:x,exists:CHART.some(a=>a.code===x)});if(x&&typeof x==='object')walk(x,trail+'.'+k);}};
 walk(exports,file);
}
check('register-account-validity','Account references in domain fixtures exist in supplied COA','all exist',registerAccounts.filter(x=>!x.exists),registerAccounts.every(x=>x.exists),'data.ts; subledgers.ts');
// Static call graph: exact AST identifiers, not comments claiming support.
const bookSource=ts.createSourceFile('book.ts',fs.readFileSync(path.join(engine,'book.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const methods={};
function descendants(node,fn){fn(node);ts.forEachChild(node,c=>descendants(c,fn));}
descendants(bookSource,node=>{if(ts.isMethodDeclaration(node)&&node.name){const name=node.name.getText(bookSource);const item={line:bookSource.getLineAndCharacterOfPosition(node.getStart()).line+1,rules:[],calls:[]};descendants(node,c=>{if(ts.isCallExpression(c)&&ts.isPropertyAccessExpression(c.expression)){const method=c.expression.name.text;if(c.expression.expression.kind===ts.SyntaxKind.ThisKeyword){if(method==='fire'&&c.arguments[1]&&ts.isIdentifier(c.arguments[1]))item.rules.push(c.arguments[1].text);else item.calls.push(method);}}});methods[name]=item;}});
const screenDir=path.dirname(engine);const screenFunctions=[];
for(const file of fs.readdirSync(screenDir).filter(x=>x.endsWith('.tsx'))){const src=ts.createSourceFile(file,fs.readFileSync(path.join(screenDir,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);descendants(src,node=>{if(ts.isFunctionDeclaration(node)&&node.name){const calls=new Set(),refs=new Set();descendants(node,c=>{if(ts.isCallExpression(c)&&ts.isPropertyAccessExpression(c.expression)&&['b','book'].includes(c.expression.expression.getText(src)))calls.add(c.expression.name.text);if(ts.isCallExpression(c)&&ts.isIdentifier(c.expression))refs.add(c.expression.text);if((ts.isJsxSelfClosingElement(c)||ts.isJsxOpeningElement(c))&&ts.isIdentifier(c.tagName))refs.add(c.tagName.text);});screenFunctions.push({file,function:node.name.text,line:src.getLineAndCharacterOfPosition(node.getStart()).line+1,calls:[...calls],localRefs:[...refs]});}});}
const index=fs.readFileSync(path.join(screenDir,'index.ts'),'utf8');const routes=[...index.matchAll(/"(\/finance-lab[^"\n]*)":\s*(\w+)/g)].map(m=>({route:m[1],component:m[2]}));
const fullMethods=(name,seen=new Set())=>{if(seen.has(name))return[];seen.add(name);return [...(methods[name]?.rules||[]),...(methods[name]?.calls||[]).flatMap(n=>fullMethods(n,seen))];};
const expandScreen=(s,seen=new Set())=>{const key=s.file+':'+s.function;if(seen.has(key))return[];seen.add(key);return [...s.calls,...s.localRefs.flatMap(ref=>screenFunctions.filter(x=>x.file===s.file&&x.function===ref).flatMap(x=>expandScreen(x,seen)))];};
for(const s of screenFunctions){s.effectiveCalls=[...new Set(expandScreen(s))];s.rules=[...new Set(s.effectiveCalls.flatMap(n=>fullMethods(n)))];s.routes=routes.filter(r=>r.component===s.function).map(r=>r.route);}
const packages=rules.PACKAGES.map(p=>({...p,constant:Object.entries(rules).find(([k,v])=>v&&v.pkg===p)?.[0]}));
const runtime={generated_at:new Date().toISOString(),scope:'isolated frontend-hub Finance Lab prototype; no backend verification',sourceHashes,chart:CHART,bindings:BINDINGS,banks:BANK_ACCOUNTS,packages,bindingChecks,scenarios,checks,ruleProbes:mutations,ruleSampleEntries,registerAccounts,methods,screenFunctions,routes,seedEntries:baseline,seedTrialBalance:baselineTB};
fs.writeFileSync(path.join(output,'runtime-evidence.json'),JSON.stringify(runtime,null,2));
console.log(JSON.stringify({output,accounts:CHART.length,bindings:BINDINGS.length,boundAccounts:new Set(BINDINGS.map(b=>b.account_code)).size,packages:packages.length,disabled:packages.filter(p=>!p.activation.enabled).map(p=>p.package_id),scenarios:scenarios.map(s=>({id:s.id,pass:s.passed,checks:s.checks.length,failed:s.checks.filter(c=>!c.pass)})),checksTotal:checks.length,checksPassed:checks.filter(c=>c.pass).length,failures:checks.filter(c=>!c.pass),badBindings:bindingChecks.filter(b=>!b.exists||!b.active||!b.unit_match||!b.resolves),seedEntries:baseline.length,seedTrialBalance:{...baselineTB,rows:undefined}},null,2));
