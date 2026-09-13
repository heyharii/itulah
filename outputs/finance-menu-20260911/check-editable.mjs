import {SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
const w=await SpreadsheetFile.importXlsx(await FileBlob.load(new URL('./Rancangan_Menu_dan_Tab_Finance.xlsx',import.meta.url).pathname));
const s=w.worksheets.getItem('20 Contoh Subtable');
for(const [input,value,output,expected] of [['F29',2500000,'G29',500000],['C61',3,'F61',3000000],['D204',2600000,'D211',100000]]){
const old=s.getRange(input).values;s.getRange(input).values=[[value]];const actual=s.getRange(output).values[0][0];if(actual!==expected)throw Error(JSON.stringify({input,actual,expected}));s.getRange(input).values=old;console.log(input+' calculation passed');}
