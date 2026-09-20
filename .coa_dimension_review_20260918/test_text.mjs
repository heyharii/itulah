import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const wb=Workbook.create(); const s=wb.worksheets.add('Test');
s.getRange('A1:A3').format.numberFormat='@';
s.getRange('A1:A3').values=[['1011001001'],['00'],['1101']];
s.getRange('B1:B3').formulas=[['="1011001001"'],['="00"'],['="1101"']];
s.getRange('C1:C3').values=[["'1011001001"],["'00"],["'1101"]];
console.log((await wb.inspect({kind:'table',range:'Test!A1:C3',include:'values,formulas',tableMaxRows:3,tableMaxCols:3,maxChars:5000})).ndjson);
const f=await SpreadsheetFile.exportXlsx(wb); await f.save('/Users/hari/itulah/.coa_dimension_review_20260918/test_text.xlsx');
const image=await wb.render({sheetName:'Test',range:'A1:C3',scale:2,format:'png'}); await (await import('node:fs/promises')).writeFile('/Users/hari/itulah/.coa_dimension_review_20260918/test_text.png',new Uint8Array(await image.arrayBuffer()));
