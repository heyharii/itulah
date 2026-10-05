from pathlib import Path
import json,re
root=Path(__file__).parent
# Each line: group|page|columns|draft fields|filters|tabs|primary action
registry='''
Employees|Employee list|Employee name,Employee ID,NIK,Branch,Organization,Job position,Job level,Employment status,Grade,Class,Join date,End date,Sign date,Resign date,Barcode,Email,Birth date,Birth place,Address,Phone number,Religion,Gender,Marital status|Full name!,Email!,Join date,Employment status,Branch,Organization,Job position|Status,Employment status,Branch,Organization,Job position,Job level,SBU|Directory,Org chart|Add employee
Employees|Employee transfer|Transaction ID,Employee name,Employee ID,Transfer type,Created date,Effective date,Status,Attachment|Employees!,Effective date!,Transfer type!,Group structure,Employment status,Branch,Organization,Job position,Job level,Grade,Class,Cost Center,Cost Center Category,Approval line,Manager,Custom field,Field option,SBU Group,SBU,Attachment,Document template,Reason,Email manager?,Email employee?|Status,Effective date,Transfer type,Branch from,Branch to,Organization from,Organization to,Job position from,Job position to,Job level from,Job level to,Employment status from,Employment status to,SBU from,SBU to||Create transfer
Employees|Mass resignation|Employee name,Resign date,Resign reason,Merit pay,Severance,Compensation pay,Timeoff balance,Amount per day,Timeoff compensation,Payroll period,New approval line,Document template,Enable offboarding,Restrict employee,Notes,Assets,Loan|Employees!,Resign date!,Resign reason!,Payroll period,Enable offboarding?,Restrict employee?,Notes|||Select employee
Employees|Import/export prorate|Employee ID,Employee name|Employees!,Select all employees?,Attachment!|||Import prorate
Employees|PTKP status adjustment|Period,Employee Adjusted|Period!,Employees!,Current PTKP Status,New PTKP Status,Attachment|||Create adjustment
Employees|Manpower planning|Job position,Employment status,Period,Status|Period!,Notes,Job position!,Employment status!|Period,Status,Job position|Overview,Planning history,Requisition|Manage planning
Employees|New joiner submission|Submission ID,Delivery date,Expiry date,Email,Status,Sent by|Employee name!,Email!,Phone number,Additional phone number,Place of birth,Birthdate,Gender,Marital status,Blood type,Religion,NIK,Passport number,Passport expiry date,Postal code,Citizen ID address,Residential address,Bank name,Account number,Account holder name,PTKP status,Formal education,Informal education,Work experience,Additional document|Status||Send form link
Employees|Onboarding|Employee name,Job position,Status|Name,Job position,Work location,Instruction|Month,Year|On Progress,Completed|
Employees|Offboarding|Employee name,Resign Date,Status,Last updated,Task progress||Status,Branch||Settings
Employees|Reprimand|Employee name,Reprimand type,Effective date,End date,Status|Assign to!,Reprimand type!,Effective date!,End date,Notes,Watchers,Attachment,Document template|Assigned to,Status,Reprimand type,Organization,Period||Create reprimand
Recruitment|Overview|||||
Recruitment|Job listings|Job listing title,Job position,Organization,Candidates,Publication status,Platform,Publication date,Duration,Created date,Hiring team|Job position!,Job listing title!,Branch!,Province,City,Organization,Team,Employment type,Workplace type,Headcount,Salary range,Salary description,Description,Requirements,Benefits,Job summary,Education,Experience level,Minimum experience,Gender,Age range,Application form,Hiring stage,Hiring team,Publication setting|Branch,Organization,Employment status,Workplace type,Publication date,Closing date,Platform,Creator,Hiring team|Published,Draft,Unpublished,Closed|Create job listing
Recruitment|Candidates|Candidate name,Applied position,Applied date,Last updated,Candidate score AI,Source,MBTI assessment status,Email address,Phone number,Education,Hiring team|Applied job position!,Candidate name!,Email address|Job positions,Branch,Organization,Team,Applied date,Education,Latest job position,Age,Gender,Restriction status,Hiring team,Source|New candidates,Screening,Assessments,Interviews,Job offer,Hired,Rejected,Archived,Spam,Blocked|Add candidate
Recruitment|Calendar||||My interviews,All interview schedules,Expired offers,New joiners||
Recruitment|Activity log|Date,User,Activity,Page||Date range,User,Page||
Recruitment|Time to hire report|Job listing,Job position,ID,Recruiter,Organization,Team,Branch,Publication,Hiring stages,Time to hire,Time to fill,Acceptance rate,Headcount,End date,Candidate total,Last hired||Job position,Posting period||
Recruitment|Talent pool|||||
Recruitment|Assessments|||||Library,Custom assessments|
Recruitment settings|Users|Name,Role,Restrictions,Status|Name!,Email!,Role,Restrictions|Role,Status||Invite user
Recruitment settings|Roles & permissions|Permission,Admin,Recruiter,User|Job listing?,Candidate?,Reports?,Settings?|||Edit permission
Recruitment settings|Hiring stages|Stage,Status|Screening?,Assessment?,Interview?,Job offer?,Final status?|||Edit stage
Recruitment settings|Email templates|Scenario,Status||||Create template
Recruitment settings|Restricted candidates|Candidate,Reason,Period|NIK!,Reason,Period|Date range||Add restricted candidate
Recruitment settings|Integrations|Integration,Status||||Connect
Recruitment settings|Career page||| ||Edit career page
Recruitment settings|Subscription||||||
Time|Time off requests|Employee name,Request ID,Requested date,Policy,Time off date,Status,Branch,Organization,Job level,Employment status,SBU|Employee name!,Time off policy!,Time off date!,Request type,Delegate approval during absence to,Reason,Attachment|Year,Status,Request date,Branch,Organization||Request time off
Time|Time off transaction|Transaction ID,Policy name,Type,Assign to,Last modified|Policy name!,Description,Employee selection!,Effective date,Expiration date|Policy,Type||Assign employees
Time|Balance history|Employee,Job Position,Branch,Beginning balance,Time off taken,Adjustment,Expired,Carry forward,Ending balance||Date range,Policy,Status,Branch,Organization,Job position,Job level|Overview balance,Log balance,Block leave|Add policy
Time|Roster leave||||||
Time|Attendance data|Employee name,Date,Shift,Schedule in,Schedule out,Clock in,Clock out,Attendance code,Time off code,Total overtime duration,Branch,Organization,Job level,Employment status,Shift code,Late in,Early out,Overtime before schedule in,Overtime after schedule out,Schedule working hours,Actual working hours,Real working hours,Hourly time off taken|Date!,Shift,Clock in,Clock out,Time off policy,Overtime duration before shift,Break duration before shift,Overtime duration after shift,Break duration after shift|Date,Clock in,Clock out,Overtime,Time off,Shift labels,Shift,Organization,Job position,Employment status,Job level,Branch||Import attendance
Time|Attendance activity|Employee name,Employee ID,Date,Time,Type,Job position,Photo,Face recognition,Liveness validation,Shift,Shift code,Location setting name,Location GPS name,Location address,Coordinate,Description,Source,Status||Date range,Status,Branch,Organization,Job position,Job level,Employment status|Overview,Approval Request|
Time|Absence deduction|Employee ID,Name,Branch,Organization,Absence|Employee name!,Time off policy!|Month,Year||Mark as Time-off
Time|Overtime requests|Employee name,Requested date,Overtime date,Duration,Compensation,Status|Employee name!,Overtime date!,Compensation,Reason,Overtime duration before shift,Break duration before shift,Overtime duration after shift,Break duration after shift,Attachment|Year,Status,Overtime date,My subordinate,Compensation,Branch,Organization,Job position,Job level,Employment status||Request overtime
Time|Calendar||Name of Event!,Date!,Number of days,Company holiday?,Start time,End time,Branch,Everyone can view?,Send Email?,Note||All Events,Birthday,Time off|Add Event
Time|Scheduler|Employee name,Branch,Organization,Current schedule|Employee!,Work Schedule!,Start Date!|Resignation status,Branch,Organization,Job position,Job level,Employment status,Schedule|Employees,Schedule|Assign schedule
Time|Time Reports|Report name,Format|Date range!,Employee,Attributes||Attendance report,Overtime report,Summary attendance report|Download report in XLS
Time|On-call schedule|Employee name,On-call date,On-call status,On-call shift,Created on|Date!,Description,Employee!,On-call shift|Month,Branch,Organization||Create on-call
Time|On-call activity|Employee name,Employee ID,Category,Date,Schedule start,Schedule end,Clock in,Clock out|Employee!,Date!,Category|Date,Branch,Organization||Import on-call activity
Time|On-call category|Category name,Category code,Status|Category name!,Category code!,Description|Status||Create on-call category
Time|Liveness||||||
Finance|All requests|Transaction ID,Request date,Employee name,Reimbursement name,Request amount,Description,Status|Request date!,Reimbursement name!,Employee name!,Attachment,Description,Benefit component,Total remaining balance,Total paid,Benefit name,Beneficiary,Request amount|Year,Status,Branch||Request reimbursement
Finance|Assign or update|Reimbursement name,Employee name,Total balance limit,Used balance,Remaining balance,Status|Reimbursement name!,Description,Employee selection!,Effective date,Expiration date!|Reimbursement,Status|Balance overview,Transaction history|Assign reimbursement
Finance|Disbursement||||||
Finance|Loan|No,Transaction ID,Loan Name,Employee ID,Employee,Loan Amount,Installment,Interest,Effective Date|Effective Date!,Employee!,Loan Name!,Amount!,Installment,Interest Type,Interest,Description,Attachment|||New loan
Payroll|Payroll processing|Period,Payment schedule,Status|Payroll period!,Payment schedule!,Custom BPJS date,Select all employees?,Employees!|||Run payroll
Payroll|Payroll history|Period,Last updated by,Total employee,Report,Payroll Status||Year,Status||Request data
Payroll|Import Payroll||Attachment!|||Import Payroll
Payroll|Payroll component adjustment|Transaction ID,Type,Effective date,End date,Created by,Description,Employees,Components name,Status|Type!,Effective date!,End date,Backpay?,Attachment,Description,Employees!,Component!,Amount|Date range,Component|Update history,Employee history|Update component
Payroll|Salary Tax Calculator||PTKP!,Tax Configuration!,Has NPWP?,Basic Salary,Total Allowance Taxable,Total Deduction Taxable,Total Allowance Non Taxable,Total Deduction Non Taxable,THR,Bonus,Has BPJS TK?,Has BPJS Kesehatan?||TER,Non TER|Calculate
Payroll|Reports|Report name,Format||Year,Month,Branch|Salary Report,Tax Report,BPJS Report,Human Resources Report,Attendance Report,Reimbursement Report,Overtime Report,Loan Report|Export
Payroll|Ex Employee Allowance|No,Transaction ID,Month,Year,Number of Employees,Taxable|Year!,Month!,Taxable?,Description,Employee!,Amount|||New allowance
Payroll|NPP Transaction History|Transaction ID,Total Employee,Created Date,Action|Description,Employee!,Branch,Effective Date!,Old Npp,New Npp!|||New transaction
Payroll|Cost Center|Employee name,Branch,Organization,Cost Center,Cost Center Category|Employee!,Cost Center,Cost Center Category|Category,Branch,Organization||Edit allocation
Payroll|General Ledger Mapper|Account number,Account name,Type,Transaction value,Component|Code!,Account name!,Description,JSON metadata,Account number,Type,Transaction value,Component|||Start mapping
Payroll|PKWT Compensation|Employee,Start contract date,End contract date,Work duration (month),Amount,Payroll period|Paid compensation on!,Employee!,Employment status,Start contract date,End contract date,Work duration,Amount|Period,Branch||Create new
Payroll|PPh21 DTP||Attachment|||DTP Recalculate
Payroll|Run THR||||||Run THR
Payroll|Tax/Recalculate||||||Recalculate
Payroll|BPJS New Rate||||||
Productivity|Projects|Name,Members,Tasks|Name!,Color|Member|Active,Archive|Create project
Productivity|Tasks|Task name,Project,Assignee,Due date,Task status|Task name!,Project,Assignee!,Send email?,Output,Allow update progress?,Payroll calculation?,Approval task?,Approval timetracking?,Due date,No due date?,Description,Attachment|Assignees,Task status,Projects,Due date||Create task
Productivity|Group for payroll|Group name,Total task,Payroll period||Month,Group|Task list,Group list|
Productivity|Time Tracker|Activity,Task,Start time,End time,Duration|What are you working on?!,Task,Start time!,End time!|||Manual time entry
Productivity|Activities|Employee,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday,Total time||Employee,Date range||Export XLS
Productivity|Summary|Project,Duration||Project,Date range||Export XLS
Productivity|Tracker Report|Employee,Project,Task,Duration,Approval status||Employee,Branch,Organization,Job level,Project,Task,Approval status,Period||Export
Productivity|Forms & surveys|Form name,Status,Submissions,Close date|Form name!,Description,Submission need approval?,Select all employees?,Reminder date,Remind before,Schedule close form,Daily summary?,Instant email?,Auto assign new employee?,Auto assign transfer?,Only allow 1 submission?|Status||Create form
Productivity|My submissions|Date,Form name,Status||Status,Date||
Productivity|Document Template|Template name,Description,Category|Template name!,Description,Category,Document number,Header,Body,Footer,Shortcode,Auto employee-file sync?,Sync on signature?,Attachment||New,Upload|Create template
Productivity|Generated documents|Transaction ID,Exported date,Employee name,Template name,Document number,Exported by,Employee files,Mekari Sign,Document status,Source||Month,Template,Employee,Employee-file status,Document status,Mekari Sign||Export
Company|Assets list|Asset name,Category name,Asset number,Assigned employee,Last modified|Asset name!,Asset number!,Description,Asset category!,Attachment,Purchase date,Purchase price,Assign asset to employee?,Employee,Assigned date|Category||Add asset
Company|Assigned assets|Asset name,Assigned employee,Asset category,Asset number,Assigned date|Asset name!,Employee!,Assigned date!|Category||Assign asset
Company|Asset category|Asset category,Total asset,Total assigned asset,Total unassigned asset|Category name!|||Add category
Company|Announcements|Title,Category,Publish date,Status|Title!,Body!,All employees?,Criteria,Category,Forms,Attachment,Send email?|Category||Create announcement
Company|User Activity Log|Date,Email,Activity,Type||Date range,Email,Type||Export
Company|Queue activity|Queue ID,Activity,Executed by,Submitted time,Started time,Status||||Refresh
Company|Notification|Type,Description,Effective Date,Payroll Name,Payroll Month,Created By,Created Date,Status,Action||Start date,End date,Status,Type||Skip all
Company|Company files|Folder name,Shared to,Accessible from,Last modified by|Name!,Description,Accessible on date,All employees?,Branch,Organization,Job position,Job level,Employment status,SBU,Employees,Attachment,Email reminder?|Employee,Job position|Company files,Employee files,Other files|Add folder
Company|Report Builder|Name,Description,Type,Format|Name!,Description,Type,Fields,Filter,Format,Schedule|||Create report
Settings · Account|Profile picture||Attachment|||Save changes
Settings · Account|Password payslip||Password!|||Save changes
Settings · Account|Change password||Current password!,New password!,Confirm password!|||Save changes
Settings · Account|Talenta labs||||||
Settings · Company|Company info||Company name!,Company phone number,Email,Address,Province,City,Industry,Company size,NPWP 15 digit,NPWP 16 digit,NITKU,Company taxable date,Tax person name,Tax person NPWP,HQ initial,HQ code,Show branch name?,UMR,UMR province,UMR city,BPJS Ketenagakerjaan,JKK,Kode KLU,Signature,Attendance on mobile||Company Info,Tax Info,Other Info|Edit company info
Settings · Company|Group structure|Group ID,Employment status,Branch,Organization,Job level|Group ID!,Employment status,Branch,Organization,Job level,Job position,Grade,Class,Cost Center,Cost center category,Approval line,Manager,Custom field,SBU|Status||Create group
Settings · Company|Branch|Branch code,Branch name,Parent branch,Employees,Province,City|Branch name!,Branch code!,Address,Postal code,Fax,Phone number,Province,City,Minimum wage,Matching NPWP?,Branch tax name,Branch NITKU,NPWP old,NPWP new,Tax holder name,Tax holder NPWP,KLU code,Signature,JHT payment source,BPJS payment source,Attendance on mobile|Province||Add branch
Settings · Company|Organization|Organization code,Name,Parent organization,Employees,Actions|Organization code!,Organization name!,Parent organization|Status|Chart view,Table view|Add organization
Settings · Company|Strategic business unit|Group name,Description,Total SBU,Created date,Last updated,Status|Group name!,Description|Status||Create SBU group
Settings · Company|Job level|Job level code,Job level name,Employees,Status,Actions||Status||Add job level
Settings · Company|Job position|Job position code,Name,Parent job position,Employees|Job position code!,Job position name!,Parent job position,Job description|Status|Chart view,Table view|Add job position
Settings · Company|Grade & class|Grade Name|Grade Name!,Class Name,From,To,Grade||Grade,Class|New
Settings · Company|Auto generate format||Form Type!,Employment status,Component type,Text,Start number,Auto ID reset?,Auto ID sequencing?|||Create format
Settings · Company|Files||Allow employees to edit or delete files?|||Save settings
Settings · Company|Custom field|Field name,Field type,Editing method,Created date,Show on|Field name!,Editing method,Show on,Field type|Status|Employee info,Include on feature|Create field
Settings · Company|NPP|Npp Name,Npp Number,Branch,JKK,Action|NPP Name!,NPP Number!,JKK,Branch|||Add NPP
Settings · Company|Employment status|Employment status name,Sign date,End date|Employment status name!,This status has sign date?,This status has end date?,Set specific duration for end date?|||Add employment status
Settings · Company|Notification|Type,Email,Inbox Talenta,Push notification|Email?,Inbox Talenta?,Push notification?||General,Time management|Save settings
Settings · Company|Restricted employee|Field type,Restricted data,Reason,Period,Restriction method|Field type!,Restricted data!,Reason,Period,Restriction method|||Add restriction
Settings · Time|Shift|Shift name,Shift code,Working hour,Show in request,Break hour,Shift eligibility,Assign to,Description||Status||Create new shift
Settings · Time|Break|Name,Created date,Break,Assigned to|Name!,Schedule break start!,Schedule break end!|||Add break
Settings · Time|Machine|Name Setting,Edit,Delete,Token||||New
Settings · Time|Auto schedule||||||Create a preset
Settings · Time|Location set up|Employee,Branch,Organization,Location settings|Location settings name!,GPS Location,Employee,Auto assignment rules?,Location name,Address,Radius,Coordinate|Branch,Employment status,Organization,Job position,Job level|Employee,Location|Create location setting
Settings · Time|Mobile set up||Selfie required?,Note mandatory?,Live tracking?|||Save changes
Settings · Time|Portal|Device name,Device ID,Last login,Device Model,Employee List|Offline mode?||General settings,List of devices|Save changes
Settings · Time|Time off||||||Save settings
Settings · Time|Overtime||||||Save settings
Settings · Time|Holiday||||||Save settings
Settings · Time|Timesheet|Employee,Setting name|Setting name!,Set reminder time track?,Time,Repeat every,Enable time tracker on live attendance?,Enable shift selection?,Enable location selection?,Employee|Branch,Organization|Employees,Setting|Create setting
Settings · Payroll|Payroll schedule||||||Save settings
Settings · Payroll|Cut Off & Tax Settings||||||Save settings
Settings · Payroll|Payroll component|Name,Amount,Type,Tax|Name!,Amount,Currency,Payroll Payment Schedule,Type,Tax,Default?,Pro Rate?,Formula,Zakat?||Allowance,Deduction,Benefit,Custom Rate,Currency Rate|Add component
Settings · Payroll|Payslip templates||||||Save settings
Settings · Payroll|Taxslip||||||Save settings
Settings · Payroll|Pro-rate||||||Save settings
Settings · Payroll|Absence||||||Save settings
Settings · Payroll|THR||||||Save settings
Settings · Payroll|Time off compensation||||||Save settings
Settings · Payroll|Payment schedule|Name,Type,Payment Schedule Date,Attendance,Payroll,Attendance Pay Last Month,Weekly Payment||||Add
Settings · Payroll|Resign compensation||||||Save settings
Settings · Payroll|Custom compensation||||||Save settings
Settings · Finance|Reimbursement|Reimbursement Name,Effective Date,Status|Reimbursement Name!,Effective Date!,Reimbursement Description,Unlimited amount?,Default reimbursement?,Include in Take Home Pay?,Taxable?,Prorate on First Year?,No Expiry Date?,Max Request Per Emerge,Expired In,Emerge,Reimbursement Limit,Emerge Day,First Year,Benefit Name,Max Request,Min Next Claim,Formula|||Add policy
Settings · Finance|Loan||||||
Settings · ESS|Approval|Name Setting,Request,Approval|Name Setting!,Request,Approval|||New
Settings · ESS|New approval|Name,Description,Last updated,Updated by,Actions|Approval name!,Description,Total overtime per month,Hours,Day type,Criteria,Branch,Organization,Job position,Job level,SBU,Employee scope,Auto ascend?,Approver!|||Create approval
Settings · ESS|Delegation|Start date,End date,From employee,To employee,Delegated modules|From employee!,To employee!,Delegation date!,Modules to delegate!|Date range,Module||Add delegation
Settings · ESS|Module|Field,Show Menu,Notes Mandatory,Attachment Mandatory|Show Menu?,Notes Mandatory?,Attachment Mandatory?||Employee,Employee Organization Chart,My Info,Calendar,Delegation,Email & Reminder,ESS request,Change data,Projects/Tasks/Timesheet|Save settings
Settings · Users|Users|Photo,Employee ID,Fullname,Role,Last Action,Action|Employee!,Email!,Role|||Invite Employee
Settings · Users|Invitation to Talenta|Employee name,Employee ID,Email,Job position,Organization,Branch,Job level,Join date||Status||Export
Settings · Users|Access role|Role Name,Actions|Role Name!,Role!,Organization,Job position,Job level,Branch,SBU,Role Type,Time Management?,Employee?,Payroll?,Approval List?,Manpower Planning?,General Ledger Mapper?,Subordinate Time Off Request?,Subordinate Overtime Request?|||New role
Settings · Users|Onboarding setting|Description,Job|Name!,Job Position,Work Location,Instruction,Task for inviter,Task for new employee,Organization|||Create New Set
Settings · Users|Onboarding task|Description,Type,Action|Task Type!,Task Description!||Task for inviter,Task for new employee|Add New Task
Settings · Users|Offboarding task template|Task name,Task for,Due on|Task name!,Task for,Due on,Description,Attachment,All employees?,Organization,Branch,Email assignee?|||Create Task
Settings · Users|Offboarding forms and docs|Name,Type|Request resign?,Exit interview?,Form,Document|||Add form
Applications|Mekari Expense||||||
Applications|Mekari Flex||||||
Applications|Insurance||||||
Applications|LMS||||||
Integrations|Product|Add-on,Provider,Status||||Detail add-ons
Integrations|API Data Masking|Category,Field,Masked|Employee identity?,Payroll?,Tax?,Location?|||Save settings
'''
pages=[]
for line in registry.strip().splitlines():
 p=(line.split('|')+['']*7)[:7]
 group,name,cols,fields,filters,tabs,action=p
 pages.append(dict(id=re.sub('[^a-z0-9]+','-',group.lower()+'-'+name.lower()).strip('-'),group=group,name=name,columns=[x.strip() for x in cols.split(',') if x.strip()],fields=[x.strip() for x in fields.split(',') if x.strip()],filters=[x.strip() for x in filters.split(',') if x.strip()],tabs=[x.strip() for x in tabs.split(',') if x.strip()],action=action))
source=Path('/Users/hari/Documents/itulah/hr-talenta-inventory.md').read_text()
for p in pages:
 name=p['name'].lower()
 paras=source.split('\n\n')
 matches=[s for s in paras if (('**'+name+'**') in s.lower() or ('### '+name) in s.lower() or ('**'+name+':**') in s.lower())]
 # Keep provenance as inventory excerpts, not live data.
 p['notes']='\n\n'.join(matches[:3]) if matches else 'Menu tercatat dalam inventaris. Rincian yang belum tersedia ditandai sebagai belum terverifikasi; kontrol tambahan adalah simulasi UI lokal.'
 p['verified']=bool(p['fields'] or p['columns'])
(root/'schema.js').write_text('window.PAGES = '+json.dumps(pages,ensure_ascii=False,indent=2)+';\n')
print(len(pages),'pages generated')
