import type {RecordType} from './engine';
export const navigation:Record<string,string[]>={
'STORE':['Sales','Sales Reconciliation','Expenses','Cash On Hand','Petty Cash','Modal Kasir','Cash Counts','Transactions','Payment Instructions'],
'CASH & BANK':['Cash','Bank Accounts','Bank Transactions','Transfers','Bank Reconciliation'],
'EXPENSES & BILLS':['Expenses','Bills','Suppliers / Vendors','Outstanding','Due / Overdue','Aging','Expense Claims','Recurring Bills'],
'PAYMENTS':['Requests','Payment Runs','Payments','Exceptions','Reconciliation'],
'RECEIVABLES':['Outstanding','Due / Overdue','Aging','Customer','Acquirer / EDC / QRIS','Employee','Affiliate','Receipts / Collections','Reconciliation'],
'ACCOUNTING':['Journals','Accruals','Prepaids','Prepaid Schedules','Deferred Revenue','Advances','Other Liabilities','Adjustments','General Ledger','Trial Balance','Chart of Accounts','Dimensions / Line Categories','Recurring Entries','Audit Trail','Period Close'],
'BUDGET & FORECASTING':['Budgets','Budget vs Actual','Forecasts','Cash Forecast','Cash Requirements'],
'INVENTORY':['Overview','Valuation','BDP / In Transit','Adjustments'],
'PAYROLL':['Overview','Payroll Runs','Payroll Payable','Payment Status'],
'AFFILIATE BALANCES':['Due From','Due To','Settlements','Reconciliation'],
'ASSETS':['Overview','Register','Projects / CIP','Pre-opening','Depreciation','OE Replacement'],
'TAX':['Overview','Position','Payable / Receivable','Payments','Reconciliation'],
'FINANCING':['Overview','Loans','Interest','Repayments','Equity / Owners'],
'REPORTS':['Profit & Loss','Balance Sheet','Cash Flow','General Ledger','Trial Balance','AP Aging','AR Aging','Other Financial Reports']};
export function recordType(group:string,page:string):RecordType {
 if(group==='PAYROLL')return page==='Payment Status'?'Payment':'Payroll';if(group==='TAX')return page==='Payments'?'Payment':'Tax';if(group==='FINANCING')return page==='Repayments'?'Payment':page==='Equity / Owners'?'Equity':'Loan';if(group==='INVENTORY')return page==='Adjustments'?'Adjustment':'Inventory';if(group==='AFFILIATE BALANCES')return 'Affiliate';if(group==='ASSETS')return ({'Projects / CIP':'Project','Pre-opening':'Pre-opening','OE Replacement':'OE Replacement'} as Record<string,RecordType>)[page]||'Asset';
 if(group==='BUDGET & FORECASTING')return page.includes('Forecast')?'Forecast':'Budget';if(group==='RECEIVABLES')return page==='Receipts / Collections'?'Receipt':'Receivable';if(group==='PAYMENTS')return page==='Requests'?'Request':page==='Payment Runs'?'Payment Run':'Payment';
 return ({Sales:'Sales','Sales Reconciliation':'Sales',Expenses:'Expense','Cash Counts':'Cash Count','Payment Instructions':'Payment Instruction','Bank Transactions':'Bank Transaction',Transfers:'Transfer',Bills:'Bill',Outstanding:'Bill','Due / Overdue':'Bill',Aging:'Bill','Expense Claims':'Expense Claim','Recurring Bills':'Recurring Bill',Accruals:'Accrual',Prepaids:'Prepaid','Prepaid Schedules':'Prepaid','Deferred Revenue':'Deferred Revenue',Advances:'Advance','Other Liabilities':'Other Liability',Adjustments:'Adjustment','Recurring Entries':'Recurring Entry',Journals:'Journal'} as Record<string,RecordType>)[page]||'Bill';
}
export const descriptions:Record<string,string>={Bills:'Manage supplier obligations, from invoice to settlement.','Bank Reconciliation':'Bring your books and bank reality into balance.','Payment Runs':'One controlled decision. Multiple payments.','Sales Reconciliation':'Connect POS sales, physical cash, and acquirer settlements.','Cash Counts':'Count what is there. Understand every difference.','Transfers':'Move money between your own accounts, with clear receiving confirmation.','Payments':'Prepare, approve, and trace every outgoing payment.','Receipts / Collections':'Record collections and allocate them to open receivables.','Audit Trail':'Every financial decision, with a clear record of who and when.','Period Close':'Close with confidence. Reopen with accountability.'};
