import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const out='/Users/hari/itulah/outputs/posting_role_flow_jev';
const wb=Workbook.create();
const navy='#1F4E78', blue='#D9EAF7', green='#E2F0D9', amber='#FFF2CC', red='#FCE4D6', gray='#666666';
function title(s,t,sub,last='J'){
 s.showGridLines=false; s.getRange(`A1:${last}1`).merge(); s.getRange('A1').values=[[t]];
 s.getRange('A1').format.font={name:'Arial',size:16,bold:true,color:'#1F1F1F'}; s.getRange('1:1').format.rowHeight=25;
 s.getRange(`A2:${last}2`).merge(); s.getRange('A2').values=[[sub]]; s.getRange('A2').format.font={name:'Arial',size:10,italic:true,color:gray};
 s.getRange(`A3:${last}3`).format.borders={bottom:{style:'thin',color:'#B4C6D7'}};
}
function head(r){r.format.fill=navy;r.format.font={name:'Arial',bold:true,color:'#FFFFFF'};r.format.wrapText=true;r.format.horizontalAlignment='center';r.format.verticalAlignment='center';}
function tableSheet(s,headers,rows,widths,name){
 s.getRangeByIndexes(4,0,1,headers.length).values=[headers]; head(s.getRangeByIndexes(4,0,1,headers.length));
 s.getRangeByIndexes(5,0,rows.length,headers.length).values=rows;
 s.getRangeByIndexes(5,0,rows.length,headers.length).format.font={name:'Arial',size:9};
 s.getRangeByIndexes(5,0,rows.length,headers.length).format.wrapText=true;
 s.tables.add(`A5:${String.fromCharCode(64+headers.length)}${5+rows.length}`,true,name);
 s.freezePanes.freezeRows(5); s.freezePanes.freezeColumns(1);
 widths.forEach((w,i)=>s.getRange(`${String.fromCharCode(65+i)}:${String.fromCharCode(65+i)}`).format.columnWidth=w);
}

const summary=wb.worksheets.add('Ringkasan');
title(summary,'Posting Role, Process Owner, dan Flow','Rancangan berdasarkan tiga putaran Jev; 76/76 keputusan memiliki confidence 96–100%.','H');
summary.getRange('A5:B12').values=[
 ['Prinsip','Keputusan'],
 ['Process owner','Memiliki substansi bisnis, data sumber, dan persetujuan operasional'],
 ['Poster','Modul/subledger membuat jurnal rutin; HO General Accounting hanya untuk jurnal manual pengecualian'],
 ['Approver','Ditentukan oleh jenis, nilai, exception, related party, write-off, dan sensitivitas periode'],
 ['Reconciler','Independen dari pembuat dan pelepas pembayaran'],
 ['Unit','Tidak memiliki akses bank; menangani kas fisik, petty cash, receipt/count, dan bukti operasional'],
 ['HO–Unit','Rute dikendalikan pada dokumen transfer/shipment, tanpa counter_site GL'],
 ['Tim kecil','Role boleh dirangkap hanya dengan larangan tindakan konflik dan compensating review']
]; head(summary.getRange('A5:B5')); summary.getRange('A6:A12').format.font={bold:true}; summary.getRange('B6:B12').format.wrapText=true;
summary.getRange('D5:H10').values=[
 ['Pemisahan wajib','Pembuat','Persetujuan','Eksekusi/Post','Rekonsiliasi'],
 ['Pembayaran supplier','AP','Finance Manager/authorized approver','Treasury','Accounting/independent reviewer'],
 ['Payroll','Payroll','HR + Finance review','Treasury payment; payroll subledger posts','Accounting/Finance reviewer'],
 ['Perubahan bank master','Treasury maker','Finance Manager/Director','System admin after approval','Access review/auditor'],
 ['Jurnal manual','General Accounting preparer','Independent Accounting/Finance Manager','Authorized Accounting poster','Close/reconciliation reviewer'],
 ['Stock variance','Inventory/Operations','Unit Manager; HO for material variance','Inventory adjustment module','Finance + Inventory Control']
]; head(summary.getRange('D5:H5')); summary.getRange('D6:H10').format.wrapText=true;
summary.getRange('A15:H19').values=[
 ['Aturan akses','','','','','','',''],
 ['Commercial','Memiliki harga, promo, channel, dan kontrak; tidak merekonsiliasi cash settlement sendiri.','','','','','',''],
 ['HR','Memiliki employee master dan input; tidak melepaskan pembayaran payroll.','','','','','',''],
 ['GA','Memiliki fasilitas, general services, permits, maintenance, dan procurement bila ditugaskan; tidak membayar invoice sendiri.','','','','','',''],
 ['Finance','Dipecah menjadi AP, AR, Treasury, Payroll, Tax, Asset Accounting, General Accounting, dan Finance Manager.','','','','','','']
]; summary.getRange('A15:H15').format.fill=blue; summary.getRange('A15').format.font={bold:true};
for(let r=16;r<=19;r++) summary.getRange(`B${r}:H${r}`).merge(); summary.getRange('A16:A19').format.font={bold:true}; summary.getRange('B16:H19').format.wrapText=true;
summary.getRange('A:A').format.columnWidth=24;summary.getRange('B:B').format.columnWidth=66;summary.getRange('D:D').format.columnWidth=28;summary.getRange('E:H').format.columnWidth=25;

const roles=wb.worksheets.add('Role dan Pemilik'); title(roles,'Role dan Pemilik Proses','Process owner berbeda dari poster, approver, dan reconciler.','K');
const roleRows=[
 ['Unit Cashier','Operations Unit','Penjualan/shift kasir','POS sale, cash count','Tidak','POS/cash module','Tidak','Tidak','Tidak dapat memilih GL atau mengakses bank'],
 ['Unit Petty Cash Custodian','Operations Unit','Custody petty cash','Voucher, cash disbursement','Tidak sendiri','Petty-cash module','Rekonsiliasi fund awal','Tidak','Pisahkan fund dari kas penjualan'],
 ['Unit Inventory Clerk','Inventory Unit','Receipt, transfer, count','GRN, receipt, count','Tidak sendiri','Inventory module','Count/receipt awal','Tidak','Tidak membuat invoice supplier'],
 ['Unit Manager','Operations','Operasi unit dan bukti','Approval shift/receipt/variance kecil','Dalam limit','Tidak manual','Review kas dan operasi','Tidak','Material exception ke HO'],
 ['HR','HR','Employee master dan employment event','Master/input payroll','HR data','Payroll module','Review people data','Tidak','Tidak melepas bank payroll'],
 ['GA / Procurement','GA','Facilities, general services, vendor/PO','Requisition, sourcing, contract/service evidence','Dalam mandat','PO/service modules','Vendor/service review','Tidak','Tidak menyetujui invoice dan membayar sendiri'],
 ['Operations HO','Operations','Store execution, SOP, cash handoff','Operational approvals','Dalam mandat','Operational modules','Review store exception','Tidak','Tanpa bank release'],
 ['Commercial','Commercial','Product, price, promo, channel, contracts','Commercial master/terms','Commercial terms','POS/e-commerce posts','Review sales terms','Tidak','Tidak merekonsiliasi settlement sendiri'],
 ['Inventory Control','Inventory','Stock policy, transfer, count','Transfer/count approval','Inventory thresholds','Inventory module','Stock reconciliation','Tidak','Tidak membuat AP invoice'],
 ['Accounts Payable','Finance','Supplier invoice dan AP aging','Invoice/match/payment proposal','Invoice workflow','AP subledger','AP aging/match','Tidak','Tidak release bank'],
 ['Accounts Receivable','Finance','Acquirer/customer settlement','Settlement matching','AR exception','AR subledger','AR/acquirer reconciliation','Tidak','Tidak mengubah commercial terms'],
 ['Treasury','Finance','Bank, cash funding, payment release','Payment instruction, bank confirmation','Tidak atas batch sendiri','Treasury/payment module','Bukan final reviewer rekening sendiri','Ya','Tidak final-approve recon sendiri'],
 ['Payroll','Finance','Payroll calculation dan liability','Payroll run','Payroll workflow','Payroll subledger','Payroll register','Tidak','Tidak mengubah employee master tanpa HR'],
 ['Tax','Finance','Tax code, returns, tax reconciliation','Tax validation/return adjustment','Tax workflow','Source modules + controlled journal','Tax ledger','Tidak sendiri','Tidak menentukan transaksi sumber'],
 ['Asset Accounting','Finance','Capitalization, depreciation, disposal accounting','Asset record/accounting review','Asset workflow','Asset subledger','Asset register to GL','Tidak','Tidak memegang custody fisik sendiri'],
 ['General Accounting','Finance','GL, schedules, close, manual exceptions','Controlled manual journal','Bukan jurnal sendiri','GL/schedule/close engine','GL and bank review','Tidak','Tidak menjadi system admin'],
 ['Finance Manager','Finance','Policy, financial approval, close','High-risk approval','Ya sesuai matrix','Tidak rutin','Management review','Approval only','Tidak menjadi preparer rutin'],
 ['Director / Owner','Oversight','Policy dan high-risk exception','High-value/related-party approval','Ya sesuai threshold','Tidak rutin','Oversight','Dual approval bila perlu','Tidak menghapus evidence/SoD'],
 ['Auditor','Oversight','Assurance','Tidak membuat transaksi','Tidak rutin','Tidak','Read-only review','Tidak','Tidak menjadi production admin'],
 ['System Administrator','IT/Control','Access provisioning','Approved access change','Tidak atas request sendiri','System access only','Access-log support','Tidak','Tidak memiliki posting/approval bisnis']
];
tableSheet(roles,['Role','Departemen','Process Owner','Boleh Membuat','Boleh Approve','Poster/Module','Reconcile/Review','Akses Bank','Larangan Utama'],roleRows,[28,20,34,32,20,28,30,16,48],'RoleCatalog');

const flows=wb.worksheets.add('Posting Flow'); title(flows,'Posting Flow dan Ownership','Setiap flow menunjukkan initiator, owner, poster, approver, dan reconciler.','L');
const flowRows=[
 ['Penjualan retail','POS/e-commerce','Commercial + Operations','POS/order','POS subledger','Unit Manager untuk shift/exception','AR/Treasury','site, shift, item, channel, tender, acquirer','Harga/promo terkunci; no manual GL'],
 ['Kas penjualan ke HO/bank','Unit Cashier','Operations','Cash handoff/deposit','Cash module; Treasury confirms bank','Unit Manager + Treasury control','Accounting/independent Treasury reviewer','site, shift, cash_location, deposit_ref','Unit tidak melihat/mengoperasikan bank'],
 ['Petty cash expense','Requester + Custodian','Operations/GA/benefiting dept','Petty cash voucher','Petty cash module','Budget/process owner; Unit Manager','Finance','site, cost_center, cash_location, expense/advance type','Receipt, limit, fund separation'],
 ['Petty cash replenishment','Custodian request','Treasury','Replenishment request/payment','Treasury payment module','Finance Manager/authorized approver','Accounting','fund, site, payment_id','Reconcile imprest before replenish'],
 ['Purchase requisition/PO','Benefiting department','GA/Procurement','PR, quote, PO','Procurement module; no GL until event','Budget owner + delegated approver','Procurement review','cost_center, site, item/service, contract','Vendor maker-checker; budget check'],
 ['Merchandise receipt/GRNI','Inventory Clerk','Inventory','PO + GRN','Inventory subledger: Dr inventory / Cr GRNI','Unit/Inventory Manager; exception escalation','Inventory Control + AP match','site, item, warehouse, PO, GRN','Quantity/condition evidence'],
 ['Service/non-stock receipt','Requester','HR/GA/Ops/Commercial owner','Service acceptance','AP posts after invoice/match','Business owner','AP/Accounting','cost_center, site, contract','Independent service evidence'],
 ['Supplier invoice/AP','AP','Finance AP','Invoice + tax + PO/GRN','AP subledger','AP workflow + exception approver','AP aging/Accounting','supplier, invoice, tax_code, cost_center','Duplicate and bank-change controls'],
 ['Supplier payment','AP prepares','Treasury','Approved payment batch','Treasury/payment module','Finance Manager/authorized approver','Accounting/bank reconciler','invoice_ids, beneficiary, bank_account, batch','Maker-checker-release separation'],
 ['HO ke unit inventory','Inventory HO','Inventory','Transfer order, dispatch, shipment, receipt','Inventory transfer module','Inventory Manager; Unit confirms receipt','Inventory Control','origin, destination, shipment, items','Only allowed HO-unit routes'],
 ['Stock count/variance','Inventory + Operations','Inventory','Count plan and variance','Inventory adjustment module','Unit Manager; HO for material exception','Finance + Inventory Control','site, warehouse, item, variance_type','Independent recount and reason'],
 ['Payroll','HR inputs; Payroll runs','HR + Finance Payroll','Approved payroll run','Payroll subledger','HR Manager + Finance reviewer','Accounting; Treasury settles','period, employee, component, cost_center','HR cannot release bank'],
 ['Prepaid/accrual','Business owner + Accounting','General Accounting','Schedule/accrual record','Schedule engine','Accounting reviewer/Finance Manager by risk','General Accounting','schedule, contract, accrual_type, site','Auto reversal and roll-forward'],
 ['Aset tetap','Business/GA + Asset Accounting','Asset Accounting','PO/invoice, asset record, disposal','Asset subledger','Capitalization/disposal approver','Asset Accounting + Finance','asset, class, site, custodian, work_order','Expense/capitalize rule; physical custody separate'],
 ['Pajak','Source module + Tax','Tax','Tax calculation/return','Source modules; controlled exception journal','Tax reviewer + Finance Manager','Tax ledger/Accounting','tax_code, period, document','PPN input/output separate; return tie-out'],
 ['Bank reconciliation','Treasury data; reconciler','General Accounting','Bank statement and recon','Controlled recon adjustment','Independent Accounting/Finance Manager','Independent reconciler','bank_account, statement, reason_code','Releaser cannot final-approve own recon'],
 ['Period close','Subledger owners','General Accounting','Close checklist/certification','Subledgers, schedules, close engine','Finance Manager','Accounting + management review','period, entity, site where relevant','Profit system-derived; lock period'],
 ['Jurnal manual exception','General Accounting preparer','General Accounting','Reason-coded journal + evidence','Authorized GL poster','Independent approver by risk','Close/reconciliation reviewer','all required dimensions, reversal','Balanced, supported, immutable audit trail']
];
tableSheet(flows,['Flow','Initiator','Process Owner','Source Document','Poster/Module','Approver','Reconciler','Dimensi/Data Wajib','Kontrol Kunci'],flowRows,[29,25,26,34,34,30,28,48,55],'PostingFlows');

const sod=wb.worksheets.add('Segregasi Tugas'); title(sod,'Segregasi Tugas dan Role Rangkap','NO berarti kombinasi tindakan dilarang; CONDITIONAL memerlukan compensating controls.','H');
const sodRows=[
 ['AP prepare + bank release','NO','Treasury terpisah; dual bank approval jika tim kecil','Pembuat batch tidak boleh melepas sendiri'],
 ['Bank release + final bank-recon approval','NO','Independent Accounting/Finance Manager review','Treasury boleh memberi data, bukan final approve'],
 ['Manual journal prepare + approve','NO','Independent approver','Threshold berdasarkan risiko'],
 ['Master-data maker + checker','NO','Maker-checker','Supplier, employee bank, refund, company bank'],
 ['HR input + Payroll calculation','CONDITIONAL','Independent payroll-register and master-change review; no bank release','Cocok untuk tim kecil dengan log'],
 ['GA + Procurement','CONDITIONAL','Requester/budget approval, quotes, receipt, AP and payment separation','GA tidak end-to-end'],
 ['AP + AR processing','CONDITIONAL','Separate queues; no bank release; independent reconciliations','Finance Manager review'],
 ['Cashier + Petty Cash Custodian','CONDITIONAL','Separate physical funds and cash locations; daily independent review','Jangan campur kas penjualan'],
 ['Inventory Clerk + variance approval','NO untuk self-approval','Unit Manager/HO approval','Material variance ke HO'],
 ['General Accounting + System Admin','NO','Independent access administration','Poster tidak memberi akses dirinya'],
 ['Auditor + Production Admin/Poster','NO','Read-only auditor','Admin log direview'],
 ['Owner approval + bypass evidence','NO','Exception reason, evidence, independent posting/reconciliation tetap wajib','Owner bukan pengganti audit trail']
];
tableSheet(sod,['Kombinasi','Status','Compensating Control','Catatan'],sodRows,[40,20,68,55],'SoDMatrix');
sod.getRange(`B6:B${5+sodRows.length}`).conditionalFormats.add('containsText',{text:'NO',format:{fill:red,font:{color:'#9C0006'}}});
sod.getRange(`B6:B${5+sodRows.length}`).conditionalFormats.add('containsText',{text:'CONDITIONAL',format:{fill:amber,font:{color:'#7F6000'}}});

const forms=wb.worksheets.add('Form UI'); title(forms,'Form UI Berdasarkan Konteks','User mengisi kejadian bisnis; akun dan dimensi teknis diturunkan oleh rules.','H');
const formRows=[
 ['Penjualan','Unit Cashier','POS/order, tanggal/waktu, site, shift, items, qty, price/promo, tender, customer/order','Revenue GL, tax mapping, acquirer receivable','Unit Manager hanya exception/shift close','Cashier tidak melihat COA 225'],
 ['Cash handoff/deposit','Cashier; Unit Manager; Treasury','Site, shift, expected/count, variance, handoff parties, deposit ref, timestamps, evidence','Cash clearing and bank posting','Unit Manager then Treasury confirmation','Bank field hanya HO Treasury'],
 ['Petty cash','Requester; Custodian','Purpose, cost center/site, amount, category, receipt, beneficiary, fund','Expense/advance and cash GL','Process owner/Unit Manager by threshold','Cash location fixed by custodian role'],
 ['Purchase requisition/PO','All departments; GA/Procurement','Requester, cost center, item/service, qty, spec, budget, needed date, quotes, vendor','No arbitrary GL; category/default accounting','Budget owner + procurement approval','AP tidak menciptakan kebutuhan'],
 ['Receipt','Inventory or requester','PO/contract, site, item/service, qty, condition, date, receiver, exception, evidence','Inventory/GRNI or acceptance status','Inventory/Business owner','Supplier tidak approve receipt sendiri'],
 ['Supplier invoice','AP','Supplier, invoice/date, tax invoice, PO/GRN/acceptance, amount, due date, match exceptions','AP, tax, inventory/expense/asset mapping','AP workflow + exception approver','Bank-detail change warning'],
 ['Payment','AP; Treasury','Approved invoice IDs, beneficiary master, bank, amount, method, batch, confirmation','AP settlement and bank GL','Finance approver; Treasury release','No unlinked beneficiary'],
 ['Inventory transfer','Inventory','Transfer order, allowed route, origin, destination, item, qty, dispatch, shipment, receipt, discrepancy','Transit and inventory GL','Inventory Manager; destination confirms','No counter_site GL selector'],
 ['Stock count','Inventory/Operations','Plan, scope, counters, item/location, system/count/recount qty, reason, evidence','Inventory adjustment and loss/allowance','Unit Manager; HO for material','Counter cannot self-approve'],
 ['Payroll','HR/Payroll/Finance','Period, population, master changes, attendance/components, exceptions, gross-net, liabilities, funding','Payroll expense/liability mapping','HR + Finance review','Bank detail restricted'],
 ['Asset','GA/Business/Asset Accounting','PO/invoice, class, description, custodian, site, in-service date, cost, life, method, component, disposal evidence','Asset cost, accumulated, depreciation/gain-loss','Capitalization/disposal approver','GA cannot choose arbitrary GL'],
 ['Tax','Tax/AP/AR/Accounting','Tax code, period, source document, base, tax amount, return, settlement','Tax asset/liability/expense mapping','Tax reviewer + Finance','Source transaction remains linked'],
 ['Manual journal','General Accounting','Reason, source, period, balanced lines, required dimensions, approver, reversal','Entered lines after rule validation','Independent approver','No department-wide unrestricted journal']
];
tableSheet(forms,['Form','Pengguna','Field Terlihat','Diturunkan Sistem','Approval','Batas UI'],formRows,[28,28,70,48,38,48],'FormDesign');

const src=wb.worksheets.add('Sumber'); title(src,'Sumber dan Batas','Keputusan Jev harus diuji dengan permission matrix dan transaksi representatif sebelum go-live.','F');
src.getRange('A5:F5').values=[['Sumber','Lokasi','Putaran','Keputusan','Confidence','Catatan']]; head(src.getRange('A5:F5'));
src.getRange('A6:F9').values=[
 ['Jev role ownership',`${out}/../jev_posting_role_flow/response_1.json`,1,'26 keputusan ownership','100%','Process owner berbeda dari poster'],
 ['Jev SoD dan poster',`${out}/../jev_posting_role_flow/response_2.json`,2,'25 keputusan SoD/poster','99–100%','Routine posting dari subledger'],
 ['Jev role/form detail',`${out}/../jev_posting_role_flow/response_3.json`,3,'25 keputusan role/form','96–100%','Role rangkap bersyarat'],
 ['Konteks client','Percakapan','—','Satu PT Perorangan; HO finance; unit tanpa bank','Client-confirmed','Role aktual dan threshold nominal belum diberikan']
]; src.getRange('A6:F9').format.wrapText=true; src.tables.add('A5:F9',true,'Sources'); ['A','B','C','D','E','F'].forEach((c,i)=>src.getRange(`${c}:${c}`).format.columnWidth=[25,68,12,45,16,52][i]);

for(const s of [summary,roles,flows,sod,forms,src]){const u=s.getUsedRange();u.format.verticalAlignment='top';}
await fs.mkdir(out,{recursive:true});
const x=await SpreadsheetFile.exportXlsx(wb); await x.save(`${out}/Posting_Role_Owner_Flow.xlsx`);
for(const [sheetName,range,file] of [
 ['Ringkasan','A1:H20','preview_summary.png'],['Role dan Pemilik','A1:I25','preview_roles.png'],
 ['Posting Flow','A1:I24','preview_flows.png'],['Segregasi Tugas','A1:D18','preview_sod.png'],
 ['Form UI','A1:F19','preview_forms.png'],['Sumber','A1:F10','preview_sources.png']]){
 const b=await wb.render({sheetName,range,scale:1.25,format:'png'}); await fs.writeFile(`${out}/${file}`,new Uint8Array(await b.arrayBuffer()));
}
console.log((await wb.inspect({kind:'table',range:'Ringkasan!A1:H20',include:'values,formulas',tableMaxRows:25,tableMaxCols:10})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:300},summary:'formula error scan'})).ndjson);
