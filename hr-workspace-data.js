/* Fictional local prototype. No employee data or production API calls. */
window.HRWorkspaceSeed = {
  today:'2026-10-17', period:'2026-10',
  actors:{maya:{name:'Maya Kusuma',employee:'maya',unit:'ho',employer:true},budi:{name:'Budi Santoso',employee:'budi',unit:'bandung',employer:false}},
  units:[{id:'ho',name:'Head Office'},{id:'bandung',name:'Bandung'}],
  employees:[
    {id:'dina',type:'employee',name:'Dina Putri',code:'EMP-0042',unit:'bandung',position:'Sales associate',grade:'G2',status:'Active',joined:'2024-03-01',email:'dina@example.test',contract:'PKWT',contractEnd:'2026-11-05',leaveOpening:12,benefitOpening:500000,salary:5200000},
    {id:'arif',type:'employee',name:'Arif Rahman',code:'EMP-0038',unit:'bandung',position:'Stock associate',grade:'G2',status:'Active',joined:'2023-09-01',email:'arif@example.test',contract:'PKWTT',contractEnd:'',leaveOpening:10,benefitOpening:300000,salary:5000000},
    {id:'budi',type:'employee',name:'Budi Santoso',code:'EMP-0018',unit:'bandung',position:'Store manager',grade:'G4',status:'Active',joined:'2022-02-01',email:'budi@example.test',contract:'PKWTT',contractEnd:'',leaveOpening:12,benefitOpening:500000,salary:8000000},
    {id:'maya',type:'employee',name:'Maya Kusuma',code:'EMP-0007',unit:'ho',position:'HR manager',grade:'G4',status:'Active',joined:'2021-05-01',email:'maya@example.test',contract:'PKWTT',contractEnd:'',leaveOpening:12,benefitOpening:500000,salary:9000000},
    {id:'nabila',type:'employee',name:'Nabila Sari',code:'EMP-0076',unit:'ho',position:'Payroll officer',grade:'G3',status:'Joining',joined:'2026-10-26',email:'nabila@example.test',contract:'PKWT',contractEnd:'2027-10-25',leaveOpening:0,benefitOpening:0,salary:6000000}
  ],
  records:[
    {id:'lv-dina',type:'leave',employee:'dina',unit:'bandung',title:'Annual leave',start:'2026-10-19',end:'2026-10-20',days:2,status:'Pending',reason:'Family appointment',filedBy:'dina'},
    {id:'lv-arif',type:'leave',employee:'arif',unit:'bandung',title:'Annual leave',start:'2026-10-22',end:'2026-10-22',days:1,status:'Approved',reason:'Personal appointment',filedBy:'arif'},
    {id:'at-dina',type:'attendance',employee:'dina',unit:'bandung',title:'Attendance · 16 Oct 2026',date:'2026-10-16',start:'08:02',end:'17:01',status:'Recorded'},
    {id:'co-dina',type:'correction',employee:'dina',unit:'bandung',title:'Missing clock-out',date:'2026-10-15',start:'08:00',end:'17:00',status:'Pending',reason:'Device was offline at clock-out',filedBy:'dina'},
    {id:'ot-arif',type:'overtime',employee:'arif',unit:'bandung',title:'Stockroom preparation',date:'2026-10-21',minutes:120,status:'Pending',reason:'Prepare seasonal stock',filedBy:'budi',consent:'Pending'},
    {id:'ro-dina',type:'roster',employee:'dina',unit:'bandung',title:'Opening shift',date:'2026-10-19',start:'08:00',end:'17:00',status:'Published'},
    {id:'ro-arif',type:'roster',employee:'arif',unit:'bandung',title:'Closing shift',date:'2026-10-19',start:'12:00',end:'21:00',status:'Published'},
    {id:'sw-dina',type:'swap',employee:'dina',other:'arif',unit:'bandung',title:'Shift swap',date:'2026-10-23',status:'Pending',reason:'Family appointment',filedBy:'dina',consent:'Approved',fromShift:'Opening',toShift:'Closing'},
    {id:'cl-dina',type:'claim',employee:'dina',unit:'bandung',title:'Store visit transport',category:'Transport',date:'2026-10-14',amount:350000,status:'Pending',finance:'Not sent',evidence:'Transport receipt · 14 Oct 2026',reason:'Visit Bandung supplier showroom',filedBy:'dina'},
    {id:'cl-arif',type:'claim',employee:'arif',unit:'bandung',title:'Approved medical claim',category:'Medical',date:'2026-10-10',amount:250000,status:'Approved',finance:'Requested',evidence:'Clinic receipt · 10 Oct 2026',reason:'Eligible medical reimbursement',filedBy:'arif'},
    {id:'lo-dina',type:'loan',employee:'dina',unit:'bandung',title:'Employee loan',date:'2026-08-01',amount:2000000,outstanding:1200000,instalment:300000,status:'Approved',finance:'Paid',financeRef:'BKK-2026-0811',filedBy:'dina',reason:'Personal emergency'},
    {id:'re-dina',type:'repayment',employee:'dina',unit:'bandung',title:'Previous repayments',loan:'lo-dina',date:'2026-09-30',amount:800000,status:'Recorded',reference:'Payroll Aug–Sep 2026'},
    {id:'ad-dina',type:'adjustment',employee:'dina',unit:'bandung',title:'Loan instalment',period:'2026-10',date:'2026-10-17',amount:300000,kind:'Deduction',loan:'lo-dina',status:'Filed',filedBy:'budi',reason:'October instalment'},
    {id:'pr-oct',type:'payroll',unit:'bandung',title:'Bandung · October 2026',period:'2026-10',date:'2026-10-31',employees:['dina','arif'],gross:10200000,baseDeductions:200000,status:'Draft',finance:'Not sent',filedBy:'budi',adjustments:['ad-dina']},
    {id:'pr-ho',type:'payroll',unit:'ho',title:'Head Office · October 2026',period:'2026-10',date:'2026-10-31',employees:['maya'],gross:9000000,baseDeductions:150000,status:'Draft',finance:'Not sent',filedBy:'maya',adjustments:[]},
    {id:'be-dina',type:'benefit',employee:'dina',unit:'bandung',title:'Shopping balance',amount:500000,status:'Active'},
    {id:'bm-dina',type:'benefitmovement',employee:'dina',unit:'bandung',title:'Store purchase',date:'2026-10-11',amount:-125000,status:'Recorded',reference:'POS-2026-1011-0042'},
    {id:'be-arif',type:'benefit',employee:'arif',unit:'bandung',title:'Shopping balance',amount:300000,status:'Active'},
    {id:'be-maya',type:'benefit',employee:'maya',unit:'ho',title:'Shopping balance',amount:500000,status:'Active'},
    {id:'lc-nabila',type:'lifecycle',employee:'nabila',unit:'ho',title:'Nabila Sari · Onboarding',kind:'Onboarding',date:'2026-10-26',status:'Pending',tasks:[{name:'Signed employment contract',owner:'HR',done:true},{name:'Account invitation',owner:'IT',done:false},{name:'Equipment handover',owner:'GA',done:false},{name:'First-week schedule',owner:'Manager',done:false}]},
    {id:'lc-arif',type:'lifecycle',employee:'arif',unit:'bandung',title:'Arif Rahman · Offboarding',kind:'Offboarding',date:'2026-10-30',status:'Pending',tasks:[{name:'Resignation approval',owner:'HR',done:true},{name:'Return company equipment',owner:'GA',done:false},{name:'Loan reconciliation',owner:'Finance',done:true},{name:'Final payroll review',owner:'HR',done:false},{name:'Account closure scheduled',owner:'IT',done:false}]},
    {id:'ch-dina',type:'change',employee:'dina',unit:'bandung',title:'Grade review',date:'2026-11-01',field:'Grade',value:'G3',status:'Pending',filedBy:'budi',reason:'Completed senior associate assessment'},
    {id:'di-arif',type:'discipline',employee:'arif',unit:'bandung',title:'Written warning',date:'2026-09-01',expires:'2027-02-28',status:'Active',reason:'Repeated lateness',filedBy:'maya'},
    {id:'tr-dina',type:'travel',employee:'dina',unit:'bandung',title:'Supplier visit · Jakarta',start:'2026-10-27',end:'2026-10-28',date:'2026-10-27',destination:'Jakarta',amount:800000,advancePaid:0,status:'Pending',finance:'Not sent',filedBy:'budi',reason:'Review supplier samples',proposed:true}
  ],
  settings:[
    {id:'organization',group:'Organization',title:'Organization',value:'Head Office · Bandung',note:'Company, units, departments and grades'},
    {id:'shifts',group:'Attendance',title:'Shifts',value:'Opening · Closing',note:'Shift times and breaks'},
    {id:'leave-policy',group:'Attendance',title:'Leave',value:'12 days / year',note:'Annual leave entitlement',amount:12},
    {id:'overtime-policy',group:'Attendance',title:'Overtime',value:'Employee consent required',note:'Consent and recorded actual time'},
    {id:'payroll-policy',group:'Payroll',title:'Payroll',value:'Monthly · last calendar day',note:'Schedule, components and payslips'},
    {id:'rates',group:'Payroll',title:'Tax & BPJS',value:'Central parameters',note:'Existing rates and reporting'},
    {id:'claim-policy',group:'Claims',title:'Claim limits',value:'Medical · Rp 2.000.000 / year',amount:2000000,note:'Reimbursement limits; separate from shopping balance'},
    {id:'benefit-policy',group:'Benefits',title:'Shopping balance',value:'Enabled · carries over',note:'Balance movements; separate from payroll and claim limits'},
    {id:'roles',group:'Access',title:'Roles',value:'HR · Manager · Employee',note:'Application permissions, not job titles'},
    {id:'invitations',group:'Access',title:'Invitations',value:'1 pending',note:'Account invitations linked to employees'},
    {id:'delegation',group:'Access',title:'Delegation',value:'Approval mandates',note:'Dated approval delegation'},
    {id:'checklists',group:'Workflows',title:'Checklists',value:'Onboarding · Offboarding',note:'Tasks and responsible teams'}
  ]
};
