import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';

const work='/Users/hari/itulah/.coa_20260918';
const out='/Users/hari/itulah/outputs/coa_20260918';
const data=JSON.parse(await fs.readFile(`${work}/data.json`,'utf8'));
const {accounts,coa,rules,stats}=data;
const wb=Workbook.create();
console.log('Starting workbook');
const tabs=['Proposal','Accounts','Tables','Dimension Values','Rules','Legacy Map','Examples','Family Links'];
const ss=Object.fromEntries(tabs.map(n=>[n,wb.worksheets.add(n)]));
const font='Helvetica Neue';
const color={ink:'#233044',navy:'#263C55',light:'#EEF2F6',blue:'#2463A3',green:'#316B55',amber:'#FFF1D0',muted:'#617184'};
const endMap=accounts.length+4, endRule=rules.length+4;
const col=(i)=>{let s='';for(let k=i+1;k;k=Math.floor((k-1)/26))s=String.fromCharCode(65+(k-1)%26)+s;return s;};

function base(name,title,subtitle,widths,last){
  const s=ss[name];s.showGridLines=false;
  const all=s.getRange(`A1:${col(widths.length-1)}${last}`);
  all.format.font={name:font,size:11,color:color.ink};all.format.rowHeight=32;
  all.format.verticalAlignment='top';all.format.wrapText=true;
  widths.forEach((w,i)=>s.getRange(`${col(i)}1:${col(i)}${last}`).format.columnWidth=w);
  s.getRange('A1').values=[[title]];s.getRange('A1').format.font={name:font,size:18,bold:true,color:color.ink};
  s.getRange(`A1:${col(widths.length-1)}1`).format.rowHeight=30;
  s.getRange('A2').values=[[subtitle]];s.getRange('A2').format.font={name:font,size:10,italic:true,color:color.muted};
  // The title/context cells stay unmerged and flow over the blank row.
  s.getRange(`A1:${col(widths.length-1)}2`).format.wrapText=false;
  s.getRange(`A3:${col(widths.length-1)}3`).format.rowHeight=10;
  s.getRange(`A3:${col(widths.length-1)}3`).format.borders={bottom:{style:'thin',color:'#BBC7D3'}};
  return s;
}
function table(s,row,headers,values,name,height=40){
  const last=row+values.length, lastCol=col(headers.length-1);
  s.getRange(`A${row}:${lastCol}${last}`).values=[headers,...values];
  s.tables.add(`A${row}:${lastCol}${last}`,true,name);
  s.getRange(`A${row}:${lastCol}${row}`).format={fill:color.navy,font:{name:font,color:'#FFFFFF',bold:true},wrapText:true,rowHeight:34,verticalAlignment:'center'};
  if(values.length)s.getRange(`A${row+1}:${lastCol}${last}`).format.rowHeight=height;
  return last;
}
function section(s,row,text,width){
  s.getRange(`A${row}:${col(width-1)}${row}`).format.fill=color.light;
  s.getRange(`A${row}`).values=[[text]];s.getRange(`A${row}`).format.font={name:font,size:12,bold:true};
  s.getRange(`A${row}:${col(width-1)}${row}`).format.rowHeight=26;
  s.getRange(`A${row}:${col(width-1)}${row}`).format.wrapText=false;
}

const values=[];const valid=new Map();
function master(dim,label,source,note){
  const key=dim+'\0'+label;
  if(!valid.has(key)){
    const id=`${dim.toUpperCase()}_${String(values.filter(x=>x[0]===dim).length+1).padStart(3,'0')}`;
    valid.set(key,id);values.push([dim,id,label,source,note]);
  }
  return valid.get(key);
}
for(let i=0;i<14;i++){
  const b=i===0?'HO':`C${String(i).padStart(3,'0')}`;
  values.push(['branch',b,b,'12-digit account suffix '+String(i).padStart(2,'0'),'Posting branch inferred from repeated code pattern. Legal entity and physical location names are not supplied.']);
}
for(const r of rules)for(const [k,v]of Object.entries(r.defaults))master(k,v,`Legacy base ${r.base}`,k==='related_unit_name'?'Name preserved. Do not assume a C-code or legal entity; confirm the relationship.':'Extracted or normalized from legacy names. Confirm against operational master data.');
const details=[...new Map(rules.map(r=>[r.detail_id,[r.detail_id,r.gl||'UNRESOLVED',r.detail]])).values()];

// Main chart and controlled classification values.
{
const s=base('Accounts','30 main accounts','Proposed codes. Every posting also carries entity, branch and a valid detail type.',[11,48,19,24,65,16],125);
table(s,4,['Code','Main account','Class','Normal balance','Required detail beyond entity / branch','Legacy leaf rows'],coa.map(a=>[...a,null]),'MainAccounts',54);
s.getRange('A5:A34').setNumberFormat('@');
s.getRange('F5:F34').setNumberFormat('#,##0');
s.getRange('A35').values=[['8100 is reserved for confirmed income-tax expense; the source PPh 25 balance is unresolved.']];s.getRange('A35:F35').format.wrapText=false;
section(s,38,'Controlled detail types',6);
s.getRange('A39').values=[['Use these with main accounts; expense, asset, bank and tax attributes add further detail.']];s.getRange('A39:F39').format.wrapText=false;
table(s,41,['Detail ID','Detail name','Allowed main account'],details.map(d=>[d[0],d[2],d[1]]),'DetailTypes',44);
s.getRange('A5:B34').format.font.color=color.blue;s.freezePanes.freezeRows(4);
console.log('Built Accounts');
}

// Physical / logical model, with usable posting rules rather than optional tags.
{
const s=base('Tables','Tables and relationships','One journal line is the accounting grain. Detail tables retain the information removed from account numbers.',[27,39,68,68],43);
const rows=[
['journal_header','journal_id','entity_id, document number, posting date, period, currency','One header per voucher. Separate legal ledgers even when the chart is shared.'],
['journal_line','journal_id + line_no','main_account_id, detail_id, branch_id, debit, credit; references below','Each line links to one main account and valid detail type. Store original legacy account and document for migration traceability.'],
['main_account','main_account_id','30 codes in Accounts','Accounting nature and debit/credit behavior. Report hierarchy is separate from posting accounts.'],
['detail_type','detail_id','70 migration classifications in Accounts','Allowed main account, report line, normal sign and required attribute rules. Four unresolved types must be resolved before use.'],
['legal_entity','entity_id','Legal name, ledger, tax registration, functional currency','Not supplied. Confirm which stores share an entity. A branch dimension cannot replace a separate legal ledger.'],
['branch','branch_id','HO, C001–C013; entity_id; physical location name','14 source labels. A posting branch and a related/counterparty unit are different fields.'],
['cost_center / function','cost_center_id / function_id','Department, Store operations, Office, Selling, Administration, Maintenance','Function defaults are inferred from source headings. Confirm departments and require them on P&L lines where needed.'],
['expense_type','expense_type_id','Salary, overtime, electricity, promotion, repairs, rent, etc.','Required for 6100/6200 and relevant accrual/prepayment lines. Drives budget and reporting detail.'],
['bank_cash_account','bank_cash_id','Bank, actual account, cash box, currency, branch, instrument type','Source supplies bank names, not actual account numbers. Reconcile each bank account/cash box separately.'],
['payment_method / channel','method_id / channel_id','Cash, debit card, credit card; own online, marketplace; card scheme','Tender and channel are independent. A cash/card name does not establish a sales channel.'],
['counterparty','counterparty_id','Customer, supplier, employee, principal, related unit, entity relationship','Supplier/customer and ageing records remain in their subledgers. Do not create a GL account per counterparty.'],
['asset_register','asset_id','Asset class/type, cost, useful life, depreciation, branch, ready-for-use date','Individual assets and equipment variants live here. Separate cost, accumulated depreciation and expense.'],
['inventory_item / warehouse','item_id / warehouse_id','SKU, category, bag size/material, location, in-transit status','Item/warehouse balances stay in the inventory subledger. Confirm direction of named in-transit units.'],
['tax_detail','tax_code_id + document reference','Tax type, period, recoverability, tax jurisdiction, document','Keep input/recoverable tax, tax payables and income-tax expense distinct. Tax rates are not inferred from names.'],
['loan / schedule','loan_id','Lender, terms, maturity, current portion, currency','Use 2400 for current and 2500 for non-current. Maturity must be maintained, not inferred once at migration.'],
['report_mapping','account + detail + relevant attribute','Financial statement line, management line, cash-flow rule, effective dates','Report current/non-current, related-party, equity components and cost nature separately where required. Never net asset/liability balances merely because they share a counterparty.'],
['legacy_mapping','legacy_account + effective date','Source row, main GL, detail, dimension defaults, decision, approval','Legacy Map + Rules form the proposed crosswalk. Keep old identifiers for historical drill-down.'],
['posting_rule','main_account + detail_id','Required dimensions, valid values, allowed relationships, effective dates','Reject missing/invalid detail before posting. Use controlled values; document numbers remain references, not dimensions.'],
];
table(s,4,['Table','Primary key / relationship','Fields / examples','Rule'],rows,'TableDesign',80);
section(s,25,'Implementation requirements',4);
table(s,27,['Requirement','Where it applies','Required behavior','If the system cannot support it'],[
['Dimension enforcement','All journal lines','Validate required detail and permitted account/detail combinations on entry and import.','Keep additional posting accounts for distinctions the system cannot enforce.'],
['Trial balance by dimension','Entity, branch, detail, bank','Reconcile the GL by entity, branch, main account and retained detail; support audit drill-down.','Use 30 reporting groups with a larger operational chart.'],
['Subledger controls','Receivables, payables, bank, stock, assets','Reconcile GL control balances to individual subledger records. Respect native posting-control requirements.','Retain separate control accounts where the ERP requires them.'],
['Financial statements','Report mapping','Test statutory and management reports using account plus detail. Add accounts for material/new balances absent from this master.','30 is a design target, not a cap that overrides accounting or system requirements.'],
['Migration reconciliation','Before cutover','Obtain trial balance and transaction detail. Reconcile opening balances, period movements and closing balances, including N-flag accounts.','Do not load this master-data proposal directly as a financial migration.'],
['Closing controls','Retained earnings and P&L','Choose an opening-balance or transaction-history strategy and prevent duplicate current-period profit.','Resolve with the closing process before importing any current-result balance.'],
], 'ImplementationRules',78);
s.freezePanes.freezeRows(4);
console.log('Built Tables');
}

{
const s=base('Dimension Values','Dimension value candidates','Source-derived labels. IDs are proposed; actual bank accounts, legal entities and counterparties still need their registers.',[25,34,59,31,80],values.length+4);
table(s,4,['Dimension','Proposed value ID','Label','First source example','Interpretation / missing information'],values,'DimensionValues',52);
s.freezePanes.freezeRows(4);
console.log('Built Dimension Values');
}

{
const s=base('Rules','Legacy family mapping rules','Edit proposed main code and decision together. Source families are preserved; unresolved items have no posting destination.',[19,59,16,48,14,38,76,21,96,15],endRule);
const rrows=rules.map(r=>[r.base,r.name,r.gl||'UNRESOLVED',null,r.detail_id,r.detail,Object.entries(r.defaults).map(([k,v])=>`${k}: ${v}`).join('\n'),r.decision,r.review,null]);
table(s,4,['Legacy base','Legacy family name','Proposed GL','Proposed main account','Detail ID','Detail name','Dimension defaults','Decision','Review needed before migration','Leaf rows'],rrows,'LegacyRules',82);
s.getRange(`A5:A${endRule}`).setNumberFormat('@');
s.getRange(`C5:C${endRule}`).format.font.color=color.blue;
s.getRange(`C5:C${endRule}`).dataValidation={rule:{type:'list',values:[...coa.map(a=>a[0]),'UNRESOLVED']}};
s.getRange(`H5:H${endRule}`).dataValidation={rule:{type:'list',values:['Proposed','Review required','Unresolved','Approved']}};
s.getRange(`D5:D${endRule}`).formulas=rules.map((r,i)=>[`=IF(C${i+5}="UNRESOLVED","Resolve before import",INDEX('Accounts'!$B$5:$B$34,MATCH(C${i+5},'Accounts'!$A$5:$A$34,0)))`]);
s.getRange(`H5:H${endRule}`).conditionalFormats.add('containsText',{text:'Unresolved',format:{fill:'#FCE4E4',font:{color:'#9B2424',bold:true}}});
s.getRange(`H5:H${endRule}`).conditionalFormats.add('containsText',{text:'Review required',format:{fill:color.amber}});
s.freezePanes.freezeRows(4);s.freezePanes.freezeColumns(2);
console.log('Built Rules');
}

// Reuse each family lookup across its branches; this avoids thousands of duplicate range dependencies.
const familyRow=new Map(rules.map((r,i)=>[r.base,i+5]));
{
const s=base('Family Links','Shared family lookups','Formula support for Legacy Map. Keep this fixed row order; edit mappings in Rules.',[20,20,20,26],endRule);
s.getRange(`A4:D${endRule}`).values=[['Legacy base','Main GL','Detail ID','Decision'],...rules.map(r=>[r.base,null,null,null])];
s.getRange('A4:D4').format={fill:color.navy,font:{name:font,color:'#FFFFFF',bold:true},rowHeight:32};
for(const [target,source]of [['B','C'],['C','E'],['D','H']])s.getRange(`${target}5:${target}${endRule}`).formulas=rules.map((r,i)=>[`=INDEX('Rules'!$${source}$5:$${source}$${endRule},MATCH(A${i+5},'Rules'!$A$5:$A$${endRule},0))`]);
s.freezePanes.freezeRows(4);
console.log('Built shared family lookups');
}

{
const s=base('Legacy Map','Full legacy account crosswalk','All 7,528 source accounts retained. Hierarchy is inferred; confirm actual posting permissions and the meaning of Y/N.',[13,20,68,10,11,22,19,12,17,13,22,70],endMap);
const rows=accounts.map(a=>[a.source_row,a.code,a.name,a.flag,a.level,a.role,a.role==='Heading'?'':a.base,a.branch,null,null,null,a.data_note]);
table(s,4,['CSV row','Legacy code','Legacy account name','Source flag','Code level','Inferred role','Mapping base','Branch','Proposed GL','Detail ID','Decision','Data note'],rows,'LegacyCrosswalk',42);
console.log('Populated Legacy Map');
s.getRange(`B5:B${endMap}`).setNumberFormat('@');s.getRange(`G5:J${endMap}`).setNumberFormat('@');
s.getRange(`B5:E${endMap}`).format.font.color=color.green;
for(const [target,source]of [['I','B'],['J','C'],['K','D']]){
  s.getRange(`${target}5:${target}${endMap}`).formulas=accounts.map((a,i)=>a.role==='Heading'?['=""']:[`='Family Links'!$${source}$${familyRow.get(a.base)}`]);
}
console.log('Built Legacy Map lookups');
ss.Rules.getRange(`J5:J${endRule}`).formulas=rules.map(r=>{
 const rows=accounts.map((a,i)=>a.role==='Leaf candidate'&&a.base===r.base?i+5:null).filter(Boolean);
 if(rows.length!==rows.at(-1)-rows[0]+1)throw new Error('Non-contiguous family '+r.base);
 return [`=COUNTA('Legacy Map'!$B$${rows[0]}:$B$${rows.at(-1)})`];
});
ss.Accounts.getRange('F5:F34').formulas=coa.map((a,i)=>[`=SUMIF('Rules'!$C$5:$C$${endRule},A${i+5},'Rules'!$J$5:$J$${endRule})`]);
s.getRange(`K5:K${endMap}`).conditionalFormats.add('containsText',{text:'Unresolved',format:{fill:'#FCE4E4',font:{color:'#9B2424',bold:true}}});
s.getRange(`D5:D${endMap}`).conditionalFormats.add('containsText',{text:'N',format:{fill:color.amber}});
s.freezePanes.freezeRows(4);s.freezePanes.freezeColumns(2);
}

{
const s=base('Examples','How the smaller chart works','Illustrative amounts in IDR. The journal example shows dimensions only; tax and inventory entries are outside its scope.',[26,14,22,18,20,20,27,34,20,25,25],36);
const journal=[
['SALE-01',1,'1200','C003',1000000,0,'Card settlement receivable','Credit sale awaiting settlement','Debit card','BCA',''],
['SALE-01',2,'4100','C003',0,1000000,'Merchandise sales','Same revenue account across stores','Debit card','BCA',''],
['SETTLE-01',1,'1100','C003',980000,0,'Bank current account','Actual bank account linked in register','','BCA',''],
['SETTLE-01',2,'6200','C003',20000,0,'Operating expense','Expense type = card processing fee','','','Selling'],
['SETTLE-01',3,'1200','C003',0,1000000,'Card settlement receivable','Clear original settlement receivable','Debit card','BCA',''],
['PAYROLL-01',1,'6100','C003',5000000,0,'Payroll and employee benefits','Expense type = Gaji / wages','','','Store operations'],
['PAYROLL-01',2,'1100','C003',0,5000000,'Bank current account','Entity = DEMO on all example vouchers','','BCA',''],
];
table(s,4,['Voucher','Line','Main GL','Branch','Debit (IDR)','Credit (IDR)','Detail type','Additional detail','Payment method','Bank name','Function'],journal,'ExampleJournal',66);
s.getRange('E5:F11').setNumberFormat('#,##0;(#,##0);"–"');
table(s,14,['Voucher','Debit less credit'],['SALE-01','SETTLE-01','PAYROLL-01'].map(v=>[v,null]),'JournalBalance',28);
s.getRange('B15:B17').formulas=['SALE-01','SETTLE-01','PAYROLL-01'].map((v,i)=>[`=SUMIF($A$5:$A$11,A${i+15},$E$5:$E$11)-SUMIF($A$5:$A$11,A${i+15},$F$5:$F$11)`]);
section(s,20,'Reporting examples',11);
table(s,22,['Question','Use account','Filter / group by'],[
['Sales by store','4100 / 4190','Branch; channel; sales / return / discount type'],
['Payroll by function','6100','Expense type; branch; function / cost center'],
['Electricity cost','6200','Expense type = electricity; branch'],
['Cash and bank','1100','Actual bank/cash account; currency; liquidity / maturity classification'],
['Interunit balances','1210 / 2200','Entity; posting branch; related unit; transaction reference'],
['Asset movement','1500 / 1590 / 6300','Asset class; asset ID; branch; depreciation vs amortization'],
], 'ReportExamples',52);
// Small secondary table has long questions: override these row cell wraps/height only.
s.getRange('A23:C28').format.rowHeight=76;
s.freezePanes.freezeRows(4);
}

{
const s=base('Proposal','Account consolidation proposal','Central Fashion Store · Laporan_Master_Account1.csv · source report date not supplied',[45,22,76,67],57);
table(s,4,['Measure','Count','Meaning','Evidence / limitation'],[
['Source account rows',null,'Every numeric account code in the file.','Includes report headings and accounts without child codes.'],
['Hierarchy headings',null,'Codes with at least one child code.','Inferred from code prefixes; source has no verified posting flag.'],
['Leaf candidates',null,'Accounts with no child code.','6,902 branch-suffixed rows plus six standalone codes.'],
['Proposed main accounts',null,'30 reusable natural accounts.','Extra classification moves to required detail tables and subledgers.'],
['Reduction in leaf-code count',null,'Comparison with the 30-account target.','A smaller main chart still retains bank, tax, expense, asset and reporting detail.'],
['Posting-branch labels',null,'HO and C001–C013.','Do not infer store names or legal entities from sequence numbers.'],
['Legacy family rules',null,'One rule per 10-digit family / standalone short account.','493 families repeat across 14 branches; three other 10-digit codes and three 6-digit codes.'],
['Unresolved leaf mappings',null,'Destination depends on transaction substance.','Disposed inventory, contract in progress, mixed other income/expense, and current tax/PPh 25.'],
['Provisional mappings requiring review',null,'A candidate GL exists; the stated issue still needs resolution.','Includes interunit relationships, in-transit direction, replacement reserves and recognition questions.'],
['Other proposed leaf mappings',null,'Name/prefix-based proposal without a special issue flag.','Proposed does not mean approved or reconciled.'],
['Source N flags',null,'Preserved exactly as supplied.','Meaning of Y/N is unknown. Do not drop N rows or their history.'],
], 'ProposalMeasures',62);
s.getRange('B5').formulas=[[`=COUNTA('Legacy Map'!$B$5:$B$${endMap})`]];
s.getRange('B6').formulas=[[`=COUNTIF('Legacy Map'!$F$5:$F$${endMap},"Heading")`]];
s.getRange('B7').formulas=[[`=COUNTIF('Legacy Map'!$F$5:$F$${endMap},"Leaf candidate")`]];
s.getRange('B8').formulas=[[`=COUNTA('Accounts'!$A$5:$A$34)`]];
s.getRange('B9').formulas=[['=1-B8/B7']];s.getRange('B9').setNumberFormat('0.0%');
s.getRange('B10').formulas=[[`=COUNTIF('Dimension Values'!$A$5:$A$${values.length+4},"branch")`]];
s.getRange('B11').formulas=[[`=COUNTA('Rules'!$A$5:$A$${endRule})`]];
s.getRange('B12').formulas=[[`=COUNTIF('Legacy Map'!$K$5:$K$${endMap},"Unresolved")`]];
s.getRange('B13').formulas=[[`=COUNTIF('Legacy Map'!$K$5:$K$${endMap},"Review required")`]];
s.getRange('B14').formulas=[[`=COUNTIF('Legacy Map'!$K$5:$K$${endMap},"Proposed")`]];
s.getRange('B15').formulas=[[`=COUNTIF('Legacy Map'!$D$5:$D$${endMap},"N")`]];
s.getRange('B5:B8').setNumberFormat('#,##0');s.getRange('B10:B15').setNumberFormat('#,##0');
section(s,18,'Recommendation',4);
table(s,20,['Decision','Scope','Design','Condition'],[
['Use 30 main accounts','System-independent proposal','12 asset/contra-asset accounts, 7 liabilities, 2 equity, 3 revenue/contra-revenue, 1 cost of sales, 5 expense accounts.','Use only if the system enforces dimensions and supports required subledger and financial reporting.'],
['Keep accounting detail','Required','Retain 70 classification candidates plus branch, cost type, bank, tax, asset and counterparty records.','Four detail types remain unresolved. Detail IDs are proposed migration identifiers, not new GL accounts.'],
['Preserve gross balances','Required','Keep assets/liabilities, accumulated depreciation, tax positions, customer advances and debt maturities separately identifiable.','Within shared accounts, use mandatory subtype/report mapping for current/non-current and related-party presentation.'],
['Allow account additions','When necessary','Account count may exceed 30 for ERP controls or material balances not represented in this file.','Possible examples: lease liabilities/right-of-use assets, deferred tax, FX or revaluation controls.'],
['Migration is not yet approved','Master data only','No balances, journals, contracts, subledger registers or entity mapping were supplied.','Reconcile old-to-new by entity, branch, date and retained classification before cutover.'],
], 'Recommendation',86);
section(s,28,'Migration sequence',4);
table(s,30,['Step','Owner role','Work','Completion evidence'],[
['1. Confirm source semantics','Finance / system admin','Verify posting permissions, Y/N meaning, legal entities, branches and system controls.','Approved entity/branch register and source-field definitions.'],
['2. Resolve mapping issues','Finance','Filter Rules by Unresolved and Review required. Approve main GL, detail and dimension defaults.','Every used legacy account has an approved destination or documented split rule.'],
['3. Configure masters and rules','System admin','Load main chart and validated detail masters; configure required dimensions and subledgers.','Invalid or missing combinations rejected in entry and import tests.'],
['4. Reconcile a trial migration','Finance','Map balances and journal lines; preserve counterparties, open items, stock/asset detail and historic references.','Debits = credits, total balances unchanged except approved adjustments, subledgers reconcile.'],
['5. Test reports and close','Finance','Compare branch P&L, balance sheet, tax detail, bank reconciliation, interunit matching and earnings close.','Reports reproduce agreed totals and classifications without double-counting current profit.'],
['6. Cut over and retain history','Finance / system admin','Freeze legacy posting at agreed cutover; retain audit history and approved crosswalk version.','Signed reconciliation and a controlled rollback/exception process.'],
], 'MigrationSequence',78);
section(s,39,'Sources and assumptions',4);
table(s,41,['Source','Type','Reference','Use'],[
['Laporan_Master_Account1.csv','User file','Company header: CENTRAL FASHION STORE. Account records at CSV rows 9–7,536.','All source identifiers and names are preserved in Legacy Map with CSV row numbers. No balances supplied.'],
['Chart of accounts planning','Microsoft documentation','https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/plan-chart-of-accounts','Supports main accounts plus controlled financial dimensions; system choice remains unconfirmed. Accessed 2026-09-18.'],
['Dimensions versus tags','Microsoft documentation','https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-tag-financial-dimension','Illustrates enforced combinations and dimension trial balances. This proposal does not assume free-text tags can substitute. Accessed 2026-09-18.'],
['Mapping basis','Proposal assumption','Name, prefix hierarchy and repeated two-digit branch suffix.','Account grouping is a design proposal, not a conclusion about tax treatment or accounting compliance.'],
['Display convention','Workbook guidance','Green = source fields; blue = proposed editable account fields. Amber/red = review/unresolved.','Rules drive Legacy Map through lookups. After edits, update decision, detail compatibility and required dimensions together.'],
], 'Sources',84);
}

await fs.mkdir(out,{recursive:true});
console.log('Built sheets',tabs.length,'dimension values',values.length);
const check=await wb.inspect({kind:'table',range:'Proposal!A4:D15',include:'values,formulas',tableMaxRows:12,tableMaxCols:4,maxChars:12000});
console.log(check.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'Final formula error scan',maxChars:3000});console.log(errors.ndjson);
console.log('Journal balance check',JSON.stringify(ss.Examples.getRange('B15:B17').values));
const previewRanges={Proposal:'A1:D15',Accounts:'A1:F12',Tables:'A1:D9','Dimension Values':'A1:E10',Rules:'A1:F10','Legacy Map':'A1:H12',Examples:'A1:F11','Family Links':'A1:D10'};
for(const [sheet,range]of Object.entries(previewRanges)){
 const img=await wb.render({sheetName:sheet,range,scale:1.5,format:'png'});
 await fs.writeFile(`${work}/${sheet.replaceAll(' ','_')}.png`,new Uint8Array(await img.arrayBuffer()));
 console.log('Rendered',sheet);
}
// Review wide working-table notes and secondary account definitions separately.
for(const [sheet,range,filename]of [['Rules','G4:J9','Rules_notes'],['Legacy Map','I4:L12','Legacy_notes'],['Accounts','A38:C49','Detail_types']]){
 const img=await wb.render({sheetName:sheet,range,scale:1.5,format:'png'});
 await fs.writeFile(`${work}/${filename}.png`,new Uint8Array(await img.arrayBuffer()));
}
const result=await SpreadsheetFile.exportXlsx(wb);
await result.save(`${out}/Proposed_30_Account_Structure.xlsx`);
await fs.writeFile(`${work}/verification.json`,JSON.stringify({stats,dimensionValues:values.length,summary:ss.Proposal.getRange('B5:B15').values,journalBalances:ss.Examples.getRange('B15:B17').values},null,2));
console.log('EXPORTED',`${out}/Proposed_30_Account_Structure.xlsx`);
