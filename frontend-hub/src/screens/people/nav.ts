import {
  BadgeCheck,
  BadgePercent,
  Building2,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  Clock4,
  Coins,
  FileBadge,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Gauge,
  Gift,
  Handshake,
  HandCoins,
  Hourglass,
  Landmark,
  Layers,
  LayoutGrid,
  Link2,
  ListChecks,
  LogIn,
  LogOut,
  MapPin,
  Network,
  ReceiptText,
  Repeat2,
  Scale,
  Settings,
  ShieldAlert,
  Smartphone,
  Sun,
  Timer,
  Users,
  UserX,
  Wallet,
} from "lucide-react"

import type { AppModule, NavItem, NavTab } from "@/lib/navigation"
import { usePeopleWaitingCount } from "@/screens/people/badges"
import { usePeopleAudience } from "@/screens/people/scope"

/// HR as five doors (owner, 2026-10-16, `hr-doors-prototype.html`: 44 rows
/// → 5, "tetap tab, bukan sidebar di dalam"), the way Finance became nine the
/// same day.
///
/// | Door | Tabs |
/// |---|---|
/// | Overview | Requests · Reports |
/// | People | Employees · Changes · Onboarding · Invitations |
/// | Time | Time off · Attendance · Overtime · Roster |
/// | Pay | Payroll · Claims · Loans · Benefit · Tax |
/// | Setup | one page of every setting (`setup-index.tsx`) |
///
/// A tab of two screens read as one place — Joining and Leaving, a week and a
/// month of the roster — is one tab with a choice of view beside it.
///
/// # Every screen kept
///
/// Nothing was deleted. A screen that is not a door's first is a `hidden` item
/// below, under the name it had, so ⌘K still finds "Team Calendar" and lands
/// on Time › Roster › Month. Its `audience` stays on it: `doorTabsFor` leaves
/// a store manager's door without the views that are head office's, so they
/// see four doors — People without Changes, Pay without Loans, Benefit and
/// Tax — and no Setup.
///
/// A door's row hides with its own `audience`, so a door whose first view is
/// for everyone carries none; only Setup is head office's alone.

/// A door's row: the first view of its first tab, lit on every other path its
/// tabs name, and on `also` — screens reached from inside the door.
function door(
  row: Omit<NavItem, "path" | "alsoLights"> & { tabs: readonly NavTab[] },
  also: readonly string[] = []
): NavItem {
  const paths = row.tabs.flatMap((tab) => tab.views.map((view) => view.path))
  return { ...row, path: paths[0], alsoLights: [...paths.slice(1), ...also] }
}

const one = (label: string, path: string): NavTab => ({
  label,
  views: [{ label, path }],
})

/// What the Setup page lists, group by group, by path. The page reads the
/// labels and icons off the items themselves.
export const peopleSetupGroups: readonly {
  readonly label: string
  readonly paths: readonly string[]
}[] = [
  {
    label: "Company",
    paths: [
      "/people/settings/company",
      "/people/settings/group",
      "/people/settings/departments",
      "/people/settings/levels",
    ],
  },
  {
    label: "Time",
    paths: [
      "/people/settings/attendance",
      "/people/settings/mobile",
      "/people/settings/shifts",
      "/people/settings/leave-types",
      "/people/settings/holidays",
      "/people/settings/overtime",
    ],
  },
  {
    label: "Pay",
    paths: [
      "/people/settings/payroll-schedule",
      "/people/settings/components",
      "/people/settings/payslip",
      "/people/settings/absence",
      "/people/settings/rates",
      "/people/claim-types",
      "/people/claim-allowances",
    ],
  },
  {
    label: "Access",
    paths: [
      "/people/job-roles",
      "/people/settings/checklists",
      "/people/settings/delegation",
      "/people/settings/app",
    ],
  },
]

export const peopleNav: AppModule = {
  id: "people",
  base: "/people",
  label: "People",
  icon: Users,
  home: "/people/overview",
  useAudience: usePeopleAudience,
  sections: [
    {
      items: [
        // ── the five doors ──
        door({
          /// What is waiting on the caller: leave, corrections, swaps,
          /// changes, claims and payroll decisions.
          label: "Overview",
          icon: LayoutGrid,
          badge: "warn",
          useCount: usePeopleWaitingCount,
          tabs: [
            one("Requests", "/people/overview"),
            one("Reports", "/people/reports"),
          ],
        }),
        door({
          label: "People",
          icon: Users,
          tabs: [
            {
              label: "Employees",
              views: [
                { label: "List", path: "/people" },
                { label: "Org chart", path: "/people/org-chart" },
              ],
            },
            {
              label: "Changes",
              views: [
                { label: "Changes", path: "/people/changes" },
                { label: "Reprimands", path: "/people/reprimands" },
              ],
            },
            {
              label: "Onboarding",
              views: [
                { label: "Joining", path: "/people/onboarding" },
                { label: "Leaving", path: "/people/offboarding" },
              ],
            },
            one("Invitations", "/people/invitations"),
          ],
        }),
        door({
          label: "Time",
          icon: Clock4,
          tabs: [
            {
              label: "Time off",
              views: [
                { label: "Requests", path: "/people/leave" },
                { label: "Balances", path: "/people/leave-balances" },
              ],
            },
            one("Attendance", "/people/attendance-days"),
            one("Overtime", "/people/overtime"),
            {
              label: "Roster",
              views: [
                { label: "Week", path: "/people/roster" },
                { label: "Month", path: "/people/calendar" },
              ],
            },
          ],
        }),
        door(
          {
            label: "Pay",
            icon: Wallet,
            tabs: [
              {
                label: "Payroll",
                views: [
                  { label: "Runs", path: "/people/payroll" },
                  { label: "One-offs", path: "/people/one-offs" },
                ],
              },
              one("Claims", "/people/claims"),
              one("Loans", "/people/loans"),
              one("Benefit", "/people/benefit"),
              {
                label: "Tax",
                views: [
                  { label: "PPh 21 & BPJS", path: "/people/tax-report" },
                  { label: "1721-A1", path: "/people/annual-tax" },
                ],
              },
            ],
          },
          // Benefit's switch, opened from the line on Pay › Benefit.
          ["/people/settings/benefit"]
        ),
        {
          path: "/people/hr-setup",
          label: "Setup",
          icon: Settings,
          audience: "employer",
          alsoLights: peopleSetupGroups.flatMap((group) => group.paths),
        },

        // ── the screens behind the doors, under the names they had ──
        // Overview
        {
          path: "/people/reports",
          label: "Reports",
          icon: ChartColumn,
          hidden: true,
        },
        // People
        {
          path: "/people/org-chart",
          label: "Org Chart",
          icon: Network,
          hidden: true,
        },
        {
          path: "/people/changes",
          label: "Transfers & Changes",
          icon: Repeat2,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/reprimands",
          label: "Reprimands",
          icon: ShieldAlert,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/onboarding",
          label: "Onboarding",
          icon: LogIn,
          hidden: true,
        },
        {
          path: "/people/offboarding",
          label: "Offboarding",
          icon: LogOut,
          hidden: true,
        },
        {
          path: "/people/invitations",
          label: "Invitations",
          icon: Link2,
          hidden: true,
        },
        // Time
        {
          path: "/people/leave-balances",
          label: "Time Off Balances",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/people/attendance-days",
          label: "Attendance",
          icon: Fingerprint,
          hidden: true,
        },
        {
          path: "/people/overtime",
          label: "Overtime",
          icon: Hourglass,
          hidden: true,
        },
        {
          path: "/people/roster",
          label: "Roster",
          icon: CalendarRange,
          hidden: true,
        },
        {
          path: "/people/calendar",
          label: "Team Calendar",
          icon: CalendarDays,
          hidden: true,
        },
        // Pay
        {
          path: "/people/one-offs",
          label: "One-offs",
          icon: Coins,
          hidden: true,
        },
        {
          path: "/people/claims",
          label: "Claims",
          icon: ReceiptText,
          hidden: true,
        },
        {
          path: "/people/loans",
          label: "Loans",
          icon: HandCoins,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/benefit",
          label: "Benefit Balances",
          icon: Gift,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/benefit",
          label: "Benefit Settings",
          icon: Gift,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/tax-report",
          label: "Tax & BPJS Report",
          icon: FileSpreadsheet,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/annual-tax",
          label: "1721-A1",
          icon: FileBadge,
          audience: "employer",
          hidden: true,
        },
        // Setup · Company
        {
          path: "/people/settings/company",
          label: "Company & NPP",
          icon: Building2,
          audience: "employer",
          moved: ["/people/settings"],
          hidden: true,
        },
        {
          path: "/people/settings/group",
          label: "Group & Business Units",
          icon: Landmark,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/departments",
          label: "Departments",
          icon: Layers,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/levels",
          label: "Job Levels & Grades",
          icon: Gauge,
          audience: "employer",
          hidden: true,
        },
        // Setup · Time
        {
          path: "/people/settings/attendance",
          label: "Attendance Rules",
          icon: Clock4,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/mobile",
          label: "Mobile & Locations",
          icon: MapPin,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/shifts",
          label: "Shifts & Breaks",
          icon: Timer,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/leave-types",
          label: "Time Off Types",
          icon: CalendarOff,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/holidays",
          label: "Holidays",
          icon: Sun,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/overtime",
          label: "Overtime Rules",
          icon: Hourglass,
          audience: "employer",
          hidden: true,
        },
        // Setup · Pay
        {
          path: "/people/settings/payroll-schedule",
          label: "Schedule & Pro-rate",
          icon: CalendarDays,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/components",
          label: "Components & Structures",
          icon: ListChecks,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/payslip",
          label: "Payslip",
          icon: FileText,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/absence",
          label: "Absence Deduction",
          icon: UserX,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/rates",
          label: "BPJS & Tax Rates",
          icon: BadgePercent,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/claim-types",
          label: "Claim Types",
          icon: ReceiptText,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/claim-allowances",
          label: "Claim Allowances",
          icon: Wallet,
          audience: "employer",
          hidden: true,
        },
        // Setup · Access
        {
          path: "/people/job-roles",
          label: "Job Roles",
          icon: BadgeCheck,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/checklists",
          label: "Onboarding Tasks",
          icon: ClipboardCheck,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/delegation",
          label: "Approval Delegation",
          icon: Handshake,
          audience: "employer",
          hidden: true,
        },
        {
          path: "/people/settings/app",
          label: "Employee App",
          icon: Smartphone,
          audience: "employer",
          hidden: true,
        },
      ],
    },
  ],
}
