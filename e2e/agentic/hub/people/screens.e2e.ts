// Every People screen opens for head office without the app's error screen; the settings screens answer too.
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const LOAD = { timeout: 45_000 };

const SCREENS: [string, string][] = [
  ['/people/overview', 'Overview'],
  ['/people', 'Employees'],
  ['/people/org-chart', 'Org Chart'],
  ['/people/changes', 'Employee Changes'],
  ['/people/onboarding', 'Onboarding'],
  ['/people/offboarding', 'Offboarding'],
  ['/people/reprimands', 'Reprimands'],
  ['/people/invitations', 'Invitations'],
  ['/people/leave', 'Time Off'],
  ['/people/leave-balances', 'Leave Balances'],
  ['/people/attendance-days', 'Attendance'],
  ['/people/overtime', 'Overtime'],
  ['/people/roster', 'Roster'],
  ['/people/calendar', 'Team Calendar'],
  ['/people/claims', 'Claims'],
  ['/people/loans', 'Loans'],
  ['/people/claim-allowances', 'Yearly Allowances'],
  ['/people/benefit', 'Employee Benefit'],
  ['/people/payroll', 'Payroll'],
  ['/people/one-offs', 'One-offs'],
  ['/people/tax-report', 'PPh 21 & BPJS'],
  ['/people/annual-tax', 'Annual Tax'],
  ['/people/reports', 'Reports'],
  ['/people/job-roles', 'Job Roles'],
  ['/people/claim-types', 'Claim Types'],
];

const SETTINGS: [string, RegExp][] = [
  ['/people/settings/company', /Company/],
  ['/people/settings/group', /Group|Business Units/],
  ['/people/settings/departments', /Departments/],
  ['/people/settings/levels', /Job Levels|Grades/],
  ['/people/settings/attendance', /Attendance/],
  ['/people/settings/mobile', /Mobile|Locations/],
  ['/people/settings/shifts', /Shifts/],
  ['/people/settings/leave-types', /Time Off Types|Leave/],
  ['/people/settings/holidays', /Holidays/],
  ['/people/settings/overtime', /Overtime/],
  ['/people/settings/payroll-schedule', /Schedule|Pro-rate/],
  ['/people/settings/components', /Components|Structures/],
  ['/people/settings/payslip', /Payslip/],
  ['/people/settings/absence', /Absence/],
  ['/people/settings/rates', /BPJS|Tax/],
  ['/people/settings/benefit', /Benefit/],
  ['/people/settings/checklists', /Onboarding|Tasks|Checklist/],
  ['/people/settings/delegation', /Delegation|Approval/],
  ['/people/settings/app', /Employee App/],
];

describe('People: every screen opens', { tags: ['people'] }, () => {
  for (const [route, heading] of SCREENS) {
    test(`HR-130 ${route} opens on "${heading}"`, { session: 'rina', tags: route === '/people/roster' ? ['people', 'bug'] : ['people'] }, async ({ app, screen }) => {
      await app.open(route);
      await expect(screen.getByRole('heading', heading)).toBeVisible(LOAD);
      await expect(screen.getByText('Something went wrong!')).toBeHidden();
    });
  }
  for (const [route, heading] of SETTINGS) {
    test(`HR-131 settings ${route} opens`, { session: 'rina', tags: ['people'] }, async ({ app, screen }) => {
      await app.open(route);
      await expect(screen.getByRole('heading', { name: heading }).first()).toBeVisible(LOAD);
      await expect(screen.getByText('Something went wrong!')).toBeHidden();
    });
  }
});
