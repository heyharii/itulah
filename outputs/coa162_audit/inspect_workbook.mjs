import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
const p='/Users/hari/Downloads/Retail_OS_COA_v1_162_Merged_Master.xlsx';
const w=await SpreadsheetFile.importXlsx(await FileBlob.load(p));
console.log((await w.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:1000})).ndjson);
console.log((await w.inspect({kind:'table',range:'Rekonsiliasi!F5:I7',tableMaxRows:3,tableMaxCols:4,maxChars:1500})).ndjson);
for(const [sheet,range,label] of [['Panduan','A1:C15','guide'],['COA 162','A60:G66','new_accounts'],['COA 162 Config','B56:G62','config'],['Mapping Legacy','H1108:M1111','mapping'],['Rekonsiliasi','E4:I8','reconciliation']]){
const blob=await w.render({sheetName:sheet,range,scale:1,format:'png'});await fs.writeFile(`/Users/hari/itulah/outputs/coa162_audit/${label}.png`,new Uint8Array(await blob.arrayBuffer()));}
console.log('Read-only inspection complete; source file not exported or modified.');
