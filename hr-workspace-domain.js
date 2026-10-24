/* Local state transitions only. This file never calls a server. */
(function(){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  function create(seed){
    const db=copy(seed), events=[];
    let sequence=100;
    const employee=id=>db.employees.find(x=>x.id===id);
    const get=id=>db.records.find(x=>x.id===id)||employee(id)||db.settings.find(x=>x.id===id);
    const actor=id=>db.actors[id];
    const readable=(r,a)=>Boolean(r&&a&&(a.employer||((r.unit===a.unit)&&!['benefit','benefitmovement','loan','repayment','discipline','change'].includes(r.type))));
    const scoped=(rows,a,unit='all')=>rows.filter(r=>readable(r,a)&&(unit==='all'||r.unit===unit));
    const by=(type,id)=>db.records.filter(r=>r.type===type&&(!id||r.employee===id));
    const leaveBalance=id=>(employee(id)?.leaveOpening||0)-by('leave',id).filter(r=>r.status==='Approved').reduce((n,r)=>n+r.days,0);
    const benefitBalance=id=>(employee(id)?.benefitOpening||0)+by('benefitmovement',id).reduce((n,r)=>n+r.amount,0);
    const adjustments=run=>(run.adjustments||[]).map(get).filter(Boolean);
    const net=run=>run.gross-run.baseDeductions+adjustments(run).reduce((n,r)=>n+(r.kind==='Earning'?r.amount:-r.amount),0);
    const blockers=run=>db.records.filter(r=>r.unit===run.unit&&(run.employees||[]).includes(r.employee)&&r.status==='Pending'&&['leave','correction','overtime'].includes(r.type)&&String(r.date||r.start).startsWith(run.period));
    const leftOn=(id,date)=>by('leave',id).find(r=>r.status==='Approved'&&date>=r.start&&date<=r.end);
    const title=r=>r.type==='employee'?r.name:r.title;
    function fail(message){throw Error(message);}
    function requireAccess(r,a){if(!readable(r,a))fail('This record is outside your demo role or unit.');}
    function employer(a){if(!a.employer)fail('This action belongs to HR. Switch to Maya in the review controls.');}
    function audit(r,a,message){events.push({record:r.id,by:a.name,message,on:db.today});}
    function add(type,values,a){const r={...values,type,id:`${type}-${++sequence}`,filedBy:a.employee};db.records.push(r);audit(r,a,'Recorded');return r;}
    function money(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)fail('Enter a positive whole-rupiah amount.');return n;}
    function dayRange(start,end){if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start)fail('Choose a valid date range.');let n=0;for(let d=new Date(start+'T00:00:00Z');d<=new Date(end+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){if(![0,6].includes(d.getUTCDay()))n++;if(n>365)fail('Choose a shorter date range.');}if(!n)fail('The sample calendar contains no working day in this range.');return n;}
    function review(r,a){requireAccess(r,a);if(r.filedBy===a.employee||r.employee===a.employee)fail('The requester cannot approve their own request.');if(['payroll','loan','change','travel'].includes(r.type))employer(a);}
    function transition(id,action,values,actorId){
      const r=get(id),a=actor(actorId);requireAccess(r,a);
      if(['approve','reject'].includes(action)){
        review(r,a);if(!values.reason?.trim())fail('Enter a decision reason.');
        if(r.status!=='Pending'&&!(r.type==='payroll'&&r.status==='Submitted'))fail('This record is no longer waiting for approval.');
        if(action==='approve'){
          if(r.type==='leave'&&r.days>leaveBalance(r.employee))fail('Not enough annual leave remains.');
          if(r.type==='leave'&&by('leave',r.employee).some(x=>x.id!==r.id&&x.status==='Approved'&&x.start<=r.end&&x.end>=r.start))fail('An approved leave request already covers these dates.');
          if(r.type==='payroll'&&blockers(r).length)fail('Resolve attendance and leave items before approving payroll.');
          if(r.type==='overtime'&&r.consent!=='Approved')fail('Employee consent is still pending. Record consent before approval.');
          if(r.type==='swap'&&r.consent!=='Approved')fail('The other employee must agree to the swap.');
          if(r.type==='claim'&&!r.evidence?.trim())fail('Attach a receipt reference before approval.');
          if(r.type==='claim'&&r.category==='Medical'){
            const limit=get('claim-policy').amount;
            const used=by('claim',r.employee).filter(x=>x.id!==r.id&&x.category==='Medical'&&x.status==='Approved'&&x.date.slice(0,4)===r.date.slice(0,4)).reduce((n,x)=>n+x.amount,0);
            if(used+r.amount>limit)fail('This request exceeds the sample annual medical limit.');
          }
          if(r.type==='change'){const e=employee(r.employee);if(r.field==='Grade')e.grade=r.value;else if(r.field==='Position')e.position=r.value;}
          if(r.type==='swap'){
            const first=by('roster',r.employee).find(x=>x.date===r.date),second=by('roster',r.other).find(x=>x.date===r.date);
            if(!first||!second)fail('Both employees need a published shift on this date.');
            if(leftOn(r.employee,r.date)||leftOn(r.other,r.date))fail('One employee is on approved leave.');
            const from={title:first.title,start:first.start,end:first.end};Object.assign(first,{title:second.title,start:second.start,end:second.end});Object.assign(second,from);
          }
          if(r.type==='correction'){
            let att=by('attendance',r.employee).find(x=>x.date===r.date);
            if(!att)att=add('attendance',{employee:r.employee,unit:r.unit,date:r.date,title:`Corrected attendance`,status:'Recorded'},a);
            Object.assign(att,{start:r.start,end:r.end,correction:r.id});
          }
        }
        r.status=action==='approve'?'Approved':'Rejected';r.decidedBy=a.employee;r.decision=values.reason.trim();audit(r,a,r.status);return r;
      }
      if(action==='submit-payroll'){
        if(r.type!=='payroll'||r.status!=='Draft')fail('Only a draft payroll can be sent for approval.');
        if(blockers(r).length)fail('Resolve the listed attendance, leave and overtime items first.');
        if(net(r)<0)fail('Deductions cannot exceed gross pay.');
        r.status='Submitted';r.filedBy=a.employee;audit(r,a,'Sent for approval');return r;
      }
      if(action==='consent'){
        if(r.type!=='overtime'||r.consent!=='Pending')fail('This order is not waiting for consent.');
        if(!values.reference?.trim())fail('Enter the employee consent evidence reference.');
        r.consent='Approved';r.consentRef=values.reference;audit(r,a,'Sample employee consent recorded');return r;
      }
      if(action==='realize'){
        if(r.type!=='overtime'||r.status!=='Approved')fail('Approve the overtime order first.');
        const actual=money(values.minutes);r.actualMinutes=actual;r.status='Completed';audit(r,a,'Actual overtime recorded');return r;
      }
      if(action==='send-finance'){
        employer(a);if(!['claim','loan','payroll','travel'].includes(r.type)||r.status!=='Approved')fail('Approve this record before sending it to Finance.');
        if(r.finance!=='Not sent')fail('This record already has a Finance request.');
        r.finance='Requested';r.financeRef=`FIN-${r.id.toUpperCase()}`;audit(r,a,'Requested Finance processing');return r;
      }
      if(action==='finance'){
        employer(a);if(r.finance!=='Requested')fail('A Finance request is required first.');
        if(!values.reference?.trim())fail('Enter a sample Finance reference.');
        if(r.type==='payroll'){
          for(const x of adjustments(r)){if(x.loan){const l=get(x.loan);if(l.finance!=='Paid'||x.amount>l.outstanding)fail('A loan deduction exceeds its current balance. Review payroll again.');}}
          for(const x of adjustments(r)){if(x.loan){const l=get(x.loan);l.outstanding-=x.amount;add('repayment',{employee:x.employee,unit:r.unit,loan:l.id,payroll:r.id,date:db.today,title:'Payroll deduction',amount:x.amount,status:'Recorded',reference:values.reference},a);}x.status='Applied';}
          r.status='Paid';
        }
        if(r.type==='loan')r.outstanding=r.amount;
        if(r.type==='travel')r.advancePaid=r.amount;
        r.finance='Paid';r.financeRef=values.reference;audit(r,a,'Sample Finance payment received');return r;
      }
      if(action==='repay'){
        employer(a);if(r.type!=='loan'||r.finance!=='Paid')fail('Only a disbursed loan can receive repayments.');
        const amount=money(values.amount);if(amount>r.outstanding)fail('Repayment exceeds the outstanding loan balance.');
        if(!values.reference?.trim())fail('Enter the sample Finance receipt reference.');
        r.outstanding-=amount;add('repayment',{employee:r.employee,unit:r.unit,loan:r.id,date:db.today,title:'Direct repayment',amount,status:'Recorded',reference:values.reference},a);audit(r,a,'Sample Finance repayment recorded');return r;
      }
      if(action==='benefit'){
        employer(a);const amount=money(values.amount)*(values.direction==='Deduct'?-1:1);
        if(benefitBalance(r.employee)+amount<0)fail('The shopping balance cannot become negative.');
        if(!values.reason?.trim())fail('Enter a balance adjustment reason.');
        add('benefitmovement',{employee:r.employee,unit:r.unit,title:values.direction==='Deduct'?'Balance deduction':'Balance top-up',date:db.today,amount,status:'Recorded',reference:values.reason},a);audit(r,a,'Shopping balance adjusted');return r;
      }
      if(action==='task'){
        if(r.type!=='lifecycle'||r.status==='Completed')fail('This checklist is closed.');
        if(!values.reference?.trim())fail('Enter a completion evidence reference.');
        const t=r.tasks[Number(values.index)];if(!t||t.done)fail('This task is already completed.');t.done=true;t.reference=values.reference;audit(r,a,`${t.name} completed`);return r;
      }
      if(action==='close-lifecycle'){
        employer(a);if(r.type!=='lifecycle'||r.status!=='Pending'||r.tasks.some(t=>!t.done))fail('Complete every checklist task first.');
        if(r.kind==='Offboarding'&&by('loan',r.employee).some(l=>l.outstanding>0))fail('Reconcile outstanding employee loans first.');
        if(r.date>db.today)fail(`The effective date is ${r.date}. Completion remains available from that date.`);
        r.status='Completed';employee(r.employee).status=r.kind==='Onboarding'?'Active':'Terminated';audit(r,a,`${r.kind} completed`);return r;
      }
      fail('This action is not available.');
    }
    function save(type,v,actorId,context={}){
      const a=actor(actorId), e=employee(v.employee||context.employee);
      if(e&&!readable(e,a))fail('Select an employee in your unit.');
      const common={employee:e?.id,unit:e?.unit||v.unit||a.unit,date:v.date||db.today,status:'Pending',reason:v.reason?.trim()||''};
      if(type==='employee'){
        employer(a);const id=`employee-${++sequence}`;const ep={id,type:'employee',name:v.name.trim(),code:`EMP-${sequence}`,unit:v.unit,position:v.position,grade:'G2',status:'Joining',joined:v.date,contract:v.contract,contractEnd:v.end||'',leaveOpening:0,benefitOpening:0,salary:0,email:v.email||''};db.employees.push(ep);audit(ep,a,'Employee registered');return ep;
      }
      if(type==='leave'){
        const days=dayRange(v.start,v.end);if(days>leaveBalance(e.id))fail('Requested days exceed the remaining annual leave.');
        if(by('leave',e.id).some(r=>['Pending','Approved'].includes(r.status)&&r.start<=v.end&&r.end>=v.start))fail('A pending or approved leave request already overlaps these dates.');
        return add(type,{...common,title:'Annual leave',start:v.start,end:v.end,days},a);
      }
      if(type==='claim')return add(type,{...common,title:v.title,category:v.category,amount:money(v.amount),evidence:v.evidence,finance:'Not sent',travel:context.travel},a);
      if(type==='loan')return add(type,{...common,title:'Employee loan',amount:money(v.amount),instalment:money(v.instalment),outstanding:0,finance:'Not sent'},a);
      if(type==='correction'){
        if(v.end<=v.start)fail('Clock-out must be later than clock-in in this sample.');
        return add(type,{...common,title:'Attendance correction',start:v.start,end:v.end},a);
      }
      if(type==='overtime')return add(type,{...common,title:v.title,minutes:money(v.minutes),consent:'Pending'},a);
      if(type==='roster'){
        if(leftOn(e.id,v.date))fail('This employee is on approved leave on that date.');
        if(by('roster',e.id).some(x=>x.date===v.date))fail('A shift already exists for this employee and date.');
        if(v.end<=v.start)fail('End time must be later than start time in this sample.');
        return add(type,{...common,title:v.title,start:v.start,end:v.end,status:'Published'},a);
      }
      if(type==='swap'){
        const other=employee(v.other);if(!other||other.unit!==e.unit||other.id===e.id)fail('Choose a different employee in the same unit.');
        return add(type,{...common,title:'Shift swap',other:other.id,consent:'Pending'},a);
      }
      if(type==='adjustment'){
        const run=get(v.run);requireAccess(run,a);if(run.type!=='payroll'||run.status!=='Draft')fail('Choose a draft payroll.');
        if(run.unit!==e.unit||!run.employees.includes(e.id))fail('The employee must belong to this payroll.');
        const amount=money(v.amount),loan=v.loan?get(v.loan):null;
        if(loan&&(loan.employee!==e.id||loan.finance!=='Paid'||v.kind!=='Deduction'||amount>loan.outstanding))fail('Select a disbursed loan for this employee and a deduction within its balance.');
        if(loan&&adjustments(run).some(x=>x.loan===loan.id))fail('This payroll already contains an instalment for that loan.');
        const r=add(type,{...common,title:v.title,amount,kind:v.kind,loan:loan?.id,period:run.period,status:'Filed'},a);run.adjustments.push(r.id);return r;
      }
      if(type==='payroll'){
        const unit=v.unit;if(!a.employer&&unit!==a.unit)fail('Choose your assigned unit.');
        if(db.records.some(r=>r.type==='payroll'&&r.unit===unit&&r.period===v.period))fail('A payroll already exists for this unit and period.');
        const people=db.employees.filter(x=>x.unit===unit&&x.status==='Active');if(!people.length)fail('This unit has no active employees.');
        return add(type,{unit,title:`${db.units.find(u=>u.id===unit).name} · ${v.period}`,period:v.period,date:db.today,employees:people.map(x=>x.id),gross:people.reduce((n,x)=>n+x.salary,0),baseDeductions:0,status:'Draft',finance:'Not sent',adjustments:[]},a);
      }
      if(type==='travel'){
        dayRange(v.start,v.end);return add(type,{...common,title:v.title,start:v.start,end:v.end,date:v.start,destination:v.destination,amount:money(v.amount),advancePaid:0,finance:'Not sent',proposed:true},a);
      }
      if(type==='settlement'){
        const trip=get(context.travel);requireAccess(trip,a);if(trip.status!=='Approved')fail('Approve the trip first.');
        if(by('settlement').some(x=>x.travel===trip.id))fail('This trip already has an expense settlement.');
        return add(type,{employee:trip.employee,unit:trip.unit,title:'Travel expense settlement',travel:trip.id,date:db.today,amount:money(v.amount),advance:trip.advancePaid,reference:v.evidence,status:'Pending',reason:v.reason,proposed:true},a);
      }
      if(type==='change'){employer(a);return add(type,{...common,title:`${v.field} change`,field:v.field,value:v.value},a);}
      if(type==='discipline'){employer(a);return add(type,{...common,title:v.title,expires:v.end,status:'Active'},a);}
      if(type==='lifecycle'){
        employer(a);if(by('lifecycle',e.id).some(x=>x.kind===v.kind&&x.status==='Pending'))fail('An open checklist already exists.');
        const tasks=v.kind==='Onboarding'?['Signed contract','Account invitation','Equipment handover','First-week schedule']:['Resignation approval','Equipment return','Loan reconciliation','Final payroll review','Account closure'];
        return add(type,{...common,title:`${e.name} · ${v.kind}`,kind:v.kind,tasks:tasks.map((name,i)=>({name,owner:['HR','IT','GA','Manager','IT'][i],done:false}))},a);
      }
      if(type==='contract'){
        employer(a);if(v.kind==='PKWT'&&(!v.end||v.end<v.date))fail('A fixed-term contract needs a valid end date.');
        if(v.kind==='PKWTT'&&v.end)fail('A permanent contract has no end date.');
        Object.assign(e,{contract:v.kind,contractEnd:v.end||''});audit(e,a,'Employment contract updated');return e;
      }
      if(type==='setting'){
        employer(a);const setting=get(context.id);if(['leave-policy','claim-policy'].includes(setting.id)){setting.amount=money(v.amount);setting.value=setting.id==='leave-policy'?`${setting.amount} days / year`:`Medical · Rp ${setting.amount.toLocaleString('id-ID')} / year`;}
        else setting.value=v.value;events.push({record:setting.id,by:a.name,message:'Sample policy saved',on:db.today});return setting;
      }
      fail('This form has no save operation.');
    }
    return {db,events,employee,get,actor,readable,scoped,by,leaveBalance,benefitBalance,adjustments,net,blockers,leftOn,title,transition,save};
  }
  window.HRWorkspaceDomain={create};
})();
