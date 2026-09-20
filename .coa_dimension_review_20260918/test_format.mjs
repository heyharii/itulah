import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const wb=Workbook.create(); const s=wb.worksheets.add('Test');
s.getRange('A1:A3').format.numberFormat='00';
s.getRange('A1:A3').values=[['00'],['01'],['13']];
s.getRange('B1:B3').format.numberFormat='00';
s.getRange('B1:B3').values=[[0],[1],[13]];
console.log((await wb.inspect({kind:'table',range:'Test!A1:B3',include:'values,formulas',tableMaxRows:3,tableMaxCols:2,maxChars:5000})).ndjson);
const image=await wb.render({sheetName:'Test',range:'A1:B3',scale:2,format:'png'}); await (await import('node:fs/promises')).writeFile('/Users/hari/itulah/.coa_dimension_review_20260918/test_format.png',new Uint8Array(await image.arrayBuffer()));
const f=await SpreadsheetFile.exportXlsx(wb); await f.save('/Users/hari/itulah/.coa_dimension_review_20260918/test_format.xlsx');
