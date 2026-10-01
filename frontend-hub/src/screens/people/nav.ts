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
  Receipt,
  ReceiptText,
  Repeat2,
  Scale,
  ShieldAlert,
  Smartphone,
  Sun,
  Timer,
  Users,
  UserX,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { usePeopleWaitingCount } from "@/screens/people/badges"
import { usePeopleAudience } from "@/screens/people/scope"

/// The HR department's sidebar, grouped as Talenta groups it (owner, 1 Oct
/// 2026: "kita jangan padatkan, bikin sub menu").
///
/// Every row is a page of its own — a list with its actions in the header,
/// and every form in a sheet — rather than a tab hidden inside another page.
/// Head office's setup sits in the four Settings groups at the bottom, which
/// a place manager does not see.
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
        {
          /// What is waiting on the caller: leave, corrections, swaps,
          /// overtime, claims and payroll decisions.
          path: "/people/overview",
          label: "Overview & requests",
          icon: LayoutGrid,
          badge: "warn",
          useCount: usePeopleWaitingCount,
        },
      ],
    },
    {
      label: "Employees",
      items: [
        { path: "/people", label: "Employee list", icon: Users },
        { path: "/people/org-chart", label: "Org chart", icon: Network },
        {
          path: "/people/changes",
          label: "Transfers & changes",
          icon: Repeat2,
          audience: "employer",
        },
        { path: "/people/onboarding", label: "Onboarding", icon: LogIn },
        { path: "/people/offboarding", label: "Offboarding", icon: LogOut },
        {
          path: "/people/reprimands",
          label: "Reprimands",
          icon: ShieldAlert,
          audience: "employer",
        },
        { path: "/people/invitations", label: "Invitations", icon: Link2 },
      ],
    },
    {
      label: "Time",
      items: [
        {
          path: "/people/leave",
          label: "Time off requests",
          icon: CalendarOff,
        },
        {
          path: "/people/leave-balances",
          label: "Time off balances",
          icon: Scale,
        },
        {
          path: "/people/attendance-days",
          label: "Attendance",
          icon: Fingerprint,
        },
        { path: "/people/overtime", label: "Overtime", icon: Hourglass },
        { path: "/people/roster", label: "Roster", icon: CalendarRange },
        {
          path: "/people/calendar",
          label: "Team calendar",
          icon: CalendarDays,
        },
      ],
    },
    {
      label: "Finance",
      items: [
        { path: "/people/claims", label: "Claims", icon: ReceiptText },
        {
          path: "/people/loans",
          label: "Loans",
          icon: HandCoins,
          audience: "employer",
        },
        {
          path: "/people/claim-allowances",
          label: "Claim allowances",
          icon: Wallet,
          audience: "employer",
        },
      ],
    },
    {
      label: "Benefit",
      items: [
        {
          path: "/people/benefit",
          label: "Balances",
          icon: Gift,
          audience: "employer",
        },
      ],
    },
    {
      label: "Payroll",
      items: [
        { path: "/people/payroll", label: "Payroll runs", icon: Receipt },
        { path: "/people/one-offs", label: "One-offs", icon: Coins },
        {
          path: "/people/tax-report",
          label: "Tax & BPJS report",
          icon: FileSpreadsheet,
          audience: "employer",
        },
        {
          path: "/people/annual-tax",
          label: "1721-A1",
          icon: FileBadge,
          audience: "employer",
        },
      ],
    },
    {
      label: "Reports",
      items: [{ path: "/people/reports", label: "Reports", icon: ChartColumn }],
    },
    {
      label: "Settings · Company",
      items: [
        {
          path: "/people/settings/company",
          label: "Company & NPP",
          icon: Building2,
          audience: "employer",
          moved: ["/people/settings"],
        },
        {
          path: "/people/settings/group",
          label: "Group & business units",
          icon: Landmark,
          audience: "employer",
        },
        {
          path: "/people/settings/departments",
          label: "Departments",
          icon: Layers,
          audience: "employer",
        },
        {
          path: "/people/settings/levels",
          label: "Job levels & grades",
          icon: Gauge,
          audience: "employer",
        },
      ],
    },
    {
      label: "Settings · Time",
      items: [
        {
          path: "/people/settings/attendance",
          label: "Attendance rules",
          icon: Clock4,
          audience: "employer",
        },
        {
          path: "/people/settings/mobile",
          label: "Mobile & locations",
          icon: MapPin,
          audience: "employer",
        },
        {
          path: "/people/settings/shifts",
          label: "Shifts & breaks",
          icon: Timer,
          audience: "employer",
        },
        {
          path: "/people/settings/leave-types",
          label: "Time off types",
          icon: CalendarOff,
          audience: "employer",
        },
        {
          path: "/people/settings/holidays",
          label: "Holidays",
          icon: Sun,
          audience: "employer",
        },
        {
          path: "/people/settings/overtime",
          label: "Overtime rules",
          icon: Hourglass,
          audience: "employer",
        },
      ],
    },
    {
      label: "Settings · Payroll",
      items: [
        {
          path: "/people/settings/payroll-schedule",
          label: "Schedule & pro-rate",
          icon: CalendarDays,
          audience: "employer",
        },
        {
          path: "/people/settings/components",
          label: "Components & structures",
          icon: ListChecks,
          audience: "employer",
        },
        {
          path: "/people/settings/payslip",
          label: "Payslip",
          icon: FileText,
          audience: "employer",
        },
        {
          path: "/people/settings/absence",
          label: "Absence deduction",
          icon: UserX,
          audience: "employer",
        },
        {
          path: "/people/settings/rates",
          label: "BPJS & tax rates",
          icon: BadgePercent,
          audience: "employer",
        },
        {
          path: "/people/claim-types",
          label: "Claim types",
          icon: ReceiptText,
          audience: "employer",
        },
        {
          path: "/people/settings/benefit",
          label: "Benefit",
          icon: Gift,
          audience: "employer",
        },
      ],
    },
    {
      label: "Settings · Access",
      items: [
        {
          path: "/people/job-roles",
          label: "Job roles",
          icon: BadgeCheck,
          audience: "employer",
        },
        {
          path: "/people/settings/checklists",
          label: "Onboarding tasks",
          icon: ClipboardCheck,
          audience: "employer",
        },
        {
          path: "/people/settings/delegation",
          label: "Approval delegation",
          icon: Handshake,
          audience: "employer",
        },
        {
          path: "/people/settings/app",
          label: "Employee app",
          icon: Smartphone,
          audience: "employer",
        },
      ],
    },
  ],
}
