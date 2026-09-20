import { Workbook } from '@oai/artifact-tool';
const wb=Workbook.create(); const s=wb.worksheets.add('T');
s.getRange('A1:A2').format.numberFormat='@'; s.getRange('A1:A2').values=[['101100100100'],['101100100101']];
s.getRange('B1:B2').values=[['101100100100'],['101100100101']];
s.getRange('C1:C2').format.numberFormat='0'; s.getRange('C1:C2').values=[[101100100100],[101100100101]];
console.log((await wb.inspect({kind:'table',range:'T!A1:C2',include:'values,formulas',tableMaxRows:2,tableMaxCols:3,maxChars:5000})).ndjson);
const im=await wb.render({sheetName:'T',range:'A1:C2',scale:2,format:'png'}); await (await import('node:fs/promises')).writeFile('/Users/hari/itulah/.coa_dimension_review_20260918/test_long.png',new Uint8Array(await im.arrayBuffer()));
