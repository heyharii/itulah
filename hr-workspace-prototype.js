(function(){
  'use strict';
  const D=HRWorkspaceDomain.create(HRWorkspaceSeed), db=D.db;
  const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah=new Intl.NumberFormat('id-ID',{maximumFractionDigits:0});
  const cash=n=>(n<0?'−':'')+'Rp '+rupiah.format(Math.abs(n||0));
  const date=v=>v?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T00:00:00Z')):'—';
  const month=v=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'-01T00:00:00Z'));
  const menus={Overview:['Inbox','Reports'],Employees:['Directory','Changes','Onboarding','Offboarding','Discipline'],Schedules:['Roster','Calendar','Swaps'],Attendance:['Records','Corrections','Leave','Overtime'],Payroll:['Runs','Adjustments','Payslips','Tax'],Claims:['Requests','History'],Benefits:['Balances','History'],Loans:['Loans','Repayments'],Travel:['Requests','Settlements'],Settings:['Organization','Attendance','Payroll','Claims','Benefits','Access','Workflows']};
  const icons={Overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',Employees:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.9',Schedules:'M4 5h16v16H4z M7 2v6 M17 2v6 M4 10h16 M8 14h3 M8 17h8',Attendance:'M12 8v4l3 2 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',Payroll:'M3 5h18v14H3z M3 9h18 M15 14h3',Claims:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',Benefits:'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8C4 8 5 2 8 3c2 0 4 5 4 5 M12 8c8 0 7-6 4-5-2 0-4 5-4 5',Loans:'M3 15h4l4-4h6a2 2 0 0 1 0 4h-4 M7 15l7 5 7-6 M3 13v7 M14 3v5 M11 5h6',Travel:'M3 8h18v13H3z M8 8V4h8v4 M8 8v13 M16 8v13',Settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z'};
  const typeMenu={employee:'Employees',change:'Employees',discipline:'Employees',lifecycle:'Employees',roster:'Schedules',swap:'Schedules',attendance:'Attendance',correction:'Attendance',leave:'Attendance',overtime:'Attendance',payroll:'Payroll',adjustment:'Payroll',claim:'Claims',benefit:'Benefits',benefitmovement:'Benefits',loan:'Loans',repayment:'Loans',travel:'Travel',settlement:'Travel'};
  const q=new URLSearchParams(location.search);
  const state={menu:menus[q.get('menu')]?q.get('menu'):'Overview',tab:'Inbox',actor:db.actors[q.get('actor')]?q.get('actor'):'maya',unit:q.get('unit')||'all',period:q.get('period')||db.period,query:'',filter:'All',leaveView:'Requests',stack:[],phone:false};
  state.tab=menus[state.menu].includes(q.get('tab'))?q.get('tab'):menus[state.menu][0];
  if(!['all',...db.units.map(x=>x.id)].includes(state.unit))state.unit='all';
  if(!/^2026-(09|10|11)$/.test(state.period))state.period=db.period;
  const actor=()=>D.actor(state.actor), employee=id=>D.employee(id), unit=id=>db.units.find(x=>x.id===id)?.name||id||'—';
  const canEmployer=()=>actor().employer, visibleMenus=()=>Object.keys(menus).filter(m=>canEmployer()||!['Benefits','Loans','Settings'].includes(m));
  const scoped=rows=>D.scoped(rows,actor(),canEmployer()?state.unit:actor().unit);
  const periodRows=rows=>rows.filter(r=>r.period?r.period===state.period:r.date?String(r.date).startsWith(state.period):r.start?String(r.start).startsWith(state.period):true);
  const records=(type,period=false)=>{const rows=scoped(D.by(type));return period?periodRows(rows):rows;};
  const btn=(label,action,attrs='',primary=false)=>`<button type="button" class="ds-btn ds-btn--${primary?'primary':'quiet'}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
  const formBtn=(label,type,context={},primary=false)=>btn(label,'form',`data-type="${type}" data-context="${esc(JSON.stringify(context))}"`,primary);
  const link=(id,label)=>`<button class="ds-link" type="button" data-action="open" data-id="${esc(id)}">${esc(label||D.title(D.get(id)))}</button>`;
  const status=(word,pill=false)=>{const tone=['Pending','Submitted','Requested'].includes(word)?'warn':['Rejected','Terminated'].includes(word)?'bad':['Active','Approved','Paid','Completed','Recorded','Published','Applied'].includes(word)?'ok':'neutral';return `<span class="ds-${pill?'pill':'status'} ds-${pill?'pill':'status'}--${tone}">${esc(word)}</span>`;};
  const facts=entries=>`<dl class="ds-facts">${entries.map(([k,v])=>`<div class="ds-fact"><dt>${esc(k)}</dt><dd>${v===null||v===undefined||v===''?'—':v}</dd></div>`).join('')}</dl>`;
  const kpis=entries=>`<div class="ds-kpis">${entries.map(([label,value,bad])=>`<div class="ds-kpi"><div class="ds-kpi-label">${esc(label)}</div><div class="ds-kpi-value ${bad?'is-bad':''}">${esc(value)}</div></div>`).join('')}</div>`;
  const section=(title,body,action='')=>`<section><h3 class="section-heading">${esc(title)}${action}</h3>${body}</section>`;
  function related(rows,empty='Nothing recorded yet.'){
    return rows.length?`<div class="related-list">${rows.map(r=>`<button type="button" class="related-row" data-action="open" data-id="${esc(r.id)}"><span><strong>${esc(D.title(r))}</strong><small>${esc(r.type==='employee'?`${r.position} · ${unit(r.unit)}`:`${date(r.date||r.start)} · ${r.status}`)}</small></span>${r.amount!==undefined?`<span class="amount">${cash(r.amount)}</span>`:''}<span class="chev">›</span></button>`).join('')}</div>`:`<p class="blank-section">${esc(empty)}</p>`;
  }
  function toast(message){const el=$('.toast');el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,3200);}
  function url(push=false){const p=new URLSearchParams({menu:state.menu,tab:state.tab,actor:state.actor,unit:state.unit,period:state.period});const top=state.stack.at(-1);if(top?.kind==='record')p.set('record',top.id);history[push?'pushState':'replaceState']({},'',location.pathname+'?'+p);}
  function guard(fn){if(state.stack.some(x=>x.kind==='form'&&x.dirty)){guard.next=fn;$('#confirm').showModal();}else fn();}
  function navigate(menu,tab){guard(()=>{state.menu=menu;state.tab=menus[menu].includes(tab)?tab:menus[menu][0];state.query='';state.filter='All';state.stack=[];$('#sidebar').classList.remove('open');render();url(true);$('#page').focus({preventScroll:true});});}
  function open(id){const r=D.get(id);if(!r||!D.readable(r,actor()))return toast('This record is outside your demo role or unit.');const at=state.stack.findIndex(s=>s.kind==='record'&&s.id===id);if(at>=0)state.stack.splice(at+1);else state.stack.push({kind:'record',id,returnFocus:document.activeElement});renderLayers();url(true);}
  function close(){guard(()=>{const last=state.stack.pop();renderLayers();url();last?.returnFocus?.focus?.({preventScroll:true});});}
  function special(kind,source){state.stack.push({kind,source,returnFocus:document.activeElement});renderLayers();}
  function tabs(){return `<div class="ds-tabs" role="tablist" aria-label="${state.menu} views">${menus[state.menu].map(t=>`<button type="button" class="ds-tab ${t===state.tab?'is-selected':''}" role="tab" aria-selected="${t===state.tab}" data-action="tab" data-value="${t}">${t}</button>`).join('')}</div>`;}
  function pending(){return scoped(db.records).filter(r=>(r.status==='Pending'||r.status==='Submitted')&&['leave','correction','swap','claim','payroll','change','travel'].includes(r.type));}
  function navigation(){const count=pending().length;$('#sidebar nav').innerHTML=visibleMenus().map(m=>`<button type="button" class="nav-row ${state.menu===m?'active':''}" data-action="nav" data-value="${m}" ${state.menu===m?'aria-current="page"':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[m]}"></path></svg><span>${m}</span>${m==='Overview'&&count?`<span class="ds-count">${count}</span>`:''}</button>`).join('');}
  const newTypes={Employees:{Directory:['New employee','employee'],Changes:['Request change','change'],Onboarding:['Start onboarding','lifecycle'],Offboarding:['Start offboarding','lifecycle'],Discipline:['Record warning','discipline']},Schedules:{Roster:['Record shift','roster'],Swaps:['Request swap','swap']},Attendance:{Corrections:['Request correction','correction'],Leave:['Request leave','leave'],Overtime:['Order overtime','overtime']},Payroll:{Runs:['New payroll','payroll'],Adjustments:['Record adjustment','adjustment']},Claims:{Requests:['Record claim','claim']},Loans:{Loans:['Request loan','loan']},Travel:{Requests:['Request travel','travel']}};
  function newAction(){const v=newTypes[state.menu]?.[state.tab];if(!v)return null;if(['employee','change','discipline','lifecycle','loan'].includes(v[1])&&!canEmployer())return null;return {label:v[0],type:v[1],context:v[1]==='lifecycle'?{kind:state.tab==='Offboarding'?'Offboarding':'Onboarding'}:{}};}
  function render(){
    if(!visibleMenus().includes(state.menu)){state.menu='Overview';state.tab='Inbox';}
    navigation();const create=newAction();
    $('#page').innerHTML=`<header class="page-head"><h1>${state.menu}</h1><div class="head-actions">${state.menu==='Travel'?'<span class="prototype-label">Proposed workflow</span>':''}${create?formBtn(create.label,create.type,create.context,true):''}</div></header><div class="context"><label>Unit<select data-change="unit" aria-label="Unit">${canEmployer()?'<option value="all">All units</option>':''}${db.units.filter(x=>canEmployer()||x.id===actor().unit).map(x=>`<option value="${x.id}" ${(canEmployer()?state.unit:actor().unit)===x.id?'selected':''}>${x.name}</option>`).join('')}</select></label><label>Period<select data-change="period" aria-label="Period">${['2026-09','2026-10','2026-11'].map(p=>`<option value="${p}" ${p===state.period?'selected':''}>${month(p)}</option>`).join('')}</select></label><label>Reviewer<select data-change="actor" aria-label="Demo reviewer">${Object.entries(db.actors).map(([id,a])=>`<option value="${id}" ${id===state.actor?'selected':''}>${a.name} · ${a.employer?'HR':'Manager'}</option>`).join('')}</select></label><time>17 Oct 2026</time></div><div id="page-content"></div><div class="mobile-dock"><button class="ds-btn ds-btn--quiet" data-action="menu" aria-label="Open HR menus">Menu</button><select aria-label="Page view" data-change="mobile-tab">${menus[state.menu].map(t=>`<option ${t===state.tab?'selected':''}>${t}</option>`).join('')}</select><button class="ds-btn ds-btn--quiet" data-action="search" aria-label="Search records">Search</button>${create?formBtn(create.label.replace('Record ','').replace('Request ','').replace('Start ',''),create.type,create.context,true):btn('Review','coverage')}</div>`;
    const content=$('#page-content');
    if(state.menu==='Overview')content.innerHTML=overview();
    else if(state.menu==='Settings')content.innerHTML=settings();
    else content.innerHTML=listing();
    renderLayers();
  }
  function overview(){
    const people=scoped(db.employees),queue=pending();
    if(state.tab==='Reports'){
      const units=db.units.filter(u=>canEmployer()?state.unit==='all'||state.unit===u.id:u.id===actor().unit);
      return tabs()+section('Workforce',tableView(['Unit','Active','Joining','Open requests'],units.map(u=>({id:people.find(e=>e.unit===u.id)?.id,cells:[u.name,String(people.filter(e=>e.unit===u.id&&e.status==='Active').length),String(people.filter(e=>e.unit===u.id&&e.status==='Joining').length),String(queue.filter(r=>r.unit===u.id).length)]}))))+section('Payroll',related(records('payroll',true),'No payroll for this period.'));
    }
    const expiring=people.filter(e=>e.contractEnd&&e.contractEnd<='2026-11-16'&&e.status==='Active');
    const need=records('lifecycle').filter(r=>r.status==='Pending');
    const owing=records('claim').filter(r=>r.status==='Approved'&&r.finance!=='Paid');
    return kpis([['Employees',people.filter(e=>e.status==='Active').length],['Awaiting review',queue.length],['Contracts ending',expiring.length,expiring.length>0],['Approved claims',cash(owing.reduce((n,r)=>n+r.amount,0))]])+tabs()+`<div class="overview-columns"><section><h2 class="section-heading">Awaiting review<span>${queue.length}</span></h2>${queue.length?queue.map(r=>`<button class="attention" data-action="open" data-id="${r.id}"><span></span><span><strong>${esc(r.type==='payroll'?r.title:employee(r.employee)?.name||r.title)}</strong><small>${esc(r.title)} · ${unit(r.unit)}</small></span><span class="due">${status(r.status)}</span></button>`).join(''):'<p class="empty">Nothing is waiting for review.</p>'}</section><section><h2 class="section-heading">Needs attention</h2>${expiring.map(e=>`<button class="attention overdue" data-action="open" data-id="${e.id}"><span></span><span><strong>${esc(e.name)}</strong><small>Contract ends ${date(e.contractEnd)}</small></span><span class="due">›</span></button>`).join('')}${need.map(r=>`<button class="attention" data-action="open" data-id="${r.id}"><span></span><span><strong>${esc(r.title)}</strong><small>${r.tasks.filter(t=>!t.done).length} tasks remaining · ${date(r.date)}</small></span><span class="due">›</span></button>`).join('')}<div class="overview-section"><h2 class="section-heading">Continue working</h2>${[['Schedules','Roster'],['Attendance','Corrections'],['Payroll','Runs'],['Claims','Requests']].map(([m,t])=>`<button class="quick-row" data-action="go" data-menu="${m}" data-tab="${t}"><span>${m}</span><span>›</span></button>`).join('')}</div></section></div>`;
  }
  function rowsFor(){
    const m=state.menu,t=state.tab;
    if(m==='Employees'){if(t==='Directory')return scoped(db.employees);if(['Onboarding','Offboarding'].includes(t))return records('lifecycle').filter(r=>r.kind===t);return records(t==='Changes'?'change':'discipline');}
    if(m==='Schedules')return t==='Calendar'?periodRows([...records('roster'),...records('leave').filter(x=>x.status==='Approved')]).sort((a,b)=>(a.date||a.start).localeCompare(b.date||b.start)):records(t==='Roster'?'roster':'swap',true);
    if(m==='Attendance'){if(t==='Leave'&&state.leaveView==='Balances')return scoped(db.employees);return records(({Records:'attendance',Corrections:'correction',Leave:'leave',Overtime:'overtime'})[t],true);}
    if(m==='Payroll'){if(t==='Adjustments')return records('adjustment',true);return records('payroll',true).filter(r=>t==='Payslips'?['Approved','Paid'].includes(r.status):true);}
    if(m==='Claims')return records('claim',true).filter(r=>t==='History'?['Rejected'].includes(r.status)||r.finance==='Paid':r.status!=='Rejected'&&r.finance!=='Paid');
    if(m==='Benefits')return records(t==='Balances'?'benefit':'benefitmovement',t==='History');
    if(m==='Loans')return records(t==='Loans'?'loan':'repayment');
    if(m==='Travel')return records(t==='Requests'?'travel':'settlement',true);
    return [];
  }
  function columnsFor(){
    const m=state.menu,t=state.tab;
    if(m==='Employees'&&t==='Directory')return ['Employee','Unit','Contract','Status'];
    if(m==='Attendance'&&t==='Leave'&&state.leaveView==='Balances')return ['Employee','Unit','Remaining','Status'];
    if(m==='Payroll')return t==='Adjustments'?['Employee','Adjustment','Amount','Status']:t==='Tax'?['Payroll','Gross','Base deductions','Status']:['Payroll','Employees','Net pay','Status'];
    if(m==='Benefits')return ['Employee',t==='Balances'?'Shopping balance':'Movement',t==='Balances'?'Balance':'Amount','Status'];
    if(m==='Loans')return t==='Loans'?['Employee','Principal','Outstanding','Status']:['Employee','Repayment','Amount','Status'];
    if(m==='Claims')return ['Employee','Claim','Amount','Status'];
    if(m==='Travel')return ['Employee',t==='Requests'?'Travel':'Settlement','Amount','Status'];
    if(m==='Attendance'&&t==='Leave')return ['Employee','Dates','Days','Status'];
    return ['Employee','Record','Date','Status'];
  }
  function cellsFor(r){
    const m=state.menu,t=state.tab,e=r.type==='employee'?r:employee(r.employee),who=`<span class="lead">${esc(e?.name||r.title)}</span><span class="sub">${esc(e?.code||unit(r.unit))}</span>`;
    if(r.type==='employee')return [who,unit(r.unit),m==='Attendance'?`${D.leaveBalance(r.id)} days`:`${r.contract}<span class="sub">${r.contractEnd?date(r.contractEnd):'Permanent'}</span>`,status(r.status)];
    if(r.type==='payroll')return [`<span class="lead">${esc(r.title)}</span><span class="sub">${esc(r.finance)}</span>`,t==='Tax'?cash(r.gross):String(r.employees.length),cash(t==='Tax'?r.baseDeductions:D.net(r)),status(r.status)];
    if(r.type==='benefit')return [who,'Shopping balance',cash(D.benefitBalance(r.employee)),status(r.status)];
    if(r.type==='loan')return [who,cash(r.amount),cash(r.outstanding),status(r.outstanding===0&&r.finance==='Paid'?'Paid':r.finance==='Paid'?'Active':r.status)];
    if(['claim','adjustment','benefitmovement','repayment','travel','settlement'].includes(r.type))return [who,`${esc(r.title)}<span class="sub">${r.type==='claim'?esc(r.finance):date(r.date)}</span>`,cash(r.amount),status(r.status)];
    if(r.type==='leave')return [who,`${date(r.start)}<span class="sub">to ${date(r.end)}</span>`,`${r.days} days`,status(r.status)];
    if(r.type==='roster'){const leave=D.leftOn(r.employee,r.date);return [who,`${esc(r.title)}<span class="sub">${r.start}–${r.end}</span>`,date(r.date),leave?status('Approved')+'<span class="sub">On leave</span>':status(r.status)];}
    if(r.type==='attendance')return [who,`${r.start}–${r.end}<span class="sub">${r.correction?'Corrected':'Clock records'}</span>`,date(r.date),status(r.status)];
    return [who,esc(r.title),date(r.date||r.start),status(r.status)];
  }
  function tableView(headers,rows){
    if(!rows.length)return '<div class="empty">No records match this view.</div>';
    return `<div class="ds-table-card"><div class="desktop-list"><table class="ds-table"><thead><tr>${headers.map((h,i)=>`<th ${['Amount','Net pay','Gross','Outstanding','Principal','Balance','Remaining','Days','Base deductions'].includes(h)?'class="right"':''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="open-row" ${row.id?`data-action="open" data-id="${esc(row.id)}" tabindex="0" role="button" aria-label="Open ${esc(row.label||D.title(D.get(row.id)))}"`:''}>${row.cells.map((v,i)=>`<td ${['Amount','Net pay','Gross','Outstanding','Principal','Balance','Remaining','Days','Base deductions'].includes(headers[i])?'class="right"':''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="phone-list">${rows.map(row=>`<button class="phone-record" data-action="open" data-id="${esc(row.id)}"><strong>${row.cells[0]}</strong><span class="sub">${row.cells[1]}</span><span class="phone-bottom"><span>${row.cells.at(-1)}</span><span>${row.cells[2]||''}</span></span></button>`).join('')}</div><div class="list-foot">${rows.length} ${rows.length===1?'record':'records'}</div></div>`;
  }
  function listing(){
    let rows=rowsFor();
    rows=rows.filter(r=>JSON.stringify([D.title(r),employee(r.employee)?.name,r.unit,r.status]).toLowerCase().includes(state.query.toLowerCase()));
    if(state.filter!=='All')rows=rows.filter(r=>r.status===state.filter);
    let figures='';
    if(state.menu==='Benefits')figures=kpis([['Shopping balance',cash(records('benefit').reduce((n,r)=>n+D.benefitBalance(r.employee),0))],['Employees',records('benefit').length]]);
    if(state.menu==='Loans')figures=kpis([['Outstanding',cash(records('loan').reduce((n,r)=>n+r.outstanding,0))],['Active loans',records('loan').filter(r=>r.outstanding>0).length]]);
    if(state.menu==='Payroll'&&state.tab==='Runs')figures=kpis([['Payrolls',rows.length],['Net pay',cash(rows.reduce((n,r)=>n+D.net(r),0))],['Ready for review',rows.filter(r=>!D.blockers(r).length&&r.status==='Draft').length]]);
    if(state.menu==='Claims')figures=kpis([['Awaiting approval',records('claim',true).filter(r=>r.status==='Pending').length],['Approved, unpaid',cash(records('claim',true).filter(r=>r.status==='Approved'&&r.finance!=='Paid').reduce((n,r)=>n+r.amount,0))]]);
    const subview=state.menu==='Attendance'&&state.tab==='Leave'?`<select aria-label="Leave view" data-change="leave-view"><option ${state.leaveView==='Requests'?'selected':''}>Requests</option><option ${state.leaveView==='Balances'?'selected':''}>Balances</option></select>`:'';
    const states=[...new Set(rowsFor().map(r=>r.status))];
    return figures+tabs()+`<div class="toolbar"><input class="ds-input" type="search" aria-label="Search this list" data-change="query" placeholder="Search ${state.menu.toLowerCase()}" value="${esc(state.query)}">${subview}<select class="ds-input" aria-label="Status" data-change="filter"><option>All</option>${states.map(s=>`<option ${state.filter===s?'selected':''}>${s}</option>`).join('')}</select><span class="end">${state.menu==='Travel'?'Proposed workflow':month(state.period)}</span></div>${state.menu==='Travel'?'<p class="notice">Local workflow proposal · Travel is not connected to the cloud.</p>':''}${state.menu==='Payroll'&&state.tab==='Tax'?'<p class="notice">Sample payroll figures only. Statutory PPh 21, BPJS and 1721-A1 calculations remain in the existing reporting process.</p>':''}`+tableView(columnsFor(),rows.map(r=>({id:r.id,label:D.title(r),cells:cellsFor(r)})));
  }
  function settings(){const groups=[...new Set(db.settings.map(x=>x.group))];return tabs()+`<div class="settings-grid">${groups.filter(g=>g===state.tab).map(g=>`<section class="settings-group"><h2>${g}</h2>${db.settings.filter(s=>s.group===g).map(s=>`<button class="quick-row" data-action="setting" data-id="${s.id}"><span>${esc(s.title)}<span class="sub ds-mute" style="display:block;margin-top:4px">${esc(s.value)}</span></span><span>›</span></button>`).join('')}</section>`).join('')}</div>`;}
  function eventHistory(id){const all=D.events.filter(e=>e.record===id);return `<details class="activity"><summary>Activity (${all.length})</summary>${all.length?all.map(e=>`<p>${esc(e.message)} · ${esc(e.by)} · ${date(e.on)}</p>`).join(''):'<p>Fictional opening record · 17 Oct 2026</p>'}</details>`;}
  function peopleFacts(r){return facts([['Employee',link(r.employee,employee(r.employee)?.name)],['Unit',esc(unit(r.unit))],['Date',date(r.date||r.start)],['Recorded by',esc(employee(r.filedBy)?.name||'Opening record')]]);}
  function financeSection(r){return section('Finance',facts([['Status',esc(r.finance||'Not sent')],['Reference',esc(r.financeRef||'—')]])+`<div style="margin-top:14px">${btn('Open Finance preview','finance-preview',`data-id="${r.id}"`)}</div>`);}
  function actionsFor(r){
    let actions=[],primary='';
    const decision=['leave','claim','correction','swap','change','travel','loan','settlement','overtime'].includes(r.type)&&r.status==='Pending'||r.type==='payroll'&&r.status==='Submitted';
    if(decision){actions.push(formBtn('Reject','decision',{id:r.id,action:'reject'}));primary=formBtn('Review','decision',{id:r.id,action:'approve'},true);}
    if(r.type==='payroll'&&r.status==='Draft')primary=btn('Send for approval','transition',`data-id="${r.id}" data-value="submit-payroll"`,true);
    if(r.type==='overtime'&&r.status==='Pending'&&r.consent==='Pending'){actions.push(formBtn('Record sample consent','consent',{id:r.id}));}
    if(r.type==='overtime'&&r.status==='Approved')primary=formBtn('Record actual time','realize',{id:r.id},true);
    if(['payroll','claim','loan','travel'].includes(r.type)&&r.status==='Approved'&&r.finance==='Not sent'&&canEmployer())primary=btn('Send to Finance','transition',`data-id="${r.id}" data-value="send-finance"`,true);
    if(r.type==='benefit'&&canEmployer())primary=formBtn('Adjust balance','benefit',{id:r.id,employee:r.employee},true);
    if(r.type==='loan'&&r.finance==='Paid'&&r.outstanding>0&&canEmployer())actions.push(formBtn('Sample repayment','repay',{id:r.id}));
    if(r.type==='lifecycle'&&r.status==='Pending'&&canEmployer())primary=btn('Complete checklist','transition',`data-id="${r.id}" data-value="close-lifecycle"`,true);
    if(r.type==='travel'&&r.status==='Approved'&&!D.by('settlement').some(x=>x.travel===r.id))actions.push(formBtn('Record settlement','settlement',{travel:r.id,employee:r.employee}));
    if(r.type==='employee'){
      actions.push(formBtn('Request leave','leave',{employee:r.id}));actions.push(formBtn('Record claim','claim',{employee:r.id}));
      if(canEmployer())primary=formBtn('Request change','change',{employee:r.id},true);
    }
    return (actions.length||primary?actions.join('')+primary:btn('Close','close'));
  }
  function detail(r){
    let body='';
    if(r.type==='employee'){
      body=kpis([['Leave remaining',D.leaveBalance(r.id)+' days'],...(canEmployer()?[['Shopping balance',cash(D.benefitBalance(r.id))],['Loan balance',cash(D.by('loan',r.id).reduce((n,x)=>n+x.outstanding,0))]]:[])])+section('Employment',facts([['Employee number',esc(r.code)],['Unit',esc(unit(r.unit))],['Position',esc(r.position)],['Grade',esc(r.grade)],['Joined',date(r.joined)],['Email',esc(r.email)]]))+section('Contract',facts([['Type',esc(r.contract)],['Ends',r.contractEnd?date(r.contractEnd):'Permanent']]),canEmployer()?formBtn('Record contract','contract',{employee:r.id}):'');
      const relations=[['Schedules',['roster'],'roster'],['Attendance',['attendance','correction','leave','overtime'],'leave'],['Claims',['claim'],'claim'],['Employment changes',['change'],'change'],['Checklists',['lifecycle'],'lifecycle']];
      if(canEmployer())relations.push(['Payroll',['adjustment'],'adjustment'],['Benefits',['benefit','benefitmovement'],''],['Loans',['loan','repayment'],'loan'],['Discipline',['discipline'],'discipline']);
      for(const [title,types,form]of relations){let rows=db.records.filter(x=>types.includes(x.type)&&x.employee===r.id&&D.readable(x,actor()));if(title==='Payroll')rows=[...D.by('payroll').filter(x=>x.employees.includes(r.id)&&D.readable(x,actor())),...rows];body+=section(title,related(rows),form?formBtn(title==='Checklists'?'Start checklist':title==='Schedules'?'Record shift':title==='Attendance'?'Request leave':title==='Claims'?'Record claim':title==='Payroll'?'Record adjustment':title==='Loans'?'Request loan':'Record',form,{employee:r.id}):'');}
    }else if(r.type==='payroll'){
      const blockers=D.blockers(r),adjustments=D.adjustments(r);
      body=kpis([['Gross pay',cash(r.gross)],['Base deductions',cash(r.baseDeductions)],['Net pay',cash(D.net(r))]])+section('Payroll',facts([['Unit',esc(unit(r.unit))],['Period',month(r.period)],['Prepared by',esc(employee(r.filedBy)?.name)],['Employees',String(r.employees.length)]]))+section('Readiness',blockers.length?related(blockers):'<p class="blank-section">No pending leave, correction or overtime decision in this sample payroll.</p>')+section('Employees',related(r.employees.map(employee)))+section('Adjustments',related(adjustments),r.status==='Draft'?formBtn('Record adjustment','adjustment',{run:r.id,employee:r.employees[0]}):'')+financeSection(r);
    }else if(r.type==='benefit'){
      body=kpis([['Shopping balance',cash(D.benefitBalance(r.employee))]])+peopleFacts(r)+section('Movements',related(D.by('benefitmovement',r.employee)))+section('Account',facts([['Use','Employee purchases at the store'],['Payroll impact','None'],['Claim allowance','Separate reimbursement limit']]));
    }else if(r.type==='loan'){
      body=kpis([['Principal',cash(r.amount)],['Outstanding',cash(r.outstanding)],['Monthly instalment',cash(r.instalment)]])+peopleFacts(r)+section('Repayments',related(D.by('repayment',r.employee).filter(x=>x.loan===r.id)))+section('Payroll deductions',related(D.by('adjustment',r.employee).filter(x=>x.loan===r.id)))+financeSection(r);
    }else if(r.type==='lifecycle'){
      body=peopleFacts(r)+kpis([['Completed',`${r.tasks.filter(t=>t.done).length} / ${r.tasks.length}`],['Effective date',date(r.date)]])+section('Checklist',`<div>${r.tasks.map((t,i)=>`<div class="checklist-row"><span><strong style="font-weight:500">${esc(t.name)}</strong><small>${esc(t.owner)}${t.reference?' · '+esc(t.reference):''}</small></span>${t.done?status('Completed'):formBtn('Record completion','task',{id:r.id,index:i})}</div>`).join('')}</div>`)+section('Related work',related(D.by('loan',r.employee).filter(x=>D.readable(x,actor()))))+`<p class="notice">Task evidence is simulated locally. Equipment return and account closure do not change GA or System records.</p>`;
    }else{
      body=peopleFacts(r);
      if(r.amount!==undefined)body=kpis([[r.type==='claim'?'Claim amount':r.type==='travel'?'Requested advance':r.type==='settlement'?'Actual expenses':'Amount',cash(r.amount)],...(r.type==='settlement'?[['Advance paid',cash(r.advance)],['Balance',cash(r.amount-r.advance)]]:[])])+body;
      if(r.type==='leave')body+=section('Leave',facts([['Type','Annual leave'],['From',date(r.start)],['To',date(r.end)],['Working days',String(r.days)],['Remaining balance',`${D.leaveBalance(r.employee)} days`]]));
      if(['roster','attendance','correction'].includes(r.type))body+=section(r.type==='roster'?'Shift':'Clock records',facts([['Starts',esc(r.start)],['Ends',esc(r.end)],['Leave',D.leftOn(r.employee,r.date)?link(D.leftOn(r.employee,r.date).id,'Approved leave'):'No approved leave']]));
      if(r.type==='overtime')body+=section('Overtime',facts([['Planned',`${r.minutes} minutes`],['Employee consent',esc(r.consent)],['Actual',r.actualMinutes?`${r.actualMinutes} minutes`:'Not recorded'],['Consent evidence',esc(r.consentRef||'—')]]));
      if(r.type==='swap')body+=section('Swap',facts([['Other employee',link(r.other,employee(r.other)?.name)],['Other employee consent',esc(r.consent)],['Source','Both published shifts must exist before approval']]));
      if(r.type==='claim'){
        const claimed=D.by('claim',r.employee).filter(x=>x.status==='Approved'&&x.category==='Medical'&&x.date.startsWith(r.date.slice(0,4))).reduce((n,x)=>n+x.amount,0);
        body+=section('Claim',facts([['Category',esc(r.category)],['Receipt reference',esc(r.evidence)],['Medical limit / year',cash(D.get('claim-policy').amount)],['Approved medical claims',cash(claimed)]]));
      }
      if(r.type==='travel')body+=section('Travel',facts([['Destination',esc(r.destination)],['From',date(r.start)],['To',date(r.end)],['Advance paid',cash(r.advancePaid)]])+related(D.by('settlement').filter(x=>x.travel===r.id)))+section('Related claims',related(D.by('claim',r.employee).filter(x=>x.travel===r.id)),formBtn('Record linked claim','claim',{employee:r.employee,travel:r.id}));
      if(r.type==='settlement')body+=section('Travel',link(r.travel,D.get(r.travel)?.title))+section('Settlement',facts([['Evidence',esc(r.reference)],['Direction',r.amount>=r.advance?'Company owes employee':'Employee returns unused advance'],['Finance','Review settlement before any reimbursement or return']]));
      if(r.type==='adjustment')body+=section('Adjustment',facts([['Kind',esc(r.kind)],['Period',month(r.period)],['Loan',r.loan?link(r.loan,'Employee loan'):'—'],['Applied',r.status==='Applied'?'Paid payroll':'Awaiting payroll payment']]));
      if(r.type==='repayment')body+=section('Repayment',facts([['Loan',link(r.loan,'Employee loan')],['Payroll',r.payroll?link(r.payroll,D.get(r.payroll)?.title):'Direct repayment'],['Reference',esc(r.reference)]]));
      if(r.type==='benefitmovement')body+=section('Shopping balance',facts([['Current balance',cash(D.benefitBalance(r.employee))],['Reference',esc(r.reference)],['Payroll impact','None']]));
      if(r.type==='change')body+=section('Proposed change',facts([['Field',esc(r.field)],['New value',esc(r.value)],['Effective date',date(r.date)]]));
      if(r.type==='discipline')body+=section('Discipline',facts([['Expires',date(r.expires)]]));
      if(r.finance!==undefined)body+=financeSection(r);
      if(r.reason)body+=section('Reason',`<p>${esc(r.reason)}</p>`);
      if(r.decision)body+=section('Decision',`<p>${esc(r.decision)} · ${esc(employee(r.decidedBy)?.name)}</p>`);
    }
    return body+eventHistory(r.id);
  }
  function renderLayers(){
    const root=$('#layers');const old=[...root.querySelectorAll('.sheet-body')].map(x=>x.scrollTop);const focusName=document.activeElement?.name;
    root.hidden=!state.stack.length;$('#workspace').inert=Boolean(state.stack.length);$('.review-bar').inert=Boolean(state.stack.length);document.body.style.overflow=state.stack.length?'hidden':'';
    root.innerHTML=state.stack.length?`<div class="veil" data-action="close"></div>`+state.stack.map((layer,i)=>{
      const top=i===state.stack.length-1;let title='',crumb='',body='',footer='',caption='',stat='';
      if(layer.kind==='record'){
        const r=D.get(layer.id);if(!D.readable(r,actor()))return '';title=D.title(r);crumb=typeMenu[r.type]||'HR';stat=status(r.status,true);caption=r.type==='employee'?`${r.code} · ${unit(r.unit)}`:r.proposed?'Proposed workflow · Local sample':`${date(r.date||r.start)} · ${unit(r.unit)}`;body=detail(r);footer=actionsFor(r);
      }else if(layer.kind==='form'){
        const def=formDefinition(layer);title=def.title;crumb=layer.context.id?D.title(D.get(layer.context.id)):'HR';body=formBody(layer,def);footer=`${btn('Cancel','close','',false).replace('ds-btn--quiet','ds-btn--destructive')}<button class="ds-btn ds-btn--primary" type="submit" form="active-form">${esc(def.submit||'Save')}</button>`;
      }else if(layer.kind==='coverage'){title='HR coverage';crumb='Prototype review';body=coverage();footer=btn('Close','close');}
      else if(layer.kind==='finance'){
        const r=D.get(layer.source);title='Finance preview';crumb=D.title(r);caption='Sample feedback · No posting or payment';
        body=kpis([['Amount',cash(r.type==='payroll'?D.net(r):r.amount)]])+facts([['HR source',link(r.id,D.title(r))],['Finance status',esc(r.finance)],['Reference',esc(r.financeRef||'—')],['Payment owner','Finance']])+`<p class="notice">This preview changes only fictional local status. It does not create a bill, BKK, bank transfer or journal.</p>`;
        footer=(r.finance==='Requested'&&canEmployer()?formBtn('Record sample payment','finance',{id:r.id},true):btn('Close','close'));
      }else if(layer.kind==='setting'){
        const s=D.get(layer.source);title=s.title;crumb=`Settings / ${s.group}`;body=facts([['Current value',esc(s.value)],['Scope','Central policy']])+section('Purpose',`<p>${esc(s.note)}</p>`);
        if(s.id==='invitations')body+=related(db.employees.filter(e=>e.status==='Joining'));
        if(s.id==='roles')body+=facts([['HR','Cross-unit HR review'],['Manager','Assigned-unit operations'],['Job title','Stored separately on Employees']]);
        body+='<p class="notice">Sample settings only. Access rules in this prototype are fixed; editing this description does not grant permissions.</p>';
        footer=['leave-policy','claim-policy'].includes(s.id)?formBtn('Edit sample policy','setting',{id:s.id},true):btn('Close','close');
      }else if(layer.kind==='search'){title='Search HR';crumb='Navigation & records';body=`<input class="ds-input" type="search" aria-label="Search HR records" data-change="global-search" placeholder="Employee, claim, loan or menu"><div id="search-results" class="search-results">${searchResults('')}</div>`;footer=btn('Close','close');}
      return `<section class="record-sheet ${!top?'under':''}" style="right:${state.phone?Math.max(0,(innerWidth-430)/2):12+(state.stack.length-i-1)*12}px" ${!top?'inert aria-hidden="true"':'role="dialog" aria-modal="true" aria-labelledby="sheet-title"'}><header class="sheet-head"><div><div class="sheet-crumb">${i?btn('‹ Back','close'):esc(crumb)}</div><div class="sheet-title"><h2 ${top?'id="sheet-title"':''}>${esc(title)}</h2>${stat}</div>${caption?`<div class="sheet-caption">${esc(caption)}</div>`:''}</div><button class="ds-btn ds-btn--icon" data-action="close" aria-label="Close sheet">×</button></header><div class="sheet-body">${body}</div><footer class="sheet-foot">${layer.error?`<p class="form-error" role="alert" style="flex-basis:100%">${esc(layer.error)}</p>`:''}${footer}</footer></section>`;
    }).join(''):'';
    [...root.querySelectorAll('.sheet-body')].forEach((el,i)=>el.scrollTop=old[i]||0);
    if(state.stack.length){const active=root.querySelector('.record-sheet:last-child');const target=active.querySelector(`[name="${CSS.escape(focusName||'__none')}”]`.replace('”','"'))||active.querySelector('input,select,textarea')||active.querySelector('[aria-label="Close sheet"]');target?.focus({preventScroll:true});}
  }
  function searchResults(query){const s=query.toLowerCase();return visibleMenus().filter(m=>m.toLowerCase().includes(s)).map(m=>`<button class="quick-row" data-action="nav" data-value="${m}"><span>${m}</span><span>Menu ›</span></button>`).join('')+scoped([...db.employees,...db.records]).filter(r=>`${D.title(r)} ${employee(r.employee)?.name||''}`.toLowerCase().includes(s)).map(r=>`<button class="related-row" data-action="search-open" data-id="${r.id}"><span><strong>${esc(D.title(r))}</strong><small>${esc(typeMenu[r.type]||'HR')} · ${esc(r.type==='employee'?unit(r.unit):employee(r.employee)?.name||unit(r.unit))}</small></span><span class="chev">›</span></button>`).join('');}
  function coverage(){
    const areas=[['Employees','Contract expiry, employment changes, onboarding, offboarding and discipline','Existing pages reorganized; sample connected detail'],['Schedules','Roster, team availability and shift swaps','Existing concepts; Calendar shows shifts and approved leave separately'],['Attendance','Clock records, corrections, leave balances, overtime consent and actuals','Existing concepts; local sample transitions'],['Payroll','Readiness, adjustments, review, Finance handover and paid feedback','Fixed sample amounts, not a statutory payroll engine'],['Claims','Receipt, review, yearly medical limit and payment status','Approval and payment are distinct'],['Benefits','Shopping balances, top-ups, spending and history','Separate from reimbursement allowances and payroll'],['Loans','Disbursement, outstanding, instalments and repayment history','Paid payroll applies its loan deduction once'],['Travel','Assignment, requested advance, linked claims and settlement','Proposed process, not a cloud feature'],['Settings','Organization, policies, access roles and lifecycle checklists','Representative settings; not every production form is recreated']];
    return '<p class="notice">Fictional data · No API calls · Changes reset on reload. Reviewer switching is a demo control, not production authorization.</p>'+areas.map(([title,scope,note])=>section(title,`<p>${esc(scope)}</p><p class="section-note">${esc(note)}</p>`)).join('')+section('Additional coverage to decide',`<div class="steps">${[['Travel','Needs an approved data/process design and Finance settlement integration.'],['Recruitment','Do not restore automatically: the repository records an earlier owner decision to remove the hiring menu. Some backend routes still exist.'],['Training & performance','Backend routes exist, but the current HR navigation has no dedicated screens. Confirm scope before adding menus.'],['Self-service','Keep employee requests and HR review on the same records, with different permissions.'],['Offboarding','GA equipment, account closure and Finance settlement need verified source completion in production.'],['Reports','Cross-unit attendance reporting needs an aggregate API; the sample is not proof of that endpoint.']].map(([name,n],i)=>`<div class="step"><span class="step-index">${i+1}</span><div><strong>${name}</strong><p>${n}</p></div></div>`).join('')}</div>`)+section('Related prototype',`<a class="ds-link" href="ga-asset-relations-prototype.html">Open GA workspace</a>`);
  }
  function options(items){return items.map(x=>typeof x==='string'?[x,x]:[x.id,x.name||x.title]);}
  function formDefinition(layer){
    const c=layer.context,v=layer.values||{},person=employee(v.employee||c.employee),available=scoped(db.employees).filter(e=>e.status!=='Terminated');
    const f=(name,label,type='text',choices=null,required=true,value='')=>({name,label,type,choices,required,value});
    const who=f('employee','Employee','select',options(available),true,c.employee||available[0]?.id),why=f('reason','Reason','textarea'),day=f('date','Date','date',null,true,db.today),amount=f('amount','Amount (Rp)','number');
    const target=c.id?D.get(c.id):null;
    const types={
      employee:{title:'New employee',fields:[f('name','Full name'),f('unit','Unit','select',options(db.units),true,state.unit==='all'?'ho':state.unit),f('position','Position'),f('contract','Contract','select',options(['PKWT','PKWTT'])),f('date','Joining date','date',null,true,db.today),f('end','Contract end','date',null,false),f('email','Email','email',null,false)]},
      leave:{title:'Request leave',submit:'Request leave',fields:[who,f('start','From','date',null,true,'2026-10-26'),f('end','To','date',null,true,'2026-10-26'),why]},
      claim:{title:'Record claim',fields:[who,f('title','Expense'),f('category','Category','select',options(['Transport','Medical','Meals','Other'])),day,amount,f('evidence','Receipt reference'),why]},
      loan:{title:'Request loan',submit:'Request loan',fields:[who,amount,f('instalment','Monthly instalment (Rp)','number'),day,why]},
      correction:{title:'Request correction',submit:'Request correction',fields:[who,day,f('start','Clock-in','time',null,true,'08:00'),f('end','Clock-out','time',null,true,'17:00'),why]},
      overtime:{title:'Order overtime',fields:[who,f('title','Work'),day,f('minutes','Planned minutes','number',null,true,120),why]},
      roster:{title:'Record shift',fields:[who,f('title','Shift','select',options(['Opening shift','Closing shift'])),day,f('start','Starts','time',null,true,'08:00'),f('end','Ends','time',null,true,'17:00')]},
      swap:{title:'Request swap',submit:'Request swap',fields:[who,f('other','Other employee','select',options(available)),day,why]},
      adjustment:{title:'Record adjustment',fields:[who,f('run','Payroll','select',options(records('payroll').filter(r=>r.status==='Draft')),true,c.run||records('payroll').find(r=>r.status==='Draft'&&r.unit===(person?.unit||available[0]?.unit))?.id),f('title','Description'),f('kind','Kind','select',options(['Earning','Deduction'])),amount,f('loan','Loan','select',options(records('loan').filter(r=>r.employee===(v.employee||c.employee||available[0]?.id)&&r.finance==='Paid'&&r.outstanding>0)),false),why]},
      payroll:{title:'New payroll',fields:[f('unit','Unit','select',options(db.units.filter(u=>canEmployer()||u.id===actor().unit)),true,state.unit==='all'?actor().unit:state.unit),f('period','Period','month',null,true,state.period)]},
      travel:{title:'Request travel',submit:'Request travel',fields:[who,f('title','Assignment'),f('destination','Destination'),f('start','From','date',null,true,'2026-10-27'),f('end','To','date',null,true,'2026-10-28'),f('amount','Requested advance (Rp)','number'),why]},
      settlement:{title:'Record settlement',fields:[f('amount','Actual expenses (Rp)','number'),f('evidence','Expense evidence reference'),why]},
      change:{title:'Request employment change',submit:'Request change',fields:[who,f('field','Field','select',options(['Grade','Position'])),f('value','New value'),f('date','Effective date','date',null,true,db.today),why]},
      discipline:{title:'Record warning',fields:[who,f('title','Warning'),day,f('end','Expires','date',null,true,'2027-04-17'),why]},
      lifecycle:{title:'Start checklist',fields:[who,f('kind','Checklist','select',options(['Onboarding','Offboarding']),true,c.kind||'Onboarding'),f('date','Effective date','date',null,true,db.today),why]},
      contract:{title:'Record contract',fields:[f('kind','Contract','select',options(['PKWT','PKWTT']),true,person?.contract||'PKWT'),f('date','Starts','date',null,true,db.today),f('end','Ends','date',null,false,person?.contractEnd||''),why]},
      decision:{title:c.action==='reject'?'Reject request':'Review request',submit:c.action==='reject'?'Reject':'Approve',fields:[f('reason','Decision reason','textarea')],intro:target?facts([['Record',link(target.id,D.title(target))],['Requester',esc(employee(target.filedBy)?.name||'—')],['Status',esc(target.status)]]):''},
      consent:{title:'Record sample consent',fields:[f('reference','Employee consent reference')]},
      realize:{title:'Record actual overtime',fields:[f('minutes','Actual minutes','number',null,true,target?.minutes||120),why]},
      finance:{title:'Sample Finance payment',submit:'Record sample payment',fields:[f('reference','Finance payment reference')],intro:'<p class="notice">Local status simulation only. No payment, bank transfer, BKK or journal is executed.</p>'},
      repay:{title:'Sample Finance repayment',fields:[amount,f('reference','Finance receipt reference')],intro:target?kpis([['Outstanding',cash(target.outstanding)]]):''},
      benefit:{title:'Adjust shopping balance',fields:[f('direction','Movement','select',options(['Top up','Deduct'])),amount,why],intro:target?kpis([['Current balance',cash(D.benefitBalance(target.employee))]]):''},
      task:{title:'Record checklist completion',fields:[f('reference','Completion evidence reference')],intro:target?facts([['Task',esc(target.tasks[c.index]?.name)],['Owner',esc(target.tasks[c.index]?.owner)]]):''},
      setting:{title:'Edit sample policy',fields:[f('amount',c.id==='leave-policy'?'Days per year':'Annual medical limit (Rp)','number',null,true,target?.amount)],intro:'<p class="notice">Sample policy only. Existing entitlements and historical claims are not recalculated.</p>'}
    };
    return types[layer.type];
  }
  function formBody(layer,def){
    return (def.intro||'')+`<form id="active-form" novalidate><div class="ds-fields">${def.fields.map(f=>{
      let val=layer.values[f.name]??f.value??'';
      if(f.type==='select'&&f.required&&!val&&f.choices?.length)val=f.choices[0][0];
      if(layer.values[f.name]===undefined)layer.values[f.name]=String(val);
      const attrs=`name="${f.name}" id="field-${f.name}" aria-required="${f.required}" ${f.required?'data-required="true"':''}`;
      return `<label class="ds-field" for="field-${f.name}"><span class="ds-field-label">${f.label}${f.required?' <span class="required">*</span>':''}</span>${f.type==='select'?`<select class="ds-input" ${attrs}>${!f.required?'<option value="">None</option>':''}${f.choices.map(([id,label])=>`<option value="${esc(id)}" ${String(val)===String(id)?'selected':''}>${esc(label)}</option>`).join('')}</select>`:f.type==='textarea'?`<textarea class="ds-input ds-input--area" ${attrs}>${esc(val)}</textarea>`:`<input class="ds-input" type="${f.type}" ${['number'].includes(f.type)?'min="1" step="1"':''} ${attrs} value="${esc(val)}">`}</label>`;
    }).join('')}</div></form>`;
  }
  function openForm(type,context={}){
    if(type==='loan'&&!canEmployer())return toast('Employee loans are managed by HR.');
    const layer={kind:'form',type,context,values:{},dirty:false,returnFocus:document.activeElement};state.stack.push(layer);renderLayers();
  }
  function commitForm(event){
    event.preventDefault();const layer=state.stack.at(-1);if(layer?.kind!=='form')return;
    const form=$('#active-form'),v=Object.fromEntries(new FormData(form));layer.values=v;layer.error='';
    const missing=[...form.querySelectorAll('[data-required]')].filter(el=>!el.value.trim());
    form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
    if(missing.length){missing.forEach(el=>el.setAttribute('aria-invalid','true'));layer.error='Complete the required fields.';renderLayers();$(`[name="${missing[0].name}"]`)?.focus();return;}
    try{
      let result;
      if(['decision','finance','repay','benefit','task','consent','realize'].includes(layer.type))result=D.transition(layer.context.id,layer.type==='decision'?layer.context.action:layer.type,{...v,index:layer.context.index},state.actor);
      else result=D.save(layer.type,v,state.actor,layer.context);
      layer.dirty=false;state.stack.pop();
      const underlying=state.stack.findLast(x=>x.kind==='record'&&x.id===result.id);
      if(!underlying&&result.type&&D.readable(result,actor()))state.stack.push({kind:'record',id:result.id});
      render();url();toast(layer.type==='decision'?(v.reason?'Decision recorded':'Saved'):'Saved in the local prototype');
    }catch(error){layer.error=error.message;renderLayers();}
  }
  document.addEventListener('submit',commitForm);
  document.addEventListener('input',event=>{
    const top=state.stack.at(-1);if(top?.kind==='form'&&event.target.name){top.values[event.target.name]=event.target.value;top.dirty=true;top.error='';}
    if(event.target.dataset.change==='query'){state.query=event.target.value;const position=event.target.selectionStart;$('#page-content').innerHTML=listing();const next=$('[data-change="query"]');next?.focus();next?.setSelectionRange(position,position);}
    if(event.target.dataset.change==='global-search')$('#search-results').innerHTML=searchResults(event.target.value);
  });
  document.addEventListener('change',event=>{
    const top=state.stack.at(-1);if(top?.kind==='form'&&event.target.name){top.values[event.target.name]=event.target.value;top.dirty=true;top.error='';if(top.type==='adjustment'&&event.target.name==='employee'){top.values.loan='';renderLayers();}return;}
    const key=event.target.dataset.change,value=event.target.value;if(!key||['query','global-search'].includes(key))return;
    guard(()=>{if(key==='actor'){state.actor=value;if(!canEmployer())state.unit=actor().unit;else state.unit='all';}else if(key==='mobile-tab')state.tab=value;else if(key==='leave-view')state.leaveView=value;else state[key]=value;state.stack=[];render();url();});
  });
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
    if(action==='nav')return navigate(el.dataset.value);
    if(action==='go')return navigate(el.dataset.menu,el.dataset.tab);
    if(action==='tab')return navigate(state.menu,el.dataset.value);
    if(action==='open')return open(el.dataset.id);
    if(action==='search-open'){state.stack.pop();return open(el.dataset.id);}
    if(action==='close')return close();
    if(action==='form')return openForm(el.dataset.type,JSON.parse(el.dataset.context||'{}'));
    if(action==='coverage')return special('coverage');
    if(action==='finance-preview')return special('finance',el.dataset.id);
    if(action==='setting')return special('setting',el.dataset.id);
    if(action==='search')return special('search');
    if(action==='menu')return $('#sidebar').classList.toggle('open');
    if(action==='example')return guard(()=>{state.actor='maya';state.unit='all';state.menu='Employees';state.tab='Directory';state.stack=[];render();open('dina');});
    if(action==='phone'){state.phone=!state.phone;document.body.classList.toggle('phone-preview',state.phone);el.textContent=state.phone?'Desktop preview':'Phone preview';return renderLayers();}
    if(action==='keep'){$('#confirm').close();guard.next=null;return;}
    if(action==='discard'){$('#confirm').close();const next=guard.next;guard.next=null;state.stack.forEach(x=>x.dirty=false);next?.();return;}
    if(action==='transition'){
      const layer=state.stack.at(-1);try{D.transition(el.dataset.id,el.dataset.value,{},state.actor);render();url();toast('Updated in the local prototype');}catch(error){layer.error=error.message;renderLayers();}return;
    }
  });
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!state.stack.some(x=>x.kind==='form'))special('search');return;}
    if($('#confirm').open)return;
    if(event.key==='Escape'){event.preventDefault();if(state.stack.length)close();else $('#sidebar').classList.remove('open');return;}
    if(event.key==='Enter'&&event.target.matches('tr[data-action]')){event.preventDefault();open(event.target.dataset.id);return;}
    if(event.key==='Tab'&&state.stack.length){const active=$('.record-sheet:last-child');const focus=[...active.querySelectorAll('button:not([disabled]),input,select,textarea,a[href],summary')].filter(el=>!el.closest('[inert]'));const first=focus[0],last=focus.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);guard(()=>{state.menu=menus[p.get('menu')]?p.get('menu'):'Overview';state.tab=menus[state.menu].includes(p.get('tab'))?p.get('tab'):menus[state.menu][0];state.stack=[];render();if(p.get('record'))open(p.get('record'));});});
  $('#confirm').addEventListener('cancel',()=>guard.next=null);
  render();if(q.get('record'))open(q.get('record'));url();
  window.HRPrototype={domain:D,state,menus};
})();
