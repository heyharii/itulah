import json,collections,re,pathlib,csv
p=pathlib.Path('/Users/hari/itulah/outputs/coa162_audit')
d=json.loads((p/'workbook_data.json').read_text())
a={str(r[0]):{'row':i+5,'data':r} for i,r in enumerate(d['COA 162'][4:])}
c={str(r[1]):{'row':i+2,'data':r} for i,r in enumerate(d['COA 162 Config'][1:])}
m=d['Mapping Legacy'][4:]; decisions={r[0] for r in d['Keputusan'][4:]}
issues={}
issues['unknown_decision_refs']=[{'code':k,'row':v['row'],'decision':v['data'][14]} for k,v in a.items() if v['data'][14] not in decisions]
issues['name_differences']=[{'code':k,'coa_row':v['row'],'config_row':c[k]['row'],'coa_name':v['data'][1],'config_name':c[k]['data'][2]} for k,v in a.items() if v['data'][1]!=c[k]['data'][2]]
issues['manual_permission_review']=[{'code':k,'coa_row':v['row'],'config_row':c[k]['row'],'coa_manual':v['data'][8],'config_manual':c[k]['data'][6]} for k,v in a.items() if c[k]['data'][6]=='NO' and not(v['data'][8] or '').startswith(('Tidak','Ditahan'))]
issues['parent_targets']=[{'row':i+5,'code':r[1],'target':r[8]} for i,r in enumerate(m) if r[5]=='Punya anak' and r[8]]
closed=[('1011302001','Prepaid PPh21','1105101'),('2012303','Principal','2105003'),('7010215','Replacement OE expense','7103001'),('7010216002','Amortisasi Pre Opening','7104001')]
issues['closed_topic_blank_mappings']=[]
for prefix,name,target in closed:
 rows=[i+5 for i,r in enumerate(m) if r[5]=='Tanpa anak' and not r[8] and str(r[1]).startswith(prefix)]
 issues['closed_topic_blank_mappings'].append({'prefix':prefix,'topic':name,'candidate':target,'count':len(rows),'first_row':min(rows),'last_row':max(rows)})
issues['counts']={'accounts':len(a),'config_accounts':len(c),'legacy_rows':len(m),'legacy_leaves':sum(r[5]=='Tanpa anak' for r in m),'leaf_mapped':sum(r[5]=='Tanpa anak' and bool(r[8]) for r in m),'leaf_unmapped':sum(r[5]=='Tanpa anak' and not r[8] for r in m),'parent_rows':sum(r[5]=='Punya anak' for r in m),'invalid_targets':sum(bool(r[8]) and str(r[8]) not in a for r in m),'status_counts':dict(collections.Counter(v['data'][4] for v in a.values()))}
(p/'workbook_findings.json').write_text(json.dumps(issues,ensure_ascii=False,indent=2))
print(json.dumps(issues['counts']));print('Closed-topic blanks',sum(x['count'] for x in issues['closed_topic_blank_mappings']))
