import {
  ArrowLeftRight,
  BadgeCheck,
  BadgePercent,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  Clock4,
  Coins,
  FileBadge,
  FilePen,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Gauge,
  Gift,
  Handshake,
  HandCoins,
  History,
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

/// HR as nine menus of one word each (owner, 2026-10-17, after "Work
/// Schedules & Attendance" was too long), each a door whose tabs are the
/// screens it stands for — the five doors of 2026-10-16 (Overview · People ·
/// Time · Pay · Setup) split where one door held two jobs.
///
/// | Menu | Tabs |
/// |---|---|
/// | Overview | Inbox · Reports |
/// | Employees | Directory · Changes · Onboarding · Offboarding · Discipline |
/// | Schedules | Roster · Calendar · Swaps |
/// | Attendance | Records · Corrections · Leave · Overtime |
/// | Payroll | Runs · Adjustments · Payslips · Tax |
/// | Claims | Requests · History |
/// | Benefits | Balances · History |
/// | Loans | Loans · Repayments |
/// | Settings | Organization · Attendance · Payroll · Benefits · Access |
///
/// Schedules is the plan and Attendance is what happened. Payroll is the
/// salary due for a period; Claims is what an employee paid for the work and
/// is owed back; Benefits is the shopping balance the company gives; Loans is
/// money an employee owes the company. Each is its own menu, so a payroll
/// deduction for a loan is the loan's repayment, never a second balance kept
/// inside Payroll.
///
/// Travel (assignment → approval → advance → settlement, claims linked) is
/// the next menu, after Loans; it is not built.
///
/// # Every screen kept
///
/// A screen that is not a door's first is a `hidden` item below, under its
/// own name, so ⌘K still finds it and its row lights the door. Renamed paths
/// keep the old one in `moved`, so a link or a bookmark still lands. A view's
/// `audience` stays on its item: `doorTabsFor` leaves a store manager's door
/// without head office's views, so they see six menus — no Benefits, Loans
/// or Settings, and Employees without Changes and Discipline.
///
/// No row's path is a prefix of another door's: the sidebar lights a row when
/// the address equals one of its paths or starts with it plus a slash.

/// A door's row: the first view of its first tab, lit on every other path its
/// tabs name.
function door(
  row: Omit<NavItem, "path" | "alsoLights"> & { tabs: readonly NavTab[] }
): NavItem {
  const paths = row.tabs.flatMap((tab) => tab.views.map((view) => view.path))
  return { ...row, path: paths[0], alsoLights: paths.slice(1) }
}

const one = (label: string, path: string): NavTab => ({
  label,
  views: [{ label, path }],
})

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
        // ── the nine menus ──
        door({
          /// What is waiting on the caller: leave, corrections, swaps,
          /// changes, claims and payroll decisions.
          label: "Overview",
          icon: LayoutGrid,
          badge: "warn",
          useCount: usePeopleWaitingCount,
          tabs: [
            one("Inbox", "/people/overview"),
            one("Reports", "/people/reports"),
          ],
        }),
        door({
          label: "Employees",
          icon: Users,
          tabs: [
            {
              label: "Directory",
              views: [
                { label: "List", path: "/people" },
                { label: "Org chart", path: "/people/org-chart" },
              ],
            },
            one("Changes", "/people/changes"),
            one("Onboarding", "/people/onboarding"),
            one("Offboarding", "/people/offboarding"),
            one("Discipline", "/people/discipline"),
          ],
        }),
        door({
          label: "Schedules",
          icon: CalendarRange,
          tabs: [
            one("Roster", "/people/roster"),
            one("Calendar", "/people/calendar"),
            one("Swaps", "/people/swaps"),
          ],
        }),
        door({
          label: "Attendance",
          icon: Fingerprint,
          tabs: [
            one("Records", "/people/attendance-days"),
            one("Corrections", "/people/corrections"),
            {
              label: "Leave",
              views: [
                { label: "Requests", path: "/people/leave" },
                { label: "Balances", path: "/people/leave-balances" },
              ],
            },
            one("Overtime", "/people/overtime"),
          ],
        }),
        door({
          label: "Payroll",
          icon: Wallet,
          tabs: [
            one("Runs", "/people/payroll"),
            one("Adjustments", "/people/adjustments"),
            one("Payslips", "/people/payslips"),
            {
              label: "Tax",
              views: [
                { label: "PPh 21 & BPJS", path: "/people/tax-report" },
                { label: "1721-A1", path: "/people/annual-tax" },
              ],
            },
          ],
        }),
        door({
          label: "Claims",
          icon: ReceiptText,
          tabs: [
            one("Requests", "/people/claims"),
            one("History", "/people/claim-history"),
          ],
        }),
        door({
          label: "Benefits",
          icon: Gift,
          audience: "employer",
          tabs: [
            one("Balances", "/people/benefit"),
            one("History", "/people/benefit-history"),
          ],
        }),
        door({
          label: "Loans",
          icon: HandCoins,
          audience: "employer",
          tabs: [
            one("Loans", "/people/loans"),
            one("Repayments", "/people/loan-repayments"),
          ],
        }),
        door({
          label: "Settings",
          icon: Settings,
          audience: "employer",
          // The one-page Setup of 2026-10-16, and the tabbed page before it.
          moved: ["/people/settings", "/people/hr-setup"],
          tabs: [
            {
              label: "Organization",
              views: [
                { label: "Company & NPP", path: "/people/settings/company" },
                {
                  label: "Group & business units",
                  path: "/people/settings/group",
                },
                { label: "Departments", path: "/people/settings/departments" },
                { label: "Levels & grades", path: "/people/settings/levels" },
                {
                  label: "Onboarding tasks",
                  path: "/people/settings/checklists",
                },
              ],
            },
            {
              label: "Attendance",
              views: [
                {
                  label: "Attendance rules",
                  path: "/people/settings/attendance",
                },
                {
                  label: "Mobile & locations",
                  path: "/people/settings/mobile",
                },
                { label: "Shifts & breaks", path: "/people/settings/shifts" },
                { label: "Leave types", path: "/people/settings/leave-types" },
                { label: "Holidays", path: "/people/settings/holidays" },
                { label: "Overtime rules", path: "/people/settings/overtime" },
              ],
            },
            {
              label: "Payroll",
              views: [
                {
                  label: "Schedule & pro-rate",
                  path: "/people/settings/payroll-schedule",
                },
                {
                  label: "Components & structures",
                  path: "/people/settings/components",
                },
                { label: "Payslip", path: "/people/settings/payslip" },
                {
                  label: "Absence deduction",
                  path: "/people/settings/absence",
                },
                { label: "BPJS & tax rates", path: "/people/settings/rates" },
                { label: "Claim types", path: "/people/claim-types" },
                { label: "Claim limits", path: "/people/claim-allowances" },
              ],
            },
            one("Benefits", "/people/settings/benefit"),
            {
              label: "Access",
              views: [
                { label: "Roles", path: "/people/roles" },
                { label: "Invitations", path: "/people/invitations" },
                { label: "Delegation", path: "/people/settings/delegation" },
                { label: "Employee app", path: "/people/settings/app" },
              ],
            },
          ],
        }),

        // ── the screens behind the doors, by the name ⌘K finds them under ──
        // Overview
        {
          path: "/people/reports",
          label: "Reports",
          icon: ChartColumn,
          hidden: true,
        },
        // Employees
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
          path: "/people/discipline",
          label: "Discipline",
          icon: ShieldAlert,
          audience: "employer",
          moved: ["/people/reprimands"],
          hidden: true,
        },
        // Schedules
        {
          path: "/people/calendar",
          label: "Team Calendar",
          icon: CalendarDays,
          hidden: true,
        },
        {
          path: "/people/swaps",
          label: "Shift Swaps",
          icon: ArrowLeftRight,
          hidden: true,
        },
        // Attendance
        {
          path: "/people/corrections",
          label: "Attendance Corrections",
          icon: FilePen,
          hidden: true,
        },
        {
          path: "/people/leave",
          label: "Leave Requests",
          icon: CalendarOff,
          hidden: true,
        },
        {
          path: "/people/leave-balances",
          label: "Leave Balances",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/people/overtime",
          label: "Overtime",
          icon: Hourglass,
          hidden: true,
        },
        // Payroll
        {
          path: "/people/adjustments",
          label: "Payroll Adjustments",
          icon: Coins,
          moved: ["/people/one-offs"],
          hidden: true,
        },
        {
          path: "/people/payslips",
          label: "Payslips",
          icon: FileText,
          hidden: true,
        },
        {
          path: "/people/tax-report",
          label: "PPh 21 & BPJS",
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
        // Claims
        {
          path: "/people/claim-history",
          label: "Claim History",
          icon: History,
          hidden: true,
        },
        // Benefits
        {
          path: "/people/benefit-history",
          label: "Benefit History",
          icon: History,
          audience: "employer",
          hidden: true,
        },
        // Loans
        {
          path: "/people/loan-repayments",
          label: "Loan Repayments",
          icon: Coins,
          audience: "employer",
          hidden: true,
        },
        // Settings · Organization
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
          label: "Levels & Grades",
          icon: Gauge,
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
        // Settings · Attendance
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
          label: "Leave Types",
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
        // Settings · Payroll
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
          label: "Claim Limits",
          icon: Wallet,
          audience: "employer",
          hidden: true,
        },
        // Settings · Benefits
        {
          path: "/people/settings/benefit",
          label: "Benefit Settings",
          icon: Gift,
          audience: "employer",
          hidden: true,
        },
        // Settings · Access
        {
          path: "/people/roles",
          label: "Roles",
          icon: BadgeCheck,
          audience: "employer",
          moved: ["/people/job-roles"],
          hidden: true,
        },
        {
          path: "/people/invitations",
          label: "Invitations",
          icon: Link2,
          hidden: true,
        },
        {
          path: "/people/settings/delegation",
          label: "Delegation",
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
