import { Workbook } from '@oai/artifact-tool';
const wb=Workbook.create(); const s=wb.worksheets.add('T');
s.getRange('A1:A2').formulas=[['="101100100100"'],['=TEXT(101100100100,"0")']];
s.getRange('B1:B2').values=[["'101100100100"],["'101100100101"]];
console.log((await wb.inspect({kind:'table',range:'T!A1:B2',include:'values,formulas',tableMaxRows:2,tableMaxCols:2,maxChars:5000})).ndjson);
const im=await wb.render({sheetName:'T',range:'A1:B2',scale:2,format:'png'}); await (await import('node:fs/promises')).writeFile('/Users/hari/itulah/.coa_dimension_review_20260918/test_long2.png',new Uint8Array(await im.arrayBuffer()));
