import { Workbook } from '@oai/artifact-tool';
const wb=Workbook.create(); const s=wb.worksheets.add('T');
s.getRange('A1:A2').format.numberFormat='0'; s.getRange('A1:A2').format.columnWidth=18; s.getRange('A1:A2').values=[[101100100100],[101100100101]];
s.getRange('B1:B2').format.numberFormat='000000000000'; s.getRange('B1:B2').format.columnWidth=18; s.getRange('B1:B2').values=[[101100100100],[101100100101]];
const im=await wb.render({sheetName:'T',range:'A1:B2',scale:2,format:'png'}); await (await import('node:fs/promises')).writeFile('/Users/hari/itulah/.coa_dimension_review_20260918/test_long3.png',new Uint8Array(await im.arrayBuffer()));
